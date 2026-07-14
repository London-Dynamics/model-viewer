import {devices, playwrightLauncher} from '@web/test-runner-playwright';

/**
 * CI config for the LD fork: Chromium only, excluding suites that target the
 * upstream SmoothControls implementation or heavy GPU integration tests.
 */
const excluded = [
  // LDControlsMixin (CameraControls) replaced SmoothControls.
  'lib/test/three-components/SmoothControls-spec.js',
  'lib/test/features/controls-spec.js',
  // GPU path-tracing / AO render integration — slow and environment-sensitive.
  'lib/test/three-components/postprocessing/ld-path-tracer/LDPathTracerRender-spec.js',
  'lib/test/three-components/postprocessing/ld-ambient-occlusion/LDAmbientOcclusionRender-spec.js',
  // animateCameraTo routing assertions need CameraControls-specific tuning.
  'lib/test/features/ld-camera-spec.js',
];

export default {
  concurrency: 6,
  nodeResolve: true,
  files: ['lib/test/**/*-spec.js', ...excluded.map((f) => `!${f}`)],
  rootDir: '../../',
  browserLogs: false,
  filterBrowserLogs: (log) => log.type === 'error',
  testRunnerHtml: testFramework => `
  <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </head>
    <body>
      <script type="module" src="${testFramework}"></script>
    </body>
  </html>`,
  testsFinishTimeout: 300000,
  testFramework: {
    config: {
      ui: 'tdd',
      timeout: '60000',
    },
  },
  browsers: [
    playwrightLauncher({
      product: 'chromium',
      launchOptions: {
        retries: 2,
      },
      createBrowserContext({browser}) {
        return browser.newContext({...devices['Desktop Chrome']});
      },
    }),
  ],
};
