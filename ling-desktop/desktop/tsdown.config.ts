import { defineConfig } from 'tsdown'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

// The Host's Session owner is replaced by a LING adapter, so the browser roster
// no longer discovers its original dual-face package. Keep that published Client
// bundle intact and register it before the LING bootstrap requires its factory.
const sessionClientBundle = readFileSync(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-api-session-controller/client'), 'utf8')

export default defineConfig([
  {
    entry: {
      main: 'src/main.ts',
      'ssh-runtime': 'src/ssh/runtime.ts',
      'ssh-plugin': 'src/ssh/plugin.ts',
      host: 'src/host/index.ts',
      profile: 'src/profile.ts',
      extensions: 'src/extensions.ts',
      'session-lifecycle': 'src/session-lifecycle.ts',
      'session-storage': 'src/session-storage.ts',
      'session-controller': 'src/session-controller.ts',
      'computer-use': 'src/computer-use.ts',
      compaction: 'src/compaction.ts',
      webserver: 'src/webserver.ts',
      'host-process': 'src/host-process.ts',
      'web-document': 'src/web-document.ts',
    },
    outDir: 'lib', format: 'esm', platform: 'node', target: 'es2024',
    fixedExtension: false, dts: false, clean: true,
    deps: { neverBundle: ['electron'], alwaysBundle: ['ling-desktop/theme', 'ling-desktop/runtime'] },
  },
  {
    entry: { 'preload-app': 'src/preload-app.ts', 'preload-browser': 'src/preload-browser.ts', 'preload-credentials': 'src/preload-credentials.ts' },
    outDir: 'lib', format: 'cjs', platform: 'node', target: 'es2024',
    fixedExtension: false, dts: false, clean: false,
    deps: { neverBundle: ['electron'] },
  },
  {
    entry: { client: 'src/client/bootstrap.ts' },
    outDir: 'lib', format: 'cjs', platform: 'browser', target: 'es2022',
    // The plugin loader needs CJS, but its dependencies still run in Chromium.
    // tsdown otherwise resolves CJS builds with Node package conditions.
    inputOptions: { platform: 'browser', moduleTypes: { '.png': 'dataurl' } },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    fixedExtension: false, dts: false, clean: false,
    deps: {
      alwaysBundle: id => !['@deepseek-ai/cordis', '@deepseek-ai/dsh-api-session-controller/client'].includes(id),
      neverBundle: ['@deepseek-ai/cordis', '@deepseek-ai/dsh-api-session-controller/client'],
    },
    outputOptions: {
      entryFileNames: 'client.js',
      // The DSH factory loader requires one self-contained CJS module. Shared
      // chunks would repeat this registration banner and require local files.
      // Languages still initialize only when requested by CodeMirror.
      codeSplitting: false,
      banner: sessionClientBundle + '\nwindow.__ModuleLoader__.load({ id: "ling-desktop-host", factory: (require) => {',
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
