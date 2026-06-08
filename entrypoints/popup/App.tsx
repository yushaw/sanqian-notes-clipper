import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { NativeResponse } from '@/lib/native';
import type { CreateNoteResult } from '@/lib/clip';
import type { Notebook, ListNotebooksResult } from '@/lib/notebooks';
import type { ClipMode } from '@/lib/handlers/types';

type ConnState = 'checking' | 'connected' | 'not-running' | 'no-host';

const CONN_LABEL: Record<ConnState, string> = {
  checking: 'Checking…',
  connected: 'Connected',
  'not-running': 'Notes not running',
  'no-host': 'Host not installed',
};

const MODES: { value: ClipMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'article', label: 'Article' },
  { value: 'selection', label: 'Selection' },
];

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

    const stored = (await browser.storage.local.get(LAST_NOTEBOOK_KEY))[LAST_NOTEBOOK_KEY] as
      | string
      | undefined;
    const preferred =
      writable.find((n) => n.id === stored) ??
      writable.find((n) => n.source_type === 'internal') ??
      writable[0];
    if (preferred) {
      setNotebookId(preferred.id);
    }
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
        setStatus(`Saved: ${resp.result?.title ?? 'note'}`);
      } else {
        setStatus(`Failed: ${(resp && 'error' in resp && resp.error) || 'unknown error'}`);
      }
    } catch (e) {
      setStatus(`Error: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const connected = conn === 'connected';

  return (
    <div className="clipper">
      <header className="clipper__header">
        <h1>Sanqian Notes</h1>
        <span className={`clipper__conn clipper__conn--${conn}`}>{CONN_LABEL[conn]}</span>
      </header>

      <label className="clipper__field">
        <span>Notebook</span>
        <select
          value={notebookId}
          onChange={(e) => setNotebookId(e.target.value)}
          disabled={!connected || notebooks.length === 0}
        >
          {notebooks.length === 0 && <option value="">(default inbox)</option>}
          {notebooks.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </label>

      <div className="clipper__modes" role="radiogroup" aria-label="Clip mode">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`clipper__mode ${mode === m.value ? 'is-active' : ''}`}
            aria-pressed={mode === m.value}
            onClick={() => setMode(m.value)}
            disabled={!connected}
          >
            {m.label}
          </button>
        ))}
      </div>

      <button className="clipper__button" onClick={clip} disabled={busy || !connected}>
        {busy ? 'Clipping…' : 'Clip this page'}
      </button>

      {conn === 'no-host' && connError && (
        <p className="clipper__status">Host error: {connError}</p>
      )}
      {status && <p className="clipper__status">{status}</p>}
    </div>
  );
}
