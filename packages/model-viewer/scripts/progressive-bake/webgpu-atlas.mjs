import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {cacheDir, launchBrowser, outDir, startServer} from './harness.mjs';
import {unwrapLightmap} from './unwrap-lightmap.mjs';

const shots = join(
    outDir, 'sheets', 'compare', 'gpu-debug', 'upgrade');

const run = async () => {
  await mkdir(shots, {recursive: true});
  const server = await startServer();
  const browser = await launchBrowser();
  const page = await browser.newPage();
  await page.setViewport({width: 1280, height: 900, deviceScaleFactor: 1});
  page.on('console', (message) => {
    console.log('PAGE', message.type(), message.text());
  });
  page.on('pageerror', (error) => {
    console.log('PAGEERROR', error && error.stack || error);
  });
  const plane = process.env.PLANE === '1';
  const up = process.env.UP === '1';
  const resolution = plane ? 256 : 2048;
  const lightmapFile = join(cacheDir, 'montana-lightmap.bin');
  if (!plane) {
    await unwrapLightmap(join(cacheDir, 'montana.glb'), lightmapFile, resolution);
  }
  const url = `http://127.0.0.1:${server.port}/packages/model-viewer/scripts/progressive-bake/webgpu-atlas.html?model=/bake-cache/montana.glb&env=/bake-cache/montana.hdr&resolution=${resolution}${plane ? '&plane=1' : ''}${up ? '&up=1' : ''}${plane ? '' : '&lightmap=/bake-cache/montana-lightmap.bin'}`;
  try {
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000});
    await page.waitForFunction(
        () => window.__status && window.__status.done, {timeout: 720000});
    const status = await page.evaluate(() => window.__status);
    console.log('STATUS', JSON.stringify(status));
    if (status.error) {
      throw new Error(status.error);
    }
    const atlas = await page.$('#atlas');
    const sheet = await page.$('#sheet');
    const tag = plane ? 'plane' : 'montana';
    if (atlas) {
      await atlas.screenshot({path: join(shots, `${tag}-webgpu-atlas-layout.jpg`), type: 'jpeg', quality: 85});
    }
    if (sheet) {
      await sheet.screenshot({path: join(shots, `${tag}-webgpu-atlas.jpg`), type: 'jpeg', quality: 85});
      const before = await page.$('#crop-before');
      const after = await page.$('#crop-after');
      if (before) await before.screenshot({path: join(shots, `${tag}-denoise-before.jpg`), type: 'jpeg', quality: 90});
      if (after) await after.screenshot({path: join(shots, `${tag}-denoise-after.jpg`), type: 'jpeg', quality: 90});
    }
    await writeFile(join(shots, 'timings.json'), JSON.stringify(status, null, 2));
  } finally {
    await browser.close();
    await server.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
