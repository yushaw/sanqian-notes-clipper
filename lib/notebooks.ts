// Notebook listing via the get_notebooks bridge tool (read-only, already
// exposed by notes). Used to populate the popup's notebook picker.

import { callTool } from './native';

export interface Notebook {
  id: string;
  name: string;
  source_type: 'internal' | 'local-folder';
  writable: boolean;
  note_count: number;
}

export interface ListNotebooksResult {
  ok: boolean;
  notebooks: Notebook[];
  error?: string;
}

export async function listNotebooks(): Promise<ListNotebooksResult> {
  const resp = await callTool<Notebook[]>('get_notebooks', {});
  if (!resp.ok) {
    return { ok: false, notebooks: [], error: resp.error };
  }
  const notebooks = Array.isArray(resp.result) ? resp.result : [];
  return { ok: true, notebooks };
}
