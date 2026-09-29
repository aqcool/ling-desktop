import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: {
      main: 'src/main.ts',
      host: 'src/host/index.ts',
      profile: 'src/profile.ts',
      extensions: 'src/extensions.ts',
      webserver: 'src/webserver.ts',
      'host-process': 'src/host-process.ts',
      'web-document': 'src/web-document.ts',
    },
    outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024',
    fixedExtension: false, dts: false, clean: true,
    deps: { neverBundle: ['electron'] },
  },
  {
    entry: { 'preload-app': 'src/preload-app.ts', 'preload-browser': 'src/preload-browser.ts', 'preload-credentials': 'src/preload-credentials.ts' },
    outDir: 'lib', format: 'cjs', platform: 'node', target: 'es2024',
    fixedExtension: false, dts: false, clean: false,
    deps: { neverBundle: ['electron'] },
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib', format: 'cjs', platform: 'browser', target: 'es2022',
    // The plugin loader needs CJS, but its dependencies still run in Chromium.
    // tsdown otherwise resolves CJS builds with Node package conditions.
    inputOptions: { platform: 'browser' },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    fixedExtension: false, dts: false, clean: false,
    deps: {
      alwaysBundle: id => id !== '@deepseek-ai/cordis',
      neverBundle: ['@deepseek-ai/cordis'],
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "ling-desktop-host", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
