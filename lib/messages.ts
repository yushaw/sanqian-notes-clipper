// Message protocols.
//   popup  -> background : PopupRequest
//   background -> content : ExtractRequest

import type { ClipMode } from './handlers/types';

export interface CheckConnectionRequest {
  type: 'CHECK_CONNECTION';
}

export interface ListNotebooksRequest {
  type: 'LIST_NOTEBOOKS';
}

export interface ClipRequest {
  type: 'CLIP';
  mode: ClipMode;
  notebookId?: string;
}

export type PopupRequest = CheckConnectionRequest | ListNotebooksRequest | ClipRequest;

export interface ExtractRequest {
  type: 'EXTRACT';
  mode: ClipMode;
}
