// Durable, per-tab clip job state.
//
// A clip is a long-running job that outlives the popup that started it. The
// popup is just a view; the source of truth lives here, in storage.session:
//   - survives popup close/reopen (the popup re-reads it on mount),
//   - survives service-worker eviction (storage.session is in-memory across SW
//     restarts and cleared on browser close, never written to disk),
//   - drives the popup reactively via storage.onChanged (no polling),
//   - dedups concurrent clips of the same tab (no duplicate notes).
//
// The job runs in the background, not in the popup, so closing the popup does
// not abort it. MV3 still terminates an idle worker (~30s) and hard-caps its
// lifetime (~5 min) regardless of pending work, so the background pings an API
// to survive the idle timer while clipping (see withKeepalive in background.ts);
// a job killed anyway by the hard cap leaves a 'running' record that RUNNING_TTL
// reclaims, letting the user retry.

import { browser } from 'wxt/browser';

export interface ClipJob {
  state: 'running' | 'succeeded' | 'failed';
  title?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export type ClipOutcome = { ok: true; title?: string } | { ok: false; error: string };

const KEY_PREFIX = 'clipJob:';
export const clipJobKey = (tabId: number): string => `${KEY_PREFIX}${tabId}`;

// A running record older than this is treated as stale: MV3 caps a service
// worker's lifetime, so a clip still "running" past this could only be a job
// whose worker already died. Dropping it lets a fresh clip start and stops the
// popup showing a stuck "Clipping…".
export const RUNNING_TTL_MS = 5 * 60 * 1000;
// A finished record lingers this long (measured from completion) so a popup
// reopened after the clip ended can still show the outcome it missed, then is
// treated as acknowledged.
export const TERMINAL_TTL_MS = 5 * 60 * 1000;

function isFresh(job: ClipJob, now: number): boolean {
  return job.state === 'running'
    ? now - job.startedAt < RUNNING_TTL_MS
    : now - (job.finishedAt ?? job.startedAt) < TERMINAL_TTL_MS;
}

export async function getClipJob(tabId: number): Promise<ClipJob | null> {
  const k = clipJobKey(tabId);
  const rec = (await browser.storage.session.get(k))[k] as ClipJob | undefined;
  if (!rec) return null;
  return isFresh(rec, Date.now()) ? rec : null;
}

async function setClipJob(tabId: number, job: ClipJob): Promise<void> {
  await browser.storage.session.set({ [clipJobKey(tabId)]: job });
}

export async function clearClipJob(tabId: number): Promise<void> {
  await browser.storage.session.remove(clipJobKey(tabId));
}

// Run a clip as a deduped, durable, per-tab job. If a fresh running job already
// exists for the tab, returns it WITHOUT starting a second clip. Otherwise
// marks the tab running, runs `runner`, and records the terminal outcome.
export async function runClipJob(tabId: number, runner: () => Promise<ClipOutcome>): Promise<ClipJob> {
  const existing = await getClipJob(tabId);
  if (existing?.state === 'running') return existing;

  const startedAt = Date.now();
  await setClipJob(tabId, { state: 'running', startedAt });

  let done: ClipJob;
  try {
    const outcome = await runner();
    done = outcome.ok
      ? { state: 'succeeded', title: outcome.title, startedAt, finishedAt: Date.now() }
      : { state: 'failed', error: outcome.error, startedAt, finishedAt: Date.now() };
  } catch (e) {
    done = { state: 'failed', error: String(e), startedAt, finishedAt: Date.now() };
  }
  await setClipJob(tabId, done);
  return done;
}
