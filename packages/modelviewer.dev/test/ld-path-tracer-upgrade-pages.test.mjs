import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settingsHtml = await readFile(
    resolve(root, 'examples/ld_path_tracer_settings/index.html'), 'utf8');
const upstreamHtml = await readFile(
    resolve(root, 'examples/ld_path_tracer_upstream/index.html'), 'utf8');
const upstreamPage = await readFile(
    resolve(root, 'examples/ld_path_tracer_upstream/page.js'), 'utf8');
const models = await readFile(
    resolve(root, 'examples/ld_path_tracer_upstream/models.js'), 'utf8');
const examples = JSON.parse(await readFile(
    resolve(root, 'data/examples.json'), 'utf8'));

const settingsAttributes = [
  'src',
  'environment-image',
  'skybox-image',
  'path-tracer',
  'path-tracer-samples',
  'path-tracer-samples-threshold',
  'path-tracer-bounces',
  'path-tracer-render-scale',
  'path-tracer-tiles',
  'path-tracer-depth-of-field',
  'path-tracer-focal-length',
  'path-tracer-f-stop',
  'path-tracer-focus-distance',
  'path-tracer-aperture-blades',
  'path-tracer-aperture-rotation',
  'path-tracer-anamorphic-ratio',
  'path-tracer-denoise',
  'path-tracer-denoise-sigma',
  'path-tracer-denoise-threshold',
  'path-tracer-denoise-k-sigma',
  'path-tracer-denoise-mode',
  'server-ai-denoise-aspect-ratio',
  'exposure',
  'tone-mapping',
  'environment-intensity',
  'shadow-intensity',
  'shadow-softness',
  'shadow-mode',
  'field-of-view',
  'camera-orbit',
];

for (const attribute of settingsAttributes) {
  assert.match(
      settingsHtml,
      new RegExp(attribute.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      `settings page should mention ${attribute}`);
}

assert.match(settingsHtml, /overflow:\s*hidden/);
assert.match(settingsHtml, /position:\s*fixed/);
assert.match(settingsHtml, /textContent = 'Load'/);
assert.match(settingsHtml, /event\.key === 'Enter'/);
assert.match(settingsHtml, /URLSearchParams/);
assert.match(settingsHtml, /resetPathTracer/);
assert.match(settingsHtml, /pathTracerRenderedSamples/);
assert.match(settingsHtml, /setPathTracerOptions/);
assert.match(settingsHtml, /Start trace/);
assert.match(settingsHtml, /Stop trace/);
assert.match(settingsHtml, /Reset trace/);
assert.match(settingsHtml, /<aside class="settings-bar"/);
assert.ok(
    settingsHtml.indexOf('<model-viewer') < settingsHtml.indexOf('<aside'),
    'model-viewer should come before the right-hand sidebar');

const settingsEntry = examples.find(
    (entry) => entry.htmlName === 'ld_path_tracer_settings');
const upstreamEntry = examples.find(
    (entry) => entry.htmlName === 'ld_path_tracer_upstream');
assert.ok(settingsEntry, 'examples.json should list the settings page');
assert.ok(upstreamEntry, 'examples.json should list the upstream page');

const upstreamControls = [
  'enable',
  'pause',
  'maxBounces',
  'renderScale',
  'frameBudget',
  'maxSamples',
  'multipleImportanceSampling',
  'randomStrategy',
  'cameraProjection',
  'denoise',
  'upscale',
  'sharpness',
  'bokehSize',
  'focusDistance',
  'environment',
  'stage',
  'background',
  'lighting',
];
for (const name of upstreamControls) {
  assert.match(upstreamPage, new RegExp(`\\b${name}\\b`), name);
}

for (const reason of [
  'WebGPUPathTracer',
  'OIDN',
  'Orthographic',
  'Rect area light',
  'shadow catcher',
  'unit sphere',
]) {
  const haystack = `${upstreamPage}\n${upstreamHtml}`;
  assert.ok(haystack.includes(reason), `missing note: ${reason}`);
}

assert.match(upstreamHtml, /gkjohnson\.github\.io\/three-gpu-pathtracer/);
assert.match(`${upstreamPage}\n${upstreamHtml}`, /tone-mapping/);
assert.match(models, /NASA JPL M2020 Rover/);
assert.match(models, /Perseverance\.glb/);
assert.match(models, /\.dae/);
assert.match(models, /\.mpd/);
assert.doesNotMatch(models, /postProcess\s*\(/);
assert.equal(
    (models.match(/"url":/g) || []).length,
    47,
    'upstream model list should keep all 47 demo models');
