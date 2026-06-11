import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  // Visible output dir (the default '.output' is dot-hidden in file pickers).
  outDir: 'output',
  modules: ['@wxt-dev/module-react', '@wxt-dev/i18n/module'],
  manifest: {
    name: 'Sanqian Clipper',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // nativeMessaging: talk to the com.sanqian_notes.native host.
    // activeTab/scripting: read the current page on user action.
    // storage: remember the chosen notebook (later milestones).
    // Host permissions: WXT auto-injects <all_urls> for the runtime-registered
    // content script; that is also what exempts background media downloads
    // (e.g. WeChat's mmbiz CDN, which answers CORS only to qq origins) from
    // CORS — do not add narrower per-CDN entries, they would be redundant.
    permissions: ['nativeMessaging', 'activeTab', 'scripting', 'storage'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
