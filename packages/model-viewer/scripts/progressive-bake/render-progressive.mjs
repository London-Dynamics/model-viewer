import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {
  cacheDir,
  cacheUrl,
  launchBrowser,
  loadScenes,
  outDir,
  pageHtml,
  prepareSceneAssets,
  startServer,
} from './harness.mjs';

const bake = {
  contact: {
    mode: 'progressive',
    fadeMs: 0,
    budgetMs: 14,
    idleDelayMs: 1e9,
    traceRevealSamples: 99,
    bake: {
      contactShadow: {enabled: true, resolution: 160, softness: 0.08, opacity: 0.7},
      textureAO: {enabled: false},
    },
    lights: {include: false},
    probes: {enabled: false},
  },
  ao: {
    mode: 'progressive',
    fadeMs: 0,
    budgetMs: 14,
    idleDelayMs: 1e9,
    traceRevealSamples: 99,
    bake: {
      contactShadow: {enabled: true, resolution: 128, softness: 0.08, opacity: 0.7},
      textureAO: {enabled: true, resolution: 512, samples: 64, distance: 0},
    },
    lights: {include: false},
    probes: {enabled: false},
  },
  lights: {
    mode: 'progressive',
    fadeMs: 0,
    budgetMs: 14,
    idleDelayMs: 1e9,
    traceRevealSamples: 99,
    bake: {
      contactShadow: {enabled: true, resolution: 96, softness: 0.08, opacity: 0.7},
      textureAO: {enabled: false},
    },
    lights: {include: true, separateLayers: true},
    probes: {enabled: false},
  },
  probes: {
    mode: 'progressive',
    fadeMs: 0,
    budgetMs: 14,
    idleDelayMs: 1e9,
    traceRevealSamples: 99,
    bake: {
      contactShadow: {enabled: true, resolution: 96, softness: 0.08, opacity: 0.7},
      textureAO: {enabled: false},
    },
    lights: {include: false},
    probes: {enabled: true, count: 1, resolution: 256},
  },
  trace: {
    mode: 'progressive',
    fadeMs: 0,
    budgetMs: 6,
    idleDelayMs: 0,
    traceRevealSamples: 12,
    bake: {
      contactShadow: {enabled: true, resolution: 64, softness: 0.08, opacity: 0.7},
      textureAO: {enabled: false},
    },
    lights: {include: false},
    probes: {enabled: false},
  },
};
bake['lights-close'] = bake.lights;

async function waitUntil(page, label, timeout, done) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    last = await page.evaluate(done);
    if (last && last.ok) {
      return last;
    }
    if (Date.now() - start > 2000) {
      console.log('WAIT', label, JSON.stringify(last && last.progress));
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`${label} timed out: ${JSON.stringify(last)}`);
}

async function shoot(page, file) {
  const mv = await page.$('model-viewer');
  await mv.screenshot({path: file});
}

