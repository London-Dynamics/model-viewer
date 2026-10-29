import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {
  cacheDir,
  cacheUrl,
  ensureUniformHdr,
  launchBrowser,
  loadScenes,
  outDir,
  pageHtml,
  prepareSceneAssets,
  startServer,
} from './harness.mjs';

const KIND = process.env.KIND || 'baked';
const ONLY = process.env.SCENE || '';

const bakedOptions = {
  mode: 'progressive',
  fadeMs: 0,
  budgetMs: 14,
  idleDelayMs: 1e9,
  traceRevealSamples: 99,
  bake: {
    contactShadow: {enabled: false},
    textureAO: {enabled: true, resolution: 512, samples: 64, distance: 0},
  },
  lights: {include: false},
  probes: {enabled: false},
};

const traceOptions = {
  mode: 'progressive',
  fadeMs: 0,
  budgetMs: 6,
  idleDelayMs: 0,
  traceRevealSamples: 16,
  bake: {
    contactShadow: {enabled: false},
    textureAO: {enabled: false},
  },
  lights: {include: false},
  probes: {enabled: false},
};

async function waitUntil(page, label, timeout, done) {
  const start = Date.now();
  let last = null;
  let lastStamp = '';
  while (Date.now() - start < timeout) {
    last = await page.evaluate(done);
    if (last && last.ok) {
      return last;
    }
    const stamp = JSON.stringify(last && last.progress);
    if (stamp !== lastStamp) {
      lastStamp = stamp;
      console.log('WAIT', label, stamp);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('timeout ' + label + ' ' + JSON.stringify(last));
}

function parseOrbit(value) {
  const num = (part) => part.endsWith('deg') ?
      parseFloat(part) * Math.PI / 180 :
      parseFloat(part);
  const [theta, phi, radius] = value.split(/\s+/);
  return {theta: num(theta), phi: num(phi), radius: num(radius)};
}

function angleDelta(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) {
    d = Math.PI * 2 - d;
  }
  return d;
}

async function settleCamera(page, orbit) {
  const want = parseOrbit(orbit);
  for (let i = 0; i < 40; i++) {
    const got = await page.evaluate(() => {
      const orbitNow = document.querySelector('model-viewer').getCameraOrbit();
      return {theta: orbitNow.theta, phi: orbitNow.phi, radius: orbitNow.radius};
    });
    if (angleDelta(got.theta, want.theta) < 0.05 &&
        Math.abs(got.radius - want.radius) < Math.max(0.12, want.radius * 0.06)) {
      console.log('SETTLED', JSON.stringify(got));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('camera did not settle at ' + orbit);
}

async function shoot(page, file) {
  const el = await page.$('model-viewer');
  await el.screenshot({path: file, type: 'png'});
  console.log('WROTE', file);
}

async function load(page, src, hdr, orbit, target) {
  const meshes = await page.evaluate(async (src, hdr, orbit, target) => {
    const mv = document.querySelector('model-viewer');
    mv.setAttribute('src', src);
    mv.setAttribute('environment-image', hdr);
    mv.setAttribute('camera-orbit', orbit);
    mv.setAttribute('camera-target', target);
    mv.removeAttribute('ambient-occlusion');
    await new Promise((resolve, reject) => {
      const ok = () => {
        mv.removeEventListener('load', ok);
        resolve(true);
      };
      mv.addEventListener('load', ok);
      setTimeout(() => reject(new Error('load timeout')), 180000);
    });
    const whiten = (root) => {
      root.traverse((object) => {
        if (object.material == null) {
          return;
        }
        const list = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of list) {
          if (material.isMeshStandardMaterial !== true) {
            continue;
          }
          material.color.set(1, 1, 1);
          material.roughness = 1;
          material.metalness = 0;
          material.clearcoat = 0;
          material.clearcoatRoughness = 1;
          material.sheen = 0;
          material.transmission = 0;
          material.specularIntensity = 0;
          material.iridescence = 0;
          if (material.emissive) {
            material.emissive.set(0, 0, 0);
          }
          material.emissiveIntensity = 0;
          material.map = null;
          material.normalMap = null;
          material.roughnessMap = null;
          material.metalnessMap = null;
          material.aoMap = null;
          material.emissiveMap = null;
          material.needsUpdate = true;
        }
      });
    };
    let count = 0;
    for (const symbol of Object.getOwnPropertySymbols(mv)) {
      const value = mv[symbol];
      if (value == null || typeof value.traverse !== 'function') {
        continue;
      }
      let meshesHere = 0;
      value.traverse((object) => {
        if (object.isMesh) {
          meshesHere++;
        }
      });
      if (meshesHere > count) {
        count = meshesHere;
        whiten(value);
      }
    }
    return count;
  }, src, hdr, orbit, target);
  console.log('MESHES', meshes);
  await new Promise((resolve) => setTimeout(resolve, 400));
}

const scenes = await loadScenes();
await mkdir(cacheDir, {recursive: true});
await mkdir(outDir, {recursive: true});
const server = await startServer();
const pageUrl = `http://127.0.0.1:${server.port}/bake-cache/ao-compare.html`;
await writeFile(join(cacheDir, 'ao-compare.html'), pageHtml(server.port));
await ensureUniformHdr();

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({width: 1280, height: 800, deviceScaleFactor: 1});
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
page.on('console', (msg) => {
  if (msg.type() === 'error') {
    console.log('CONSOLE', msg.text());
  }
});

try {
  for (const scene of scenes) {
    if (ONLY && scene.id !== ONLY) {
      continue;
    }
    const files = await prepareSceneAssets(scene);
    const model = cacheUrl(server.port, `${scene.id}.glb`);
    const hdr = KIND === 'uniform' ?
        cacheUrl(server.port, 'uniform-white-e8.hdr') :
        cacheUrl(server.port, `${scene.id}.hdr`);
    void files;
    if (KIND === 'baked') {
      await page.goto(pageUrl, {waitUntil: 'networkidle0'});
      const [orbit, target] = scene.cameras.hero;
      await load(page, model, hdr, orbit, target);
      await page.evaluate((options) => {
        const mv = document.querySelector('model-viewer');
        mv.setAttribute('path-tracer', '');
        mv.setPathTracerOptions(options);
      }, bakedOptions);
      await waitUntil(page, scene.id + ' baked', 2400000, () => {
        const mv = document.querySelector('model-viewer');
        const state = mv.getPathTracerProgressiveState();
        const ao = state && state.textureAO;
        return {
          ok: mv.isTextureAoReady === true && ao && ao.fade > 0.95,
          progress: ao,
        };
      });
      for (const name of Object.keys(scene.cameras)) {
        const [camOrbit, camTarget] = scene.cameras[name];
        const applied = await page.evaluate((orbit, target) => {
          const mv = document.querySelector('model-viewer');
          mv.setAttribute('min-camera-orbit', 'auto 0deg 0.15m');
          mv.setAttribute('max-camera-orbit', 'auto 180deg 80m');
          mv.cameraOrbit = orbit;
          mv.cameraTarget = target;
          if (typeof mv.jumpCameraToGoal === 'function') {
            mv.jumpCameraToGoal();
          }
          const got = mv.getCameraOrbit();
          return {theta: got.theta, phi: got.phi, radius: got.radius, asked: orbit};
        }, camOrbit, camTarget);
        console.log('CAMERA', scene.id, name, JSON.stringify(applied));
        await settleCamera(page, camOrbit);
        await shoot(page, join(outDir, `${scene.id}-baked-${name}.png`));
      }
      const hashes = new Set();
      for (const name of Object.keys(scene.cameras)) {
        const buf = await readFile(join(outDir, `${scene.id}-baked-${name}.png`));
        const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
        console.log('HASH', scene.id, name, hash);
        hashes.add(hash);
      }
      if (hashes.size < Object.keys(scene.cameras).length) {
        throw new Error(scene.id + ' cameras produced identical frames');
      }
      const atlas = await page.evaluate(() => {
        const mv = document.querySelector('model-viewer');
        let map = null;
        for (const symbol of Object.getOwnPropertySymbols(mv)) {
          const value = mv[symbol];
          if (value == null || typeof value.traverse !== 'function') {
            continue;
          }
          value.traverse((object) => {
            const material = object.material;
            const list = Array.isArray(material) ? material : [material];
            for (const item of list || []) {
              if (item && item.aoMap && item.aoMap.image && item.aoMap.image.data) {
                map = item.aoMap;
              }
            }
          });
        }
        if (map == null) {
          return null;
        }
        const width = map.image.width;
        const height = map.image.height;
        const bytes = map.image.data;
        let hit = 0;
        let miss = 0;
        for (const symbol of Object.getOwnPropertySymbols(mv)) {
          const value = mv[symbol];
          if (value == null || typeof value.traverse !== 'function') {
            continue;
          }
          value.traverse((object) => {
            const uv = object.geometry && object.geometry.getAttribute &&
                object.geometry.getAttribute('uv1');
            if (uv == null) {
              return;
            }
            for (let i = 0; i < uv.count; i++) {
              const x = Math.min(width - 1, Math.max(0, Math.floor(uv.getX(i) * width)));
              const y = Math.min(height - 1, Math.max(0, Math.floor(uv.getY(i) * height)));
              const alpha = bytes[(y * width + x) * 4 + 3];
              if (alpha === 0) {
                miss++;
              } else {
                hit++;
              }
            }
          });
        }
        return {width, height, bytes: Array.from(bytes), vertexHit: hit, vertexMiss: miss};
      });
      if (atlas) {
        await writeFile(join(outDir, `${scene.id}-ao-bytes.json`), JSON.stringify({
          width: atlas.width,
          height: atlas.height,
        }));
        await writeFile(join(outDir, `${scene.id}-ao.raw`), Buffer.from(atlas.bytes));
        console.log(
            'ATLAS', scene.id, atlas.width, atlas.height,
            'vertexHit', atlas.vertexHit, 'vertexMiss', atlas.vertexMiss);
      }
    } else {
      for (const name of Object.keys(scene.cameras)) {
        await page.goto(pageUrl, {waitUntil: 'networkidle0'});
        const [orbit, target] = scene.cameras[name];
        await load(page, model, hdr, orbit, target);
        await settleCamera(page, orbit);
        await page.evaluate((options) => {
          const mv = document.querySelector('model-viewer');
          mv.pathTracerDenoise = true;
          mv.pathTracerSamples = 16;
          mv.pathTracerSamplesThreshold = 1;
          mv.pathTracerBounces = 2;
          mv.pathTracerRenderScale = 1;
          mv.pathTracerTiles = '2 2';
          mv.setAttribute('path-tracer', '');
          mv.setPathTracerOptions(options);
        }, traceOptions);
        await waitUntil(page, scene.id + ' trace ' + name, 1200000, () => {
          const mv = document.querySelector('model-viewer');
          const state = mv.getPathTracerProgressiveState();
          const trace = state && state.fullTrace;
          return {
            ok: trace && trace.revealed === true && trace.samples >= 12,
            progress: trace,
          };
        });
        await new Promise((resolve) => setTimeout(resolve, 500));
        const applied = await page.evaluate(() => {
          const got = document.querySelector('model-viewer').getCameraOrbit();
          return {theta: got.theta, phi: got.phi, radius: got.radius};
        });
        console.log('CAMERA', scene.id, name, JSON.stringify(applied));
        const label = KIND === 'uniform' ? 'uniform' : 'trace';
        await shoot(page, join(outDir, `${scene.id}-${label}-${name}.png`));
      }
    }
  }
} finally {
  await browser.close();
  await server.close();
}
