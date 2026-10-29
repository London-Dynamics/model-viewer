import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {
  cacheDir,
  cacheUrl,
  launchBrowser,
  loadScenes,
  pageHtml,
  prepareSceneAssets,
  startServer,
} from './harness.mjs';

const OUT = process.env.BAKE_OUT || '/tmp/shadow-flow';

async function shoot(page, file) {
  const el = await page.$('model-viewer');
  await el.screenshot({path: file, type: 'png'});
  console.log('WROTE', file);
}

async function stateOf(page) {
  return page.evaluate(() => {
    const mv = document.querySelector('model-viewer');
    return mv.getPathTracerProgressiveState();
  });
}

async function main() {
  await mkdir(OUT, {recursive: true});
  const scenes = await loadScenes();
  const scene = scenes.find((item) => item.id === 'montana');
  const files = await prepareSceneAssets(scene);
  const server = await startServer();
  const pageUrl = `http://127.0.0.1:${server.port}/bake-cache/shadow-flow.html`;
  await writeFile(join(cacheDir, 'shadow-flow.html'), pageHtml(server.port));
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('Shadow layer') || msg.type() === 'error') {
      console.log('CONSOLE', text);
    }
  });
  page.on('pageerror', (error) => console.log('PAGE', error.message));
  await page.setViewport({width: 1280, height: 800, deviceScaleFactor: 1});
  const wallStart = Date.now();
  await page.goto(pageUrl, {waitUntil: 'networkidle0'});
  const [orbit, target] = scene.cameras.hero;
  await page.evaluate(async (src, environment, orbit, target) => {
    const mv = document.querySelector('model-viewer');
    mv.setAttribute('src', src);
    mv.setAttribute('environment-image', environment);
    mv.setAttribute('shadow-intensity', '0');
    mv.setAttribute('tone-mapping', 'neutral');
    mv.setAttribute('ambient-occlusion', '');
    mv.setAttribute('camera-orbit', orbit);
    mv.setAttribute('camera-target', target);
    await new Promise((resolve, reject) => {
      mv.addEventListener('load', () => resolve(true), {once: true});
      setTimeout(() => reject(new Error('load timeout')), 180000);
    });
    mv.pathTracerSamples = 16;
    mv.pathTracerSamplesThreshold = 6;
    mv.pathTracerBounces = 2;
    mv.pathTracerTiles = '1 1';
    mv.pathTracerDenoise = true;
    mv.pathTracerRenderScale = 1;
    mv.setPathTracerOptions({
      mode: 'progressive',
      view: 'beauty',
      occlusionEnvironment: 'uniform',
      fadeMs: 0,
      idleDelayMs: 0,
      budgetMs: 14,
      traceRevealSamples: 6,
      bake: {
        contactShadow: {enabled: false},
        textureAO: {enabled: true, resolution: 192, samples: 4, distance: 0},
        lightmap: {enabled: false},
      },
      lights: {include: false},
      probes: {enabled: false},
    });
    mv.setAttribute('path-tracer', '');
  }, cacheUrl(server.port, 'montana.glb'), cacheUrl(server.port, 'montana.hdr'), orbit, target);

  await new Promise((resolve) => setTimeout(resolve, 700));
  const early = await stateOf(page);
  if (!early?.textureAO?.ready) {
    await shoot(page, join(OUT, '1-realtime.png'));
  }

  const ready = await waitFor(page, (state) => state?.textureAO?.ready === true, 'shadow layer');
  const wallShadows = Date.now() - wallStart;
  console.log('TIME_TO_SHADOWS_MS', wallShadows, 'shadowMs', ready.shadowMs);
  await shoot(page, join(OUT, '3-realtime-with-layer.png'));

  await page.evaluate(() => {
    document.querySelector('model-viewer').setPathTracerOptions({view: 'bake'});
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  await shoot(page, join(OUT, '2-stored-layer.png'));

  await page.evaluate(() => {
    document.querySelector('model-viewer').setPathTracerOptions({view: 'occlusion'});
  });
  await waitFor(page, (state) => (state?.occlusionSamples || 0) >= 4, 'shadow view');
  await shoot(page, join(OUT, '1b-shadow-pt.png'));

  await page.evaluate(() => {
    document.querySelector('model-viewer').setPathTracerOptions({view: 'beauty'});
  });
  const traced = await waitFor(
      page, (state) => state?.fullTrace?.revealed === true, 'full trace');
  console.log('FULL_TRACE', JSON.stringify(traced.fullTrace));
  await new Promise((resolve) => setTimeout(resolve, 400));
  await shoot(page, join(OUT, '4-full-trace.png'));
  await browser.close();
  await server.close();
}

async function waitFor(page, done, label) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < 600000) {
    const state = await stateOf(page);
    const stamp = JSON.stringify({
      ao: state?.textureAO,
      shadowMs: state?.shadowMs,
      trace: state?.fullTrace,
      occ: state?.occlusionSamples,
    });
    if (stamp !== last) {
      last = stamp;
      console.log('WAIT', label, stamp);
    }
    if (done(state)) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('timeout ' + label);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
