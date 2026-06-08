// Result shape of the create_note bridge tool.

export interface CreateNoteResult {
  id: string;
  title: string;
  source_type: string;
  revision: number;
  etag: string;
  message: string;
}
