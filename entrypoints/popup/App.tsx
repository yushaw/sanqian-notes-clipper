import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { i18n } from '#i18n';
import type { NativeResponse } from '@/lib/native';
import type { CreateNoteResult } from '@/lib/clip';
import type { Notebook, ListNotebooksResult } from '@/lib/notebooks';
import type { ClipMode } from '@/lib/handlers/types';

type ConnState = 'checking' | 'connected' | 'not-running' | 'no-host';

const CONN_KEY = {
  checking: 'popup.conn.checking',
  connected: 'popup.conn.connected',
  'not-running': 'popup.conn.notRunning',
  'no-host': 'popup.conn.noHost',
} as const satisfies Record<ConnState, `popup.conn.${string}`>;

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
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [connError, setConnError] = useState('');

  useEffect(() => {
    void (async () => {
      const resp = (await browser.runtime.sendMessage({ type: 'CHECK_CONNECTION' })) as NativeResponse;
      if (resp?.ok) {
        setConn('connected');
        await loadNotebooks();
      } else if (resp && 'code' in resp && resp.code === 'NOT_RUNNING') {
        setConn('not-running');
      } else {
        setConn('no-host');
        if (resp && 'error' in resp && resp.error) setConnError(resp.error);
      }
    })();
  }, []);

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
    setBusy(true);
    setStatus('');
    try {
      await browser.storage.local.set({ [LAST_NOTEBOOK_KEY]: notebookId });
      const resp = (await browser.runtime.sendMessage({
        type: 'CLIP',
        mode,
        notebookId: notebookId || undefined,
      })) as NativeResponse<CreateNoteResult>;

      if (resp?.ok) {
        setStatus(`${i18n.t('popup.status.saved')}: ${resp.result?.title ?? i18n.t('popup.status.note')}`);
      } else {
        const detail = (resp && 'error' in resp && resp.error) || i18n.t('popup.status.unknownError');
        setStatus(`${i18n.t('popup.status.failed')}: ${detail}`);
      }
    } catch (e) {
      setStatus(`${i18n.t('popup.status.error')}: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const connected = conn === 'connected';

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
            disabled={!connected}
          >
            {i18n.t(m.labelKey)}
          </button>
        ))}
      </div>

      <button className="clipper__button" onClick={clip} disabled={busy || !connected}>
        {busy ? i18n.t('popup.clipping') : i18n.t('popup.clip')}
      </button>

      {conn === 'no-host' && connError && (
        <p className="clipper__status">
          {i18n.t('popup.status.hostError')}: {connError}
        </p>
      )}
      {status && <p className="clipper__status">{status}</p>}
    </div>
  );
}
