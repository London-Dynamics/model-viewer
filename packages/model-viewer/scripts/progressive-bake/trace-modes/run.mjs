// Trace composite matrix: per model x angle x exclusion x mode, raw trace and composite,
// plus real-time, ground-only, sample settings, orbit persistence and env re-burn.
import {writeFile, mkdir, appendFile, readFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {launchBrowser, startServer} from '../harness.mjs';

const here = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'trace-modes');
const models = (process.env.MODELS || 'montana,aquila,triton').split(',');
const cams = (process.env.CAMS || 'front,side,rear,close').split(',');
const modes = (process.env.MODES || 'full,shadows-normal,shadows-fast,lighting').split(',');
const excls = (process.env.EXCLS || 'none,semi,semi-cast').split(',');
const samples = Number(process.env.SAMPLES || 16);
const bounces = Number(process.env.BOUNCES || 8);
const extras = process.env.EXTRAS !== '0';
const shots = join(here, 'shots');
await mkdir(shots, {recursive: true});
const EXCL = {none: {exclude: ''}, semi: {exclude: 'semi-transparent'}, 'semi-cast': {exclude: 'semi-transparent', cast: true}};
const MODE = {
  full: {mode: 'full'}, 'shadows-normal': {mode: 'shadows', quality: 'normal'},
  'shadows-fast': {mode: 'shadows', quality: 'fast'}, lighting: {mode: 'lighting'}, ground: {mode: 'ground'},
};
const server = await startServer();
const browser = await launchBrowser();
const resume = process.env.RESUME === 'orbit';
const manifestPath = join(here, `manifest-${models.join('_')}.json`);
const readFileSyncText = resume ? await readFile(manifestPath, 'utf8') : '';
const manifest = resume ? (() => { const m = JSON.parse(readFileSyncText); m.shots = m.shots.filter((x) => x.group !== 'orbit' && x.group !== 'env'); m.runs = m.runs.filter((x) => x.group !== 'orbit' && x.group !== 'env'); return m; })() : {settings: {samples, bounces, resolution: [960, 720], aoDistance: 0.05, fadeMs: 150}, shots: [], runs: []};
const save = () => writeFile(manifestPath, JSON.stringify(manifest, null, 1));
try {
  for (const id of models) {
    const page = await browser.newPage();
    await page.setViewport({width: 960, height: 720, deviceScaleFactor: 1});
    page.on('console', (m) => { const t = m.text(); if (/error|warn/.test(m.type())) appendFile(join(here, 'console.log'), `${id} ${m.type()} ${t}\n`); if (/error|warn/.test(m.type()) && !/Lit is in dev|deprecated|renamed|scheduled an update|setOrbit/.test(t)) console.log(id, 'PAGE', m.type(), t.slice(0, 300)); });
    page.on('pageerror', (e) => console.log(id, 'PAGEERROR', e.stack || e));
    await page.goto(`http://127.0.0.1:${server.port}/packages/model-viewer/scripts/progressive-bake/trace-modes/tm.html`, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => window.__ready, {timeout: 60000});
    const info = await page.evaluate((id, o) => window.__api.load(id, o), id, {samples, bounces});
    console.log(id, 'loaded');
    const el = await page.$('#mv');
    let shotIndex = 0;
    const shot = async (meta) => {
      const parts = [meta.model, meta.angle, meta.mode, meta.view, meta.excl, meta.samplesLabel];
      if (meta.group === 'orbit' || meta.group === 'env') parts.push(meta.group, String(++shotIndex).padStart(2, '0'));
      const name = parts.join('__').replace(/[^a-z0-9_.-]/gi, '-');
      await el.screenshot({path: join(shots, `${name}.png`)});
      manifest.shots.push({...meta, file: `${name}.png`});
    };
    const trace = async (meta, cfg) => {
      const r = await page.evaluate((c) => window.__api.trace(c), cfg);
      const st = r.stats || {};
      const run = {...meta, wallMs: r.wallMs, burnMs: st.burnMs, firstSnapshotMs: st.firstSnapshotMs, settledMs: st.settledMs,
        samples: st.samples, converged: st.converged, checkpoints: st.checkpoints, burns: st.burns, excluded: (r.excluded || []).length,
        excludedNames: (r.excluded || []).slice(0, 30), nudges: r.nudges, error: r.error};
      manifest.runs.push(run);
      console.log(id, meta.angle, meta.mode, meta.excl, meta.samplesLabel, JSON.stringify({wall: r.wallMs, burn: st.burnMs, first: st.firstSnapshotMs, final: st.settledMs, spp: st.samples, ex: run.excluded, err: r.error}));
      return run;
    };
    const fixed = `${samples}spp fixed`;
    for (const cam of resume ? [] : cams) {
      await page.evaluate((c) => window.__api.camera(c), cam);
      await page.evaluate(() => window.__api.realtime());
      await shot({model: id, angle: cam, mode: 'real-time', view: 'realtime', excl: '-', samplesLabel: '-', ms: null});
      for (const ex of excls) {
        for (const m of modes) {
          const meta = {model: id, angle: cam, mode: m, excl: ex, samplesLabel: fixed};
          const run = await trace(meta, {...MODE[m], ...EXCL[ex], samples, samplesMode: 'fixed', view: 'composite'});
          const ms = Math.round(run.settledMs ?? run.wallMs);
          await shot({...meta, view: 'composite', ms, excluded: run.excluded});
          await page.evaluate(() => window.__api.view('trace'));
          await shot({...meta, view: 'raw trace', ms, excluded: run.excluded});
          await page.evaluate(() => window.__api.view('composite'));
        }
        await save();
      }
      const gmeta = {model: id, angle: cam, mode: 'ground', excl: 'none', samplesLabel: fixed};
      const g = await trace(gmeta, {...MODE.ground, samples, view: 'composite'});
      await shot({...gmeta, view: 'composite', ms: Math.round(g.burnMs ?? g.wallMs)});
      await save();
    }
    if (extras) {
      // Sample settings on the front angle.
      await page.evaluate(() => window.__api.camera('front'));
      for (const m of resume ? [] : ['shadows-normal', 'shadows-fast', 'full', 'lighting']) {
        for (const sp of [{n: 4, mode: 'fixed'}, {n: 64, mode: 'fixed'}, {n: 64, mode: 'adaptive'}]) {
          const label = sp.mode === 'adaptive' ? `adaptive<=${sp.n}` : `${sp.n}spp fixed`;
          const meta = {model: id, angle: 'front', mode: m, excl: 'none', samplesLabel: label, group: 'samples'};
          const run = await trace(meta, {...MODE[m], samples: sp.n, samplesMode: sp.mode, threshold: 1, view: 'composite'});
          await shot({...meta, view: 'composite', ms: Math.round(run.settledMs ?? run.wallMs), spp: run.samples});
        }
      }
      await save();
      if (resume) {
        // Re-shoot the front matrix panels the old orbit/env names overwrote.
        await page.evaluate(() => window.__api.camera('front'));
        const rmeta = {model: id, angle: 'front', mode: 'shadows-normal', excl: 'none', samplesLabel: fixed};
        const rr = await trace(rmeta, {...MODE['shadows-normal'], samples, samplesMode: 'fixed', view: 'composite'});
        await shot({...rmeta, view: 'composite', ms: Math.round(rr.settledMs ?? rr.wallMs), excluded: rr.excluded});
        const gm = {model: id, angle: 'front', mode: 'ground', excl: 'none', samplesLabel: fixed};
        const gr = await trace(gm, {...MODE.ground, samples, view: 'composite'});
        await shot({...gm, view: 'composite', ms: Math.round(gr.burnMs ?? gr.wallMs)});
      }
      // Orbit: the burned ground stays, the trace is off while moving and fades back in.
      await page.evaluate(() => window.__api.camera('front'));
      const ometa = {model: id, angle: 'front', mode: 'shadows-normal', excl: 'none', samplesLabel: fixed, group: 'orbit'};
      const o0 = await trace(ometa, {...MODE['shadows-normal'], samples, samplesMode: 'fixed', view: 'composite'});
      await shot({...ometa, view: 'composite', phase: 'before orbit (settled)', ms: Math.round(o0.settledMs)});
      await page.evaluate(() => window.__api.startOrbit(1.2));
      for (const wait of [150, 450, 450]) {
        await new Promise((r) => setTimeout(r, wait));
        const p = await page.evaluate(() => window.__api.probeOrbit());
        await shot({...ometa, view: 'composite', phase: `orbiting, trace fade ${p.fade.toFixed(2)}, burns ${p.burns}`, ms: null, probe: p});
      }
      const stop = await page.evaluate(() => window.__api.stopOrbit());
      manifest.runs.push({...ometa, orbit: stop});
      console.log(id, 'orbit', JSON.stringify(stop));
      const o1 = await trace(ometa, {...MODE['shadows-normal'], samples, samplesMode: 'fixed', view: 'composite'});
      await shot({...ometa, view: 'composite', phase: `stopped, faded in, burns ${o1.burns}`, ms: Math.round(o1.settledMs)});
      // Ground-only while orbiting.
      await page.evaluate((n) => window.__api.trace({mode: 'ground', samples: n}), samples);
      await page.evaluate(() => window.__api.startOrbit(1.2));
      await new Promise((r) => setTimeout(r, 400));
      const pg = await page.evaluate(() => window.__api.probeOrbit());
      await shot({...ometa, mode: 'ground', view: 'composite', phase: `ground only, orbiting, burns ${pg.burns}`, ms: null});
      await page.evaluate(() => window.__api.stopOrbit());
      // Env change re-burns the ground.
      await page.evaluate(() => window.__api.camera('front'));
      for (const [label, url] of [['preset neutral', '/packages/shared-assets/environments/neutral.hdr'], ['preset spruit sunrise', '/packages/shared-assets/environments/spruit_sunrise_1k_HDR.hdr'], ['scene hdr', `/bake-cache/${id}.hdr`]]) {
        await page.evaluate((u) => window.__api.env(u), url);
        const emeta = {model: id, angle: 'front', mode: 'shadows-normal', excl: 'none', samplesLabel: fixed, group: 'env', env: label};
        const e = await trace(emeta, {...MODE['shadows-normal'], samples, samplesMode: 'fixed', view: 'composite'});
        await shot({...emeta, view: 'composite', phase: `${label}, burns ${e.burns}`, ms: Math.round(e.settledMs ?? e.wallMs)});
      }
      await save();
    }
    await page.close();
  }
} finally {
  await save();
  await browser.close();
  await server.close();
}