async function runStage(page, scene, stage, urls) {
  await page.goto(urls.page, {waitUntil: 'networkidle0', timeout: 120000});
  await page.waitForFunction(() => customElements.get('model-viewer'));
  const src = (stage === 'lights' || stage === 'lights-close') && urls.lights ?
      urls.lights :
      urls.model;
  const hdr = stage === 'lights-close' && urls.night ? urls.night : urls.environment;
  await page.evaluate(async ({scene, stage, src, hdr, options}) => {
    const mv = document.querySelector('model-viewer');
    const label = stage === 'shader-ao' ?
        scene.label + ' — shader AO on (preset leaves it off)' :
        stage === 'realtime-no-ao' ?
        scene.label + ' — realtime, shader AO off' :
        scene.label + ' — ' + stage;
    document.querySelector('#label').textContent = label;
    mv.setAttribute('src', src);
    mv.setAttribute('environment-image', hdr);
    for (const [key, value] of Object.entries(scene.attrs || {})) {
      if (value === '') {
        mv.setAttribute(key, '');
      } else {
        mv.setAttribute(key, value);
      }
    }
    if (stage === 'shader-ao' && scene.shaderAo) {
      for (const [key, value] of Object.entries(scene.shaderAo)) {
        mv.setAttribute(key, value);
      }
    }
    if (stage === 'realtime-no-ao') {
      mv.removeAttribute('ambient-occlusion');
    }
    if (stage !== 'realtime' && stage !== 'shader-ao' && stage !== 'realtime-no-ao') {
      mv.setAttribute('path-tracer', '');
      mv.pathTracerDenoise = true;
      mv.pathTracerSamples = stage === 'trace' ? 16 : 1;
      mv.pathTracerSamplesThreshold = 1;
      mv.pathTracerBounces = stage === 'trace' ? 3 : 2;
      mv.pathTracerRenderScale = stage === 'trace' ? 0.5 : 1;
      mv.pathTracerTiles = stage === 'trace' ? '2 2' : '3 3';
      if (stage === 'trace') {
        mv.pathTracerDenoiseSigma = 7;
        mv.pathTracerDenoiseThreshold = 0.15;
        mv.pathTracerDenoiseKSigma = 1.4;
      }
    }
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('load timeout')), 180000);
      mv.addEventListener('load', () => {
        clearTimeout(timer);
        resolve();
      }, {once: true});
    });
    if (stage === 'lights-close') {
      mv.setAttribute('camera-orbit', '0.55rad 1.15rad 3.4m');
      mv.setAttribute('camera-target', '0.4m 2.4m -0.2m');
      for (const symbol of Object.getOwnPropertySymbols(mv)) {
        const value = mv[symbol];
        if (value && typeof value.environmentIntensity === 'number') {
          value.environmentIntensity = 0.35;
          if (typeof value.queueRender === 'function') {
            value.queueRender();
          }
        }
      }
    }
    if (stage !== 'realtime' && stage !== 'shader-ao' && stage !== 'realtime-no-ao') {
      mv.setPathTracerOptions(options);
    }
  }, {scene, stage, src, hdr, options: bake[stage] ?? null});
  if (stage === 'realtime' || stage === 'shader-ao' || stage === 'realtime-no-ao') {
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } else if (stage === 'contact') {
    await waitUntil(page, scene.id + ' contact', 300000, () => {
      const mv = document.querySelector('model-viewer');
      const state = mv.getPathTracerProgressiveState();
      return {
        ok: mv.isContactShadowReady === true && state && state.contactShadow.fade > 0.95,
        progress: state,
      };
    });
  } else if (stage === 'ao') {
    await waitUntil(page, scene.id + ' ao', 2400000, () => {
      const mv = document.querySelector('model-viewer');
      const state = mv.getPathTracerProgressiveState();
      return {
        ok: mv.isTextureAoReady === true && state && state.textureAO && state.textureAO.fade > 0.95,
        progress: state && state.textureAO,
      };
    });
  } else if (stage === 'lights' || stage === 'lights-close') {
    await waitUntil(page, scene.id + ' lights', 2400000, () => {
      const mv = document.querySelector('model-viewer');
      const state = mv.getPathTracerProgressiveState();
      return {
        ok: mv.isLightLayersReady === true && state && state.lightLayers && state.lightLayers.fade > 0.95,
        progress: state && state.lightLayers,
      };
    });
  } else if (stage === 'probes') {
    await waitUntil(page, scene.id + ' probes', 2400000, () => {
      const mv = document.querySelector('model-viewer');
      const state = mv.getPathTracerProgressiveState();
      return {
        ok: mv.isProbesReady === true && state && state.probes && state.probes.fade > 0.95,
        progress: state && state.probes,
      };
    });
  } else if (stage === 'trace') {
    await waitUntil(page, scene.id + ' trace', 1200000, () => {
      const mv = document.querySelector('model-viewer');
      const state = mv.getPathTracerProgressiveState();
      return {
        ok: state != null && state.fullTrace.revealed === true,
        progress: state && state.fullTrace,
      };
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  return page.evaluate(() => {
    const mv = document.querySelector('model-viewer');
    return {
      state: mv.getPathTracerProgressiveState?.() ?? null,
      samples: mv.pathTracerRenderedSamples,
    };
  });
}

const only = process.env.SCENE || '';
const onlyStage = process.env.STAGE || '';
const scenes = await loadScenes();
await mkdir(cacheDir, {recursive: true});
await mkdir(outDir, {recursive: true});
const server = await startServer();
const pagePath = join(cacheDir, 'preview.html');
await writeFile(pagePath, pageHtml(server.port));
const browser = await launchBrowser();
const page = await browser.newPage();
await page.setViewport({width: 1280, height: 800, deviceScaleFactor: 1});
page.on('pageerror', (error) => console.log('PAGEERROR', error.message));
page.on('console', (msg) => {
  const text = msg.text();
  if (msg.type() === 'error' || text.startsWith('PROBE') || text.startsWith('AO ')) {
    console.log('CONSOLE', text);
  }
});

const report = [];
try {
  for (const scene of scenes) {
    if (only && scene.id !== only) {
      continue;
    }
    await prepareSceneAssets(scene);
    const urls = {
      page: `http://127.0.0.1:${server.port}/bake-cache/preview.html`,
      model: cacheUrl(server.port, `${scene.id}.glb`),
      environment: cacheUrl(server.port, `${scene.id}.hdr`),
      night: scene.nightEnvironment ? cacheUrl(server.port, `${scene.id}-night.hdr`) : null,
      lights: scene.lightsModel ? cacheUrl(server.port, `${scene.id}-lights.glb`) : null,
    };
    const stages = scene.id === 'aquila' ?
        ['realtime', 'realtime-no-ao', 'contact', 'ao', 'lights', 'lights-close', 'probes', 'trace'] :
        ['realtime', 'shader-ao', 'contact', 'ao', 'probes', 'trace'];
    for (const stage of stages) {
      if (onlyStage && stage !== onlyStage) {
        continue;
      }
      console.log('STAGE', scene.id, stage);
      const started = Date.now();
      let stats = null;
      let error = null;
      try {
        stats = await runStage(page, scene, stage, urls);
      } catch (err) {
        error = String(err);
        console.log('STAGE FAIL', scene.id, stage, error);
      }
      const file = join(outDir, `${scene.id}-${stage}.png`);
      try {
        await shoot(page, file);
      } catch (err) {
        console.log('SHOT FAIL', err);
      }
      report.push({
        scene: scene.id,
        label: scene.label,
        stage,
        ms: Date.now() - started,
        error,
        stats,
        file,
      });
      console.log('DONE', scene.id, stage, Date.now() - started, error ?? 'ok');
    }
  }
} finally {
  let existing = [];
  const timings = join(outDir, 'timings.json');
  try {
    existing = JSON.parse(await readFile(timings, 'utf8'));
  } catch {
    existing = [];
  }
  await writeFile(timings, JSON.stringify(existing.concat(report), null, 2));
  await browser.close();
  await server.close();
  console.log('WROTE', timings);
}
