import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplePath = resolve(
    __dirname, '../examples/ld_ao_bloom_path_tracer/index.html');
const examplesIndexPath = resolve(__dirname, '../data/examples.json');

const html = await readFile(examplePath, 'utf8');
const examplesIndex = await readFile(examplesIndexPath, 'utf8');

const getInputAttributes = (id) => {
  const inputPattern = new RegExp(`<input\\s+[^>]*id="${id}"[^>]*>`, 's');
  const inputMatch = html.match(inputPattern);
  assert.ok(inputMatch, `${id} input should exist`);

  return Object.fromEntries(
      [...inputMatch[0].matchAll(/([a-z-]+)="([^"]*)"/g)].map(
          ([, name, value]) => [name, value]));
};

assert.match(
    html,
    /ambient-occlusion/,
    'combined verification example should enable ambient occlusion');
assert.match(
    html,
    /\sbloom(\s|>)/,
    'combined verification example should enable bloom');
assert.match(
    html,
    /path-tracer/,
    'combined verification example should enable path tracing');
assert.match(
    html,
    /setBloomTargets\(/,
    'combined verification example should configure selective bloom targets');
assert.match(
    html,
    /environment-image="https:\/\/assets\.v2\.londondynamics\.com\/00000000-0000-0000-0000-000000000000\/00000000-0000-0000-0000-000000000000\/environments\/dancing_hall_2k_desat\.hdr"/,
    'combined verification example should use the path tracer HDR for lighting');
assert.doesNotMatch(
    html,
    /skybox-image=/,
    'combined verification example should not show a skybox');
assert.doesNotMatch(
    html,
    /environment-model=/,
    'combined verification example should not include an environment model');
assert.doesNotMatch(
    html,
    /camera-orbit="-120deg 80deg auto"/,
    'combined verification example should not use the AO environment camera orbit without the environment model');
assert.match(
    html,
    /field-of-view="30deg"/,
    'combined verification example should use the working path tracer camera field of view');
assert.match(
    html,
    /id="path-tracer-samples"/,
    'combined verification example should keep the samples control');
assert.match(
    html,
    /id="path-tracer-samples-threshold"/,
    'combined verification example should keep the display threshold control');
assert.equal(
    getInputAttributes('path-tracer-samples-threshold').max,
    '64',
    'combined verification display threshold should be capped at 64 samples');
assert.match(
    html,
    /id="path-tracer-denoise-mode"/,
    'combined verification example should keep the denoise mode control');
assert.match(
    html,
    /id="server-ai-denoise-scene-description"/,
    'combined verification example should keep the scene description control');
assert.match(
    html,
    /id="rendered-samples-value"/,
    'combined verification example should show rendered path tracer samples');
assert.match(
    html,
    /pathTracerRenderedSamples/,
    'combined verification example should read the path tracer sample count');
assert.match(
    html,
    /modelViewer\.pathTracerServerAIDenoise\(/,
    'server AI denoise mode should call the model-viewer path tracer denoise workflow');
assert.match(
    html,
    /sceneDescription:\s*committedSceneDescription \|\| undefined/,
    'server AI denoise should pass the last committed optional scene description');
assert.match(
    html,
    /let committedSceneDescription = '';/,
    'scene description should be cached separately from live textarea edits');
assert.doesNotMatch(
    html,
    /serverAIDenoiseSceneDescription\.addEventListener\(\s*'input'\s*,\s*clearServerAIDenoise/s,
    'typing the scene description should not reset the denoise/path tracer state');
assert.match(
    html,
    /serverAIDenoiseSceneDescription\.addEventListener\(\s*'change'\s*,\s*commitSceneDescription/s,
    'scene description changes should be committed after blur/change');
assert.match(
    examplesIndex,
    /"htmlName":\s*"ld_ao_bloom_path_tracer"/,
    'examples index should register the combined verification page');
