import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import type { NativeResponse } from '@/lib/native';
import type { Notebook, ListNotebooksResult } from '@/lib/notebooks';
import type { ClipMode } from '@/lib/handlers/types';
import { getClipJob, clearClipJob, clipJobKey, type ClipJob } from '@/lib/clip-jobs';

type ConnState = 'checking' | 'connected' | 'not-running' | 'not-installed' | 'no-host';

const CONN_KEY = {
  checking: 'popup.conn.checking',
  connected: 'popup.conn.connected',
  'not-running': 'popup.conn.notRunning',
  'not-installed': 'popup.conn.notInstalled',
  'no-host': 'popup.conn.noHost',
} as const satisfies Record<ConnState, `popup.conn.${string}`>;

const DOWNLOAD_URL = 'https://sanqian.ai/notes';

const MODES = [
  { value: 'auto', labelKey: 'popup.mode.auto' },
  { value: 'article', labelKey: 'popup.mode.article' },
  { value: 'selection', labelKey: 'popup.mode.selection' },
] as const satisfies ReadonlyArray<{ value: ClipMode; labelKey: `popup.mode.${string}` }>;

const LAST_NOTEBOOK_KEY = 'lastNotebookId';

export function App() {
  const [conn, setConn] = useState<ConnState>('checking');
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notebookId, setNotebookId] = useState<string>('');
  const [mode, setMode] = useState<ClipMode>('auto');
  // The clip job is the source of truth (in storage.session, owned by the
  // background); the popup only mirrors it. `dispatching` covers the brief
  // window between the click and the job record flipping to 'running'.
  const [tabId, setTabId] = useState<number | null>(null);
  const [job, setJob] = useState<ClipJob | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [status, setStatus] = useState('');
  const [connError, setConnError] = useState('');
  // Platform decides whether "not running" can auto-launch (macOS only).
  const [os, setOs] = useState<string>('');

  useEffect(() => {
    void browser.runtime
      .getPlatformInfo()
      .then((info) => setOs(info.os))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void (async () => {
      const resp = (await browser.runtime.sendMessage({ type: 'CHECK_CONNECTION' })) as NativeResponse;
      const code = resp && 'code' in resp ? resp.code : undefined;
      if (resp?.ok) {
        setConn('connected');
        await loadNotebooks();
      } else if (code === 'NOT_RUNNING') {
        setConn('not-running');
      } else if (code === 'NOT_INSTALLED') {
        setConn('not-installed');
      } else {
        setConn('no-host');
        if (resp && 'error' in resp && resp.error) setConnError(resp.error);
      }
    })();
  }, []);

  // Resolve the active tab and load any existing clip job for it (so a clip
  // started in a previous popup session is still reflected on reopen).
  useEffect(() => {
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id == null) return;
      setTabId(tab.id);
      setJob(await getClipJob(tab.id));
    })();
  }, []);

  // Subscribe to the tab's job record so progress/result update live, even when
  // the running clip was started by a different (now-closed) popup session.
  useEffect(() => {
    if (tabId == null) return;
    const key = clipJobKey(tabId);
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
      if (area !== 'session' || !(key in changes)) return;
      setJob((changes[key].newValue as ClipJob | undefined) ?? null);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => browser.storage.onChanged.removeListener(onChanged);
  }, [tabId]);

  async function loadNotebooks(): Promise<void> {
    const result = (await browser.runtime.sendMessage({ type: 'LIST_NOTEBOOKS' })) as ListNotebooksResult;
    const writable = (result?.notebooks ?? []).filter((n) => n.writable);
    setNotebooks(writable);

    // '' is a valid stored value meaning Inbox (no notebook). Default to Inbox
    // unless a remembered notebook still exists.
    const stored = (await browser.storage.local.get(LAST_NOTEBOOK_KEY))[LAST_NOTEBOOK_KEY] as
      | string
      | undefined;
    const matched = stored ? writable.find((n) => n.id === stored) : undefined;
    setNotebookId(matched ? matched.id : '');
  }

  async function clip(): Promise<void> {
    setStatus('');
    setDispatching(true);
    try {
      await browser.storage.local.set({ [LAST_NOTEBOOK_KEY]: notebookId });
      // Fire the clip. Its progress and result are reflected through the job
      // record (storage.onChanged), so it completes correctly even if the popup
      // is closed mid-clip; the response here is only a courtesy for this view.
      await browser.runtime.sendMessage({ type: 'CLIP', mode, notebookId: notebookId || undefined });
    } catch (e) {
      setStatus(`${i18n.t('popup.status.error')}: ${String(e)}`);
    } finally {
      setDispatching(false);
    }
  }

  // Re-hovering the button acknowledges a finished clip, reverting to "Clip".
  function acknowledge(): void {
    if (tabId == null || job == null || job.state === 'running') return;
    setJob(null);
    void clearClipJob(tabId);
  }

  const connected = conn === 'connected';
  // Clipping is allowed when running, and also when installed-but-not-running:
  // the background launches the app (macOS) or the user opens it, then clips.
  const canClip = connected || conn === 'not-running';
  const running = dispatching || job?.state === 'running';
  const succeeded = !running && job?.state === 'succeeded';
  const failed = !running && job?.state === 'failed';
  // macOS can auto-launch on click; elsewhere the user must open Notes first.
  const clipLabel =
    conn === 'not-running' && os === 'mac' ? i18n.t('popup.openAndClip') : i18n.t('popup.clip');

  return (
    <div className="clipper">
      <header className="clipper__header">
        <h1>{i18n.t('popup.header')}</h1>
        <span className={`clipper__conn clipper__conn--${conn}`}>{i18n.t(CONN_KEY[conn])}</span>
      </header>

      <label className="clipper__field">
        <span>{i18n.t('popup.notebook')}</span>
        <select value={notebookId} onChange={(e) => setNotebookId(e.target.value)} disabled={!connected}>
          <option value="">{i18n.t('popup.inbox')}</option>
          {notebooks.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>

      <div className="clipper__modes" role="radiogroup" aria-label={i18n.t('popup.clip')}>
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`clipper__mode ${mode === m.value ? 'is-active' : ''}`}
            aria-pressed={mode === m.value}
            onClick={() => setMode(m.value)}
            disabled={!canClip}
          >
            {i18n.t(m.labelKey)}
          </button>
        ))}
      </div>

      {conn === 'not-installed' ? (
        <button className="clipper__button" onClick={() => void browser.tabs.create({ url: DOWNLOAD_URL })}>
          {i18n.t('popup.download')}
        </button>
      ) : (
        <button
          className={`clipper__button ${running ? 'is-clipping' : ''} ${succeeded ? 'is-saved' : ''}`}
          onClick={clip}
          onMouseEnter={acknowledge}
          disabled={running || !canClip}
        >
          {running ? (
            <span className="clipper__loading">
              <span className="clipper__spinner" aria-hidden="true" />
              {i18n.t('popup.clipping')}
            </span>
          ) : succeeded ? (
            `${i18n.t('popup.status.saved')}: ${job?.title ?? i18n.t('popup.status.note')}`
          ) : (
            clipLabel
          )}
        </button>
      )}

      {conn === 'not-installed' && <p className="clipper__status">{i18n.t('popup.hint.notInstalled')}</p>}
      {conn === 'not-running' && os !== 'mac' && !running && (
        <p className="clipper__status">{i18n.t('popup.hint.notRunning')}</p>
      )}

      {conn === 'no-host' && connError && (
        <p className="clipper__status">
          {i18n.t('popup.status.hostError')}: {connError}
        </p>
      )}
      {failed && (
        <p className="clipper__status">
          {i18n.t('popup.status.failed')}: {job?.error ?? i18n.t('popup.status.unknownError')}
        </p>
      )}
      {status && <p className="clipper__status">{status}</p>}
    </div>
  );
}
