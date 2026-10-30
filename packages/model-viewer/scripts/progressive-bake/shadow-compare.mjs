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

const OUT = process.env.BAKE_OUT || '/tmp/shadow-compare';
const SAMPLES = Number(process.env.SAMPLES || 16);
const ONLY = process.env.SCENE || '';

const shots = [
  {scene: 'montana', camera: 'hero', crop: {name: 'bays', x: 0.28, y: 0.22, w: 0.44, h: 0.52}},
  {scene: 'montana', camera: 'interior', crop: {name: 'shelf', x: 0.08, y: 0.04, w: 0.84, h: 0.92}},
  {scene: 'aquila', camera: 'close', crop: {name: 'cockpit', x: 0.22, y: 0.22, w: 0.4, h: 0.45}},
  {scene: 'triton', camera: 'hero', crop: {name: 'door', x: 0.28, y: 0.34, w: 0.22, h: 0.32}},
  {scene: 'triton', camera: 'close', crop: {name: 'hood', x: 0.3, y: 0.18, w: 0.4, h: 0.36}},
];

function parseOrbit(value) {
  const num = (part) => part.endsWith('deg') ? parseFloat(part) * Math.PI / 180 : parseFloat(part);
  const [theta, phi, radius] = value.split(/\s+/);
  return {theta: num(theta), phi: num(phi), radius: num(radius)};
}

async function settle(page, orbit) {
  const want = parseOrbit(orbit);
  for (let i = 0; i < 40; i++) {
    const got = await page.evaluate(() => {
      const orbitNow = document.querySelector('model-viewer').getCameraOrbit();
      return {theta: orbitNow.theta, phi: orbitNow.phi, radius: orbitNow.radius};
    });
    const dTheta = Math.abs(got.theta - want.theta);
    if (dTheta < 0.08 && Math.abs(got.radius - want.radius) < Math.max(0.2, want.radius * 0.08)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

async function shoot(page, file) {
  const el = await page.$('model-viewer');
  await el.screenshot({path: file, type: 'png'});
  console.log('WROTE', file);
}

async function main() {
  await mkdir(OUT, {recursive: true});
  const scenes = await loadScenes();
  const server = await startServer();
  const browser = await launchBrowser();
  const pageUrl = `http://127.0.0.1:${server.port}/bake-cache/shadow-compare.html`;
  await writeFile(join(cacheDir, 'shadow-compare.html'), pageHtml(server.port));
  const page = await browser.newPage();
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('Surface factor') || text.includes('Occlusion')) {
      console.log('CONSOLE', text);
    }
  });
  page.on('pageerror', (error) => console.log('PAGE', error.message));
  await page.setViewport({width: 1280, height: 800, deviceScaleFactor: 1});

  const wanted = shots.filter((shot) => !ONLY || shot.scene === ONLY);
  const byScene = new Map();
  for (const shot of wanted) {
    if (!byScene.has(shot.scene)) byScene.set(shot.scene, []);
    byScene.get(shot.scene).push(shot);
  }

  for (const [id, group] of byScene) {
    const scene = scenes.find((item) => item.id === id);
    const files = await prepareSceneAssets(scene);
    const model = cacheUrl(server.port, files.model.split('/').pop());
    const hdr = cacheUrl(server.port, files.environment.split('/').pop());
    await page.goto(pageUrl, {waitUntil: 'networkidle0'});
    await page.evaluate(async (src, environment, samples) => {
      const mv = document.querySelector('model-viewer');
      mv.setAttribute('src', src);
      mv.setAttribute('environment-image', environment);
      mv.setAttribute('shadow-intensity', '0');
      mv.setAttribute('tone-mapping', 'neutral');
      mv.removeAttribute('ambient-occlusion');
      await new Promise((resolve, reject) => {
        mv.addEventListener('load', () => resolve(true), {once: true});
        setTimeout(() => reject(new Error('load timeout')), 180000);
      });
      mv.pathTracerSamples = samples;
      mv.pathTracerBounces = 2;
      mv.pathTracerTiles = '1 1';
      mv.pathTracerDenoise = false;
      mv.pathTracerRenderScale = 1;
      mv.setPathTracerOptions({
        mode: 'progressive',
        view: 'occlusion',
        occlusionEnvironment: 'uniform',
        fadeMs: 0,
        idleDelayMs: 1e9,
        budgetMs: 14,
        traceRevealSamples: 99,
        bake: {
          contactShadow: {enabled: false},
          textureAO: {enabled: true, resolution: 512, samples, distance: 0},
          lightmap: {enabled: false},
        },
        lights: {include: false},
        probes: {enabled: false},
      });
      mv.setAttribute('path-tracer', '');
    }, model, hdr, SAMPLES);

    const ready = await waitReady(page, id);
    console.log('READY', id, JSON.stringify(ready));
    for (const shot of group) {
      const [orbit, target, fov] = scene.cameras[shot.camera];
      await page.evaluate((orbit, target, fov) => {
        const mv = document.querySelector('model-viewer');
        mv.setAttribute('min-camera-orbit', 'auto 0deg 0.04m');
        if (fov) {
          mv.setAttribute('max-field-of-view', '120deg');
          mv.fieldOfView = fov;
        }
        mv.cameraTarget = target;
        mv.cameraOrbit = orbit;
        if (typeof mv.jumpCameraToGoal === 'function') mv.jumpCameraToGoal();
      }, orbit, target, fov || '');
      await settle(page, orbit);
      await page.evaluate(() => {
        document.querySelector('model-viewer').setPathTracerOptions({view: 'occlusion'});
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      await shoot(page, join(OUT, `${id}-${shot.camera}-shadow.png`));
      await page.evaluate(() => {
        document.querySelector('model-viewer').setPathTracerOptions({view: 'bake'});
      });
      await new Promise((resolve) => setTimeout(resolve, 600));
      await shoot(page, join(OUT, `${id}-${shot.camera}-bake.png`));
      await page.evaluate(() => {
        document.querySelector('model-viewer').setPathTracerOptions({view: 'occlusion'});
      });
    }
  }
  await browser.close();
  await server.close();
  await writeFile(join(OUT, 'shots.json'), JSON.stringify(wanted, null, 2));
}

async function waitReady(page, label) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < 900000) {
    const state = await page.evaluate(() => {
      const mv = document.querySelector('model-viewer');
      return mv.getPathTracerProgressiveState();
    });
    const ao = state && state.textureAO;
    const stamp = JSON.stringify({
      ao: ao && {ready: ao.ready, progress: Math.round((ao.progress || 0) * 100)},
      shadow: state && state.occlusionSamples,
      scale: state && state.occlusionScale,
    });
    if (stamp !== last) {
      last = stamp;
      console.log('WAIT', label, stamp);
    }
    if (ao && ao.ready && state.occlusionSamples >= 8 && state.occlusionScale > 0) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('timeout ' + label);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
