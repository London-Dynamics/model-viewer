import {readFileSync} from 'node:fs';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {PNG} from 'pngjs';

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

function pictureStats(file) {
  const png = PNG.sync.read(readFileSync(file));
  const count = png.width * png.height;
  let max = 0;
  let sum = 0;
  let mid = 0;
  for (let i = 0; i < count; i++) {
    const luma = png.data[i * 4] * 0.2126 + png.data[i * 4 + 1] * 0.7152 +
        png.data[i * 4 + 2] * 0.0722;
    if (luma > max) {
      max = luma;
    }
    sum += luma;
    if (luma > 12 && luma < 243) {
      mid++;
    }
  }
  return {
    max: Math.round(max),
    mean: Math.round(sum / count),
    mid: Number((mid / count).toFixed(3)),
    width: png.width,
    height: png.height,
  };
}

function assertPicture(file, label, minMax, minMid) {
  const stats = pictureStats(file);
  console.log('PIXELS', label, JSON.stringify(stats));
  if (stats.max < minMax || stats.mid < minMid) {
    throw new Error(
        label + ' is not a shadow field (max ' + stats.max + ', mid ' +
        stats.mid + '). A black frame or white UV edges fails this check.');
  }
  return stats;
}

async function probeReadback(page) {
  const result = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const gl = canvas.getContext('webgl2');
    if (gl == null) {
      return {error: 'no webgl2'};
    }
    const floatExt = gl.getExtension('EXT_color_buffer_float');
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, `#version 300 es
      void main() { gl_Position = vec4(0.0, 0.0, 0.0, 1.0); gl_PointSize = 4.0; }
    `);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, `#version 300 es
      precision highp float;
      out vec4 outColor;
      void main() { outColor = vec4(0.25, 0.5, 0.75, 1.0); }
    `);
    gl.compileShader(fs);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.useProgram(program);
    const read = (internal, type, bufferType) => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, gl.RGBA, type, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(
          gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        return {status, peak: 0};
      }
      gl.viewport(0, 0, 4, 4);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, 1);
      const pixels = new bufferType(4 * 4 * 4);
      gl.readPixels(0, 0, 4, 4, gl.RGBA, type, pixels);
      let peak = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const luma = type === gl.FLOAT ?
            (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 :
            (pixels[i] + pixels[i + 1] + pixels[i + 2]) / (3 * 255);
        if (luma > peak) {
          peak = luma;
        }
      }
      return {status, peak};
    };
    const byteRead = read(gl.RGBA8, gl.UNSIGNED_BYTE, Uint8Array);
    const floatRead = floatExt == null ?
        {status: 0, peak: 0, missing: true} :
        read(gl.RGBA32F, gl.FLOAT, Float32Array);
    return {
      renderer: gl.getParameter(gl.RENDERER),
      floatExt: floatExt != null,
      bytePeak: byteRead.peak,
      floatPeak: floatRead.peak,
      byteStatus: byteRead.status,
      floatStatus: floatRead.status,
    };
  });
  console.log('GPU_READBACK', JSON.stringify(result));
  if (!(result.bytePeak > 0.2)) {
    throw new Error(
        'GPU byte readback of a known color is empty. Occlusion and the bake cannot be scored. ' +
        JSON.stringify(result));
  }
  if (!(result.floatPeak > 0.2)) {
    console.log(
        'GPU_READBACK float target returned', result.floatPeak,
        'while byte returned', result.bytePeak,
        '— this is the Metal failure mode the bake now avoids.');
  }
  return result;
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
  await probeReadback(page);
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
      idleDelayMs: 1000000,
      budgetMs: 14,
      traceRevealSamples: 10000,
      shadowPass: {enabled: true, samples: 4, bounces: 1, renderScale: 0.25, denoise: true},
      bake: {
        contactShadow: {enabled: false},
        textureAO: {enabled: true, resolution: 96, samples: 4, distance: 0},
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

  const ready = await waitFor(page, (state) => (state?.shadowMs || 0) > 0, 'shadow layer');
  const wallShadows = Date.now() - wallStart;
  console.log('TIME_TO_SHADOWS_MS', wallShadows, 'shadowMs', ready.shadowMs, 'scale', ready.occlusionScale);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await shoot(page, join(OUT, '3-realtime-with-layer.png'));
  assertPicture(join(OUT, '3-realtime-with-layer.png'), 'realtime-with-layer', 30, 0.02);

  await page.evaluate(() => {
    document.querySelector('model-viewer').setPathTracerOptions({view: 'occlusion'});
  });
  const occlusion = await waitFor(
      page, (state) => (state?.occlusionSamples || 0) >= 8, 'shadow view');
  console.log('OCCLUSION_SCALE', occlusion.occlusionScale, 'samples', occlusion.occlusionSamples);
  if (occlusion.occlusionScale > 0 && occlusion.occlusionScale < 0.02) {
    throw new Error('occlusionScale collapsed to ' + occlusion.occlusionScale);
  }
  await shoot(page, join(OUT, '1b-shadow-pt.png'));
  assertPicture(join(OUT, '1b-shadow-pt.png'), 'occlusion-view', 30, 0.02);

  await page.evaluate(() => {
    document.querySelector('model-viewer').setPathTracerOptions({view: 'bake'});
  });
  await waitFor(page, (state) => state?.textureAO?.ready === true, 'bake');
  await new Promise((resolve) => setTimeout(resolve, 500));
  await shoot(page, join(OUT, '2-stored-layer.png'));
  assertPicture(join(OUT, '2-stored-layer.png'), 'bake', 40, 0.04);

  await page.evaluate(() => {
    document.querySelector('model-viewer').setPathTracerOptions({
      view: 'beauty',
      idleDelayMs: 0,
      traceRevealSamples: 6,
    });
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
