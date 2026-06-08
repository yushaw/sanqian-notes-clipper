import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Sanqian Notes Web Clipper',
    description: 'Clip web pages into Sanqian Notes.',
    // nativeMessaging: talk to the com.sanqian-notes.native host.
    // activeTab/scripting: read the current page on user action.
    // storage: remember the chosen notebook (later milestones).
    permissions: ['nativeMessaging', 'activeTab', 'scripting', 'storage'],
  },
});
