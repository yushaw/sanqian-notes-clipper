// Extraction content script. Registered at runtime (NOT in the manifest), so
// it is never auto-injected and carries no per-page cost — the background
// worker injects it on demand (activeTab) only when the user clips. This keeps
// the heavy extraction bundle (Defuddle + Turndown) off every page.

import { runChain } from '@/lib/extract/chain';
import type { ExtractRequest } from '@/lib/messages';

export default defineContentScript({
  registration: 'runtime',
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  main() {
    browser.runtime.onMessage.addListener((message): Promise<unknown> | undefined => {
      const req = message as ExtractRequest;
      if (req?.type === 'EXTRACT') {
        return runChain(req.mode);
      }
      return undefined;
    });
  },
});
