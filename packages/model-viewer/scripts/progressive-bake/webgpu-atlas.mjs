import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {cacheDir, launchBrowser, outDir, startServer} from './harness.mjs';
import {unwrapLightmap} from './unwrap-lightmap.mjs';

/**
 * Four-panel WebGPU sheet per model: real-time, bake alone, real-time plus
 * bake, and the full WebGPU path trace from the same camera.
 * MODEL=montana|aquila|triton. Run headed (HEADLESS=0): headless Chrome
 * hangs WebGPU and OIDN on macOS.
 */
const MODELS = {
  montana: {
    title: 'Montana 001112 (2027)',
    cam: '0,75,2.4',
    target: '0,0.38,0',
    fov: 30,
    // Small: a 4096 atlas and a raised density cap, 64 spp for thin stiles.
    resolution: 4096,
    maxTexelsPerCm: 24,
    samples: 64,
    closeup: {cam: '0.18,0.42,0.62', target: '0,0.09,0.02', fov: 40},
  },
  aquila: {
    title: 'Aquila 45 Sport',
    // scenes.json hero: 0.650rad 1.247rad 14.73m, field-of-view 45deg.
    cam: '37.26,71.43,14.73',
    target: '0,0.8,0',
    fov: 45,
    resolution: 4096,
    samples: 16,
  },
  triton: {
    title: 'Mitsubishi AU Triton v3',
    // scenes.json hero: -2.182rad 1.532rad 10.98m, field-of-view 30deg.
    cam: '-125.02,87.78,10.98',
    target: '0.09,0.97,0',
    fov: 30,
    resolution: 4096,
    samples: 16,
  },
};

const shots = join(outDir, 'sheets', 'webgpu-four');

const run = async () => {
  await mkdir(shots, {recursive: true});
  const plane = process.env.PLANE === '1';
  const tag = plane ? 'plane' : (process.env.MODEL || 'montana');
  const spec = MODELS[tag] || MODELS.montana;
  const resolution = plane ? 256 : Number(process.env.RESOLUTION || spec.resolution || 2048);
  const lightmapName = process.env.LIGHTMAP || `${tag}-lightmap-v3.bin`;
  let unwrap = null;
  const lightmapPath = join(cacheDir, lightmapName);
  if (!plane && process.env.SKIP_UNWRAP === '1' && existsSync(lightmapPath)) {
    // Reuse the ahead-of-time unwrap. Header only, for the timings.
    const file = await readFile(lightmapPath);
    const length = file.readUInt32LE(4);
    unwrap = JSON.parse(file.subarray(8, 8 + length).toString('utf8').replace(/\0+$/, ''));
    unwrap.reused = true;
  } else if (!plane) {
    unwrap = await unwrapLightmap(join(cacheDir, `${tag}.glb`), join(cacheDir, lightmapName), resolution,
        {maxTexelsPerCm: Number(process.env.MAX_TPC || spec.maxTexelsPerCm || 0)});
  }
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1400, height: 1100, deviceScaleFactor: 1});
  page.on('console', (message) => {
    console.log('PAGE', message.type(), message.text());
  });
  page.on('pageerror', (error) => {
    console.log('PAGEERROR', error && error.stack || error);
  });
  const query = new URLSearchParams({
    model: `/bake-cache/${tag}.glb`,
    env: `/bake-cache/${tag}.hdr`,
    resolution: String(resolution),
    cam: spec.cam,
    target: spec.target,
    fov: String(spec.fov),
    title: spec.title,
  });
  if (plane) query.set('plane', '1');
  else query.set('lightmap', `/bake-cache/${lightmapName}`);
  if (process.env.UP === '1') query.set('up', '1');
  if (process.env.SIDES) query.set('sides', process.env.SIDES);
  if (process.env.BIAS) query.set('bias', process.env.BIAS);
  query.set('samples', process.env.SAMPLES || String(spec.samples || 16));
  if (spec.closeup) {
    query.set('closeCam', spec.closeup.cam);
    query.set('closeTarget', spec.closeup.target);
    query.set('closeFov', String(spec.closeup.fov));
  }
  if (process.env.NORMALIZE) query.set('normalize', process.env.NORMALIZE);
  if (process.env.NORMALS) query.set('normals', process.env.NORMALS);
  if (process.env.TRACE_SAMPLES) query.set('traceSamples', process.env.TRACE_SAMPLES);
  const url = `http://127.0.0.1:${server.port}/packages/model-viewer/scripts/progressive-bake/webgpu-atlas.html?${query}`;
  try {
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000});
    await page.waitForFunction(
        () => window.__status && window.__status.done, {timeout: 900000, polling: 500});
    const status = await page.evaluate(() => window.__status);
    if (unwrap) delete unwrap.meshes;
    status.unwrap = unwrap;
    console.log('STATUS', JSON.stringify(status));
    if (status.error) {
      throw new Error(status.error);
    }
    const grab = async (id, name, quality = 88) => {
      const element = await page.$(id);
      if (element) {
        await element.screenshot({path: join(shots, name), type: 'jpeg', quality});
      }
    };
    const suffix = process.env.SUFFIX ? `-${process.env.SUFFIX}` : '';
    await grab('#sheet', `${tag}-four-panel${suffix}.jpg`);
    await grab('#atlas', `${tag}-atlas-layout.jpg`, 80);
    await grab('#trace-raw', `${tag}-trace-raw.jpg`);
    await grab('#seam-after', `${tag}-seam-after.jpg`);
    await grab('#closeup', `${tag}-closeup${suffix}.jpg`, 92);
    await writeFile(join(shots, `${tag}-timings.json`), JSON.stringify(status, null, 2));
  } finally {
    await browser.close();
    await server.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
