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
    permissions: ['nativeMessaging', 'activeTab', 'scripting', 'storage'],
    // WeChat article images live on mmbiz.qpic.cn, which only answers CORS
    // for qq-family origins — without this host permission the background
    // worker cannot read the image bytes to localize them (design §7.6).
    host_permissions: ['https://mmbiz.qpic.cn/*'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
