import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/i18n/module'],
  manifest: {
    name: 'Sanqian Clipper',
    description: 'Clip web pages into Sanqian Notes.',
    default_locale: 'en',
    // nativeMessaging: talk to the com.sanqian_notes.native host.
    // activeTab/scripting: read the current page on user action.
    // storage: remember the chosen notebook (later milestones).
    permissions: ['nativeMessaging', 'activeTab', 'scripting', 'storage'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
