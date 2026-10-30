// Screenshot of the example test page with the trace composite controls.
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchBrowser, startServer} from '../harness.mjs';
const here = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'trace-modes');
const server = await startServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({width: 1500, height: 1000, deviceScaleFactor: 1});
  const q = process.env.Q || 'model=aquila&camera=close&mode=lighting&view=composite&exclude=semi-transparent';
  await page.goto(`http://127.0.0.1:${server.port}/packages/model-viewer/examples/ld_path_tracer_progressive/index.html?${q}`, {waitUntil: 'domcontentloaded'});
  const t = Date.now();
  await page.waitForFunction(() => { const mv = document.querySelector('model-viewer'); return mv && mv.loaded && mv.pathTracer && mv.isPathTracerSettled; }, {timeout: 120000, polling: 500}).catch((e) => console.log('wait', e.message));
  await new Promise((r) => setTimeout(r, 1500));
  console.log('settled after', Date.now() - t, 'ms');
  await page.screenshot({path: join(here, 'test-page.png'), fullPage: true});
} finally {
  await browser.close();
  await server.close();
}
