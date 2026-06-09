import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// In-memory stand-in for browser.storage.session.
const store = new Map<string, unknown>();
vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      session: {
        get: async (k: string) => (store.has(k) ? { [k]: store.get(k) } : {}),
        set: async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) store.set(k, v);
        },
        remove: async (k: string) => {
          store.delete(k);
        },
      },
    },
  },
}));

import {
  runClipJob,
  getClipJob,
  clearClipJob,
  clipJobKey,
  RUNNING_TTL_MS,
  TERMINAL_TTL_MS,
  type ClipJob,
} from './clip-jobs';

const TAB = 7;

beforeEach(() => {
  store.clear();
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('runClipJob', () => {
  it('records a succeeded outcome with its title', async () => {
    const job = await runClipJob(TAB, async () => ({ ok: true, title: 'Hello' }));
    expect(job).toMatchObject({ state: 'succeeded', title: 'Hello' });
    expect(await getClipJob(TAB)).toMatchObject({ state: 'succeeded', title: 'Hello' });
  });

  it('records a failed outcome and a thrown error', async () => {
    expect(await runClipJob(TAB, async () => ({ ok: false, error: 'boom' }))).toMatchObject({
      state: 'failed',
      error: 'boom',
    });
    expect(
      await runClipJob(TAB, async () => {
        throw new Error('kaboom');
      }),
    ).toMatchObject({ state: 'failed' });
  });

  it('dedups against a fresh running job without invoking the runner', async () => {
    store.set(clipJobKey(TAB), { state: 'running', startedAt: 0 } satisfies ClipJob);
    const runner = vi.fn(async () => ({ ok: true as const, title: 'second' }));
    const job = await runClipJob(TAB, runner);
    expect(runner).not.toHaveBeenCalled();
    expect(job.state).toBe('running');
  });

  it('starts a new clip when the running record is stale (SW died)', async () => {
    store.set(clipJobKey(TAB), { state: 'running', startedAt: 0 } satisfies ClipJob);
    vi.setSystemTime(RUNNING_TTL_MS + 1);
    const runner = vi.fn(async () => ({ ok: true as const, title: 'fresh' }));
    const job = await runClipJob(TAB, runner);
    expect(runner).toHaveBeenCalledOnce();
    expect(job).toMatchObject({ state: 'succeeded', title: 'fresh' });
  });
});

describe('getClipJob', () => {
  it('returns null for an unknown tab', async () => {
    expect(await getClipJob(TAB)).toBeNull();
  });

  it('expires a finished record past its terminal TTL', async () => {
    await runClipJob(TAB, async () => ({ ok: true, title: 'done' }));
    expect(await getClipJob(TAB)).not.toBeNull();
    vi.setSystemTime(TERMINAL_TTL_MS + 1);
    expect(await getClipJob(TAB)).toBeNull();
  });
});

describe('clearClipJob', () => {
  it('removes the record', async () => {
    await runClipJob(TAB, async () => ({ ok: true, title: 'x' }));
    await clearClipJob(TAB);
    expect(await getClipJob(TAB)).toBeNull();
  });
});
