import {execFileSync} from 'node:child_process';
import {createReadStream, existsSync, statSync} from 'node:fs';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import http from 'node:http';
import {dirname, extname, join, normalize, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const scriptDir = here;
export const repoRoot = resolve(here, '../../../../');

export const cacheDir = resolve(process.env.BAKE_CACHE || join(here, 'cache'));
export const outDir = resolve(process.env.BAKE_OUT || join(here, 'out'));

const types = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

export async function loadScenes() {
  const raw = await readFile(join(here, 'scenes.json'), 'utf8');
  return JSON.parse(raw).scenes;
}

export function chromeArgs(backend = process.env.GL_BACKEND || 'gpu') {
  const common = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--ignore-gpu-blocklist',
  ];
  if (backend === 'swiftshader') {
    return [
      ...common,
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ];
  }
  if (backend === 'angle') {
    return [
      ...common,
      '--use-gl=angle',
      '--use-angle=default',
      '--disable-software-rasterizer',
    ];
  }
  if (backend === 'vulkan') {
    return [
      ...common,
      '--use-gl=angle',
      '--use-angle=vulkan',
      '--enable-features=Vulkan',
      '--disable-vulkan-surface',
      '--disable-software-rasterizer',
    ];
  }
  if (backend === 'gpu') {
    return [
      ...common,
      '--use-gl=angle',
      '--use-angle=gl',
      '--disable-software-rasterizer',
    ];
  }
  throw new Error(
      `GL_BACKEND must be gpu, angle, vulkan, or swiftshader (got ${backend})`);
}

export function findChrome() {
  if (process.env.CHROME_PATH) {
    return process.env.CHROME_PATH;
  }
  const candidates = [
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    return execFileSync('which', ['google-chrome'], {encoding: 'utf8'}).trim();
  } catch {
    return undefined;
  }
}

export async function loadPuppeteer() {
  const bundled = new URL(
      '../../../../node_modules/puppeteer/lib/esm/puppeteer/puppeteer.js',
      import.meta.url);
  return import(bundled.href);
}

function inside(root, file) {
  const prefix = root.endsWith(sep) ? root : root + sep;
  return file === root || file.startsWith(prefix);
}

export function startServer() {
  const port = Number(process.env.BAKE_PORT || 0);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const fromCache = pathname.startsWith('/bake-cache/');
    const rel = fromCache ? pathname.slice('/bake-cache/'.length) : pathname;
    const root = fromCache ? cacheDir : repoRoot;
    const file = normalize(join(root, rel));
    if (!inside(root, file) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolvePromise({
        port: address.port,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

export async function download(url, name) {
  await mkdir(cacheDir, {recursive: true});
  const dest = join(cacheDir, name);
  if (existsSync(dest) && statSync(dest).size > 0) {
    return dest;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`download ${response.status} ${url}`);
  }
  const tmp = dest + '.partial';
  await writeFile(tmp, Buffer.from(await response.arrayBuffer()));
  await rename(tmp, dest);
  console.log('DOWNLOADED', name, statSync(dest).size);
  return dest;
}

export function cacheUrl(port, name) {
  return `http://127.0.0.1:${port}/bake-cache/${name}`;
}

export function viewerUrl(port) {
  return `http://127.0.0.1:${port}/packages/model-viewer/dist/model-viewer.js`;
}

/** Constant white Radiance HDR so the trace is occlusion, not a key light. */
export async function ensureUniformHdr() {
  await mkdir(cacheDir, {recursive: true});
  const dest = join(cacheDir, 'uniform-white.hdr');
  if (existsSync(dest)) {
    return dest;
  }
  const header = Buffer.from('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 4 +X 4\n');
  const texel = Buffer.from([0x80, 0x80, 0x80, 0x81]);
  const body = Buffer.alloc(4 * 16);
  for (let i = 0; i < 16; i++) {
    texel.copy(body, i * 4);
  }
  await writeFile(dest, Buffer.concat([header, body]));
  return dest;
}

export async function prepareSceneAssets(scene) {
  const files = {model: await download(scene.model, `${scene.id}.glb`)};
  files.environment = await download(scene.environment, `${scene.id}.hdr`);
  if (scene.nightEnvironment) {
    files.night = await download(scene.nightEnvironment, `${scene.id}-night.hdr`);
  }
  if (scene.lightsModel) {
    files.lights = await download(scene.lightsModel, `${scene.id}-lights.glb`);
  }
  return files;
}

export function pageHtml(port) {
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  html, body { margin: 0; background: #d8d8d8; }
  model-viewer { width: 1280px; height: 800px; background: #d8d8d8; display: block; }
  #label { position: absolute; left: 12px; top: 12px; color: #111; background: rgba(255,255,255,.85); font: 14px/1.3 sans-serif; padding: 4px 8px; }
</style></head>
<body>
  <div id="label"></div>
  <model-viewer id="mv" bounds="tight" interaction-prompt="none" tone-mapping="neutral"
    shadow-intensity="0" camera-controls></model-viewer>
  <script type="module" src="${viewerUrl(port)}"></script>
</body></html>`;
}

export async function launchBrowser() {
  const puppeteer = await loadPuppeteer();
  const executablePath = findChrome();
  const backend = process.env.GL_BACKEND || 'gpu';
  console.log('GL_BACKEND', backend, executablePath || 'puppeteer-default');
  return puppeteer.launch({
    executablePath,
    headless: 'new',
    args: chromeArgs(backend),
  });
}

export function fileUrl(path) {
  return pathToFileURL(path).href;
}
