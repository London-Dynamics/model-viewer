import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplePath = resolve(
    __dirname, '../examples/ld_path_tracer/index.html');
const serverAIDenoiseFeaturePath = resolve(
    __dirname, '../../model-viewer/src/features/ld-server-ai-denoise.ts');
const serverAIDenoiseCompiledFeaturePath = resolve(
    __dirname, '../../model-viewer/lib/features/ld-server-ai-denoise.js');
const pathTracerComposerPath = resolve(
    __dirname,
    '../../model-viewer/src/three-components/postprocessing/ld-path-tracer/LDPathTracerComposer.ts');
const html = await readFile(examplePath, 'utf8');
const serverAIDenoiseFeature =
    await readFile(serverAIDenoiseFeaturePath, 'utf8');
const serverAIDenoiseCompiledFeature =
    await readFile(serverAIDenoiseCompiledFeaturePath, 'utf8');
const pathTracerComposer = await readFile(pathTracerComposerPath, 'utf8');

const getInputAttributes = (id) => {
  const inputPattern = new RegExp(
      `<input\\s+[^>]*id="${id}"[^>]*>`, 's');
  const inputMatch = html.match(inputPattern);
  assert.ok(inputMatch, `${id} input should exist`);

  return Object.fromEntries(
      [...inputMatch[0].matchAll(/([a-z-]+)="([^"]*)"/g)].map(
          ([, name, value]) => [name, value]));
};

const assertDefaultValueSatisfiesNumberConstraints = (id) => {
  const attributes = getInputAttributes(id);
  const value = Number(attributes.value);
  const min = attributes.min == null ? undefined : Number(attributes.min);
  const step = attributes.step == null ? 1 : attributes.step;

  assert.ok(Number.isFinite(value), `${id} should have a numeric default`);
  if (min != null) {
    assert.ok(value >= min, `${id} default should be at least its minimum`);
  }
  if (step !== 'any') {
    const stepValue = Number(step);
    const stepBase = min ?? 0;
    const stepCount = (value - stepBase) / stepValue;
    assert.ok(
        Math.abs(stepCount - Math.round(stepCount)) < 1e-8,
        `${id} default should satisfy its step constraint`);
  }
};

assert.match(
    html,
    /id="path-tracer-shadow-intensity"/,
    'path tracer example should expose soft-shadow intensity control');
assert.match(
    html,
    /id="path-tracer-shadow-softness"/,
    'path tracer example should expose soft-shadow softness control');
assert.match(
    html,
    /setAttribute\(\s*['"]shadow-intensity['"]/,
    'soft-shadow intensity control should update shadow-intensity');
assert.match(
    html,
    /setAttribute\(\s*['"]shadow-softness['"]/,
    'soft-shadow softness control should update shadow-softness');
assert.match(
    html,
    /id="path-tracer-aspect-ratio"/,
    'path tracer example should expose an aspect-ratio selector');
assert.match(
    html,
    /<option value="free"[^>]*>Free<\/option>/,
    'aspect-ratio selector should include free sizing');
assert.match(
    html,
    /<option value="1 \/ 1"[^>]*>1:1<\/option>/,
    'aspect-ratio selector should include 1:1 sizing');
assert.match(
    html,
    /<option value="16 \/ 9"[^>]*>16:9<\/option>/,
    'aspect-ratio selector should include 16:9 sizing');
assert.match(
    html,
    /<option value="4 \/ 3"[^>]*>4:3<\/option>/,
    'aspect-ratio selector should include 4:3 sizing');
assert.match(
    html,
    /<option value="centurion"[^>]*>Centurion<\/option>/,
    'test case selector should include the Centurion model');
assert.match(
    html,
    /<option value="southbay"[^>]*>Southbay<\/option>/,
    'test case selector should include the Southbay model');
assert.match(
    html,
    /<option value="car"[^>]*selected[^>]*>Car<\/option>/,
    'test case selector should default to the car model');
assert.match(
    html,
    /DEFAULT_TEST_CASE = TEST_CASES\.car/,
    'path tracer example should initialize with the car test case');
assert.match(
    html,
    /centurion:\s*\{[\s\S]*modelSrc:\s*['"]https:\/\/assets\.v2\.londondynamics\.com\/daa34851-84b3-4c29-8823-fc258ccd9049\/puzzle\/6af0a537-d743-58be-c09d-8adcc9da0bd2\.glb['"]/,
    'Centurion test case should use the requested GLB');
assert.match(
    html,
    /southbay:\s*\{[\s\S]*modelSrc:\s*['"]https:\/\/assets\.v2\.londondynamics\.com\/63f6e242-8f0e-4e8d-9362-ff0fd7cea4bb\/puzzle\/4094cca3-32f4-249b-b30f-90725cce1347\.glb['"][\s\S]*environmentImage:\s*['"]https:\/\/assets\.v2\.londondynamics\.com\/00000000-0000-0000-0000-000000000000\/00000000-0000-0000-0000-000000000000\/environments\/dancing_hall_2k_desat\.hdr['"]/,
    'Southbay test case should use the requested GLB and HDR');
assert.match(
    html,
    /id="path-tracer-save-image"/,
    'path tracer example should expose a save image button');
assert.match(
    html,
    /class="ld-path-tracer-export-overlay"/,
    'export controls should sit in a top-left viewer overlay');
assert.match(
    html,
    /width:\s*auto;/,
    'save image button should use automatic content width');
assert.doesNotMatch(
    html,
    /min-width:\s*8rem;/,
    'save image button should not force a large minimum width');
assert.match(
    html,
    /modelViewer\.toBlob\(\s*\{\s*mimeType:\s*['"]image\/png['"]/,
    'save image button should export the current model-viewer pass as a png blob');
assert.match(
    html,
    /fillStyle = ['"]white['"]/,
    'save image button should composite transparent pixels over the visible white background');
assert.match(
    html,
    /drawImage\(image,\s*0,\s*0\)/,
    'save image button should draw the current pass onto the export canvas');
assert.doesNotMatch(
    html,
    /canvas\.toBlob\(/,
    'save image button should not export the raw WebGL canvas directly');
assert.match(
    html,
    /download = ['"]model-viewer-path-tracer\.png['"]/,
    'save image button should download a png file');
assert.match(
    html,
    /id="path-tracer-denoise-mode"/,
    'path tracer example should expose a denoise mode selector');
assert.match(
    html,
    /id="server-ai-denoise-scene-description"/,
    'path tracer example should expose a server AI scene description field');
assert.match(
    html,
    /sceneDescription:\s*sceneDescription \|\| undefined/,
    'server AI denoise should pass the optional scene description to model-viewer');
assertDefaultValueSatisfiesNumberConstraints('path-tracer-denoise-sigma');
assertDefaultValueSatisfiesNumberConstraints('path-tracer-focus-distance');
assertDefaultValueSatisfiesNumberConstraints('path-tracer-denoise-threshold');
assert.equal(
    getInputAttributes('path-tracer-fov').value,
    '30',
    'path tracer example should default FOV to 30 degrees');
assert.match(
    html,
    /id="fov-value">30<\/span>/,
    'path tracer example should display 30 as the default FOV');
assert.match(
    html,
    /field-of-view="30deg"/,
    'path tracer example should initialize model-viewer with 30 degree FOV');
assert.match(
    html,
    /none:\s*\{[\s\S]*fov:\s*30/,
    'default camera preset should use 30 degree FOV');
assert.match(
    html,
    /path-tracer-samples="32"/,
    'path tracer example should default to 32 target samples');
assert.match(
    html,
    /path-tracer-samples-threshold="6"/,
    'path tracer example should default to 6 display-threshold samples');
assert.match(
    html,
    /id="samples-value"[\s\S]*>32<\/span/,
    'samples value label should default to 32');
assert.match(
    html,
    /id="path-tracer-samples"[\s\S]*value="32"/,
    'samples slider should default to 32');
assert.match(
    html,
    /id="samples-threshold-value"[\s\S]*>6<\/span/,
    'display threshold value label should default to 6');
assert.match(
    html,
    /id="path-tracer-samples-threshold"[\s\S]*value="6"/,
    'display threshold slider should default to 6');
assert.equal(
    getInputAttributes('path-tracer-samples-threshold').max,
    '64',
    'display threshold slider should be capped at 64 samples');
assert.match(
    html,
    /<option value="off"[^>]*>Off<\/option>/,
    'denoise mode selector should include off mode');
assert.match(
    html,
    /<option value="gpu"[^>]*>GPU<\/option>/,
    'denoise mode selector should include built-in GPU mode');
assert.match(
    html,
    /<option value="server-ai"[^>]*>Server AI<\/option>/,
    'denoise mode selector should include server AI mode');
assert.match(
    html,
    /id="server-ai-denoise-overlay"/,
    'path tracer example should include an overlay for server AI denoise results');
assert.match(
    html,
    /\.server-ai-denoise-overlay[\s\S]*opacity:\s*0[\s\S]*transition:\s*opacity 0\.6s/,
    'server AI denoise overlay should fade in over 0.6 seconds');
assert.match(
    html,
    /\.server-ai-denoise-overlay-visible[\s\S]*opacity:\s*1/,
    'server AI denoise overlay should have a visible fade-in state');
assert.match(
    html,
    /serverAIDenoiseOverlay\.classList\.add\(\s*['"]server-ai-denoise-overlay-visible['"]\s*\)/,
    'server AI denoise should fade in the returned overlay image');
assert.match(
    html,
    /serverAIDenoiseOverlay\.hidden = false;[\s\S]*await waitFrame\(\);[\s\S]*serverAIDenoiseOverlay\.classList\.add\(\s*['"]server-ai-denoise-overlay-visible['"]\s*\)/,
    'server AI denoise should paint the transparent overlay before starting the fade');
assert.match(
    html,
    /id="server-ai-denoise-status"/,
    'path tracer example should show server AI denoise status');
assert.match(
    html,
    /modelViewer\.pathTracerServerAIDenoise\(/,
    'server AI denoise mode should call the model-viewer path tracer helper');
assert.match(
    html,
    /samples:\s*serverAIDenoiseTargetSamples/,
    'server AI denoise should pass the user sample target to model-viewer');
assert.match(
    html,
    /serverAIDenoiseTargetSamples/,
    'server AI denoise should track the user target sample count');
assert.match(
    html,
    /serverAIDenoiseSavedSamplesTarget\s*==\s*null/,
    'server AI denoise should preserve the user sample target before core workflow updates it');
assert.match(
    html,
    /applyServerAIAspectRatio\(\)/,
    'server AI denoise should pass aspect-ratio intent to model-viewer');
assert.match(
    html,
    /server-ai-denoise-aspect-ratio/,
    'server AI denoise should configure the core aspect-ratio attribute');
assert.match(
    html,
    /path-tracer-samples-threshold/,
    'display threshold should remain configured separately from server AI target samples');
assert.match(
    html,
    /Waiting for \$\{serverAIDenoiseTargetSamples\} path traced samples/s,
    'server AI status should wait for target samples, not display threshold samples');
assert.match(
    html,
    /if \(\s*!serverAIDenoiseOverlay\.hidden\s*\) {\s*return;\s*}/s,
    'server AI polling should stop once the returned image overlay is visible');
assert.match(
    html,
    /setAttribute\(\s*['"]path-tracer-denoise-mode['"]/,
    'denoise mode selector should configure the model-viewer denoise mode');
assert.match(
    html,
    /pauseServerAISampling\(\)/,
    'server AI denoise should pause path tracer sampling after the overlay is showing');
assert.match(
    html,
    /restoreServerAISamplingTarget\(\)/,
    'server AI denoise should restore the user sample target when cleared');
assert.match(
    html,
    /Showing server denoised image; sampling paused/,
    'server AI denoise should report when the returned image is displayed');
assert.match(
    html,
    /Server AI failed: \$\{error\.message/,
    'server AI denoise should surface the provider failure message in the UI');
assert.match(
    html,
    /handleServerAICameraChange = \(event\) =>/,
    'server AI denoise should handle camera changes explicitly');
assert.match(
    html,
    /event\.detail\?\.source !== ['"]user-interaction['"]/,
    'server AI denoise should ignore automatic camera-change resets');
assert.match(
    html,
    /String\(\s*Math\.floor\(\s*Number\(\s*modelViewer\.pathTracerRenderedSamples \|\| 0\s*\)\s*\)\s*\)/s,
    'performance overlay should display integer sample counts');
assert.match(
    html,
    /String\(\s*Number\(\s*serverAIDenoiseSavedSamplesTarget\s*\?\?\s*samples\.value/s,
    'performance overlay should display the user target sample count while server AI is in flight');
assert.doesNotMatch(
    html,
    /label: ['"]Samples['"],\s*rate: true/s,
    'performance overlay should not show samples as a rate');

assert.match(
    serverAIDenoiseFeature,
    /serverAIDenoise\(/,
    'model-viewer should expose a serverAIDenoise helper');
assert.match(
    serverAIDenoiseFeature,
    /DEFAULT_ENDPOINT =\s*['"]https:\/\/ld-server-ai-denoise\.fly\.dev\/api\/server-ai-denoise['"]/,
    'serverAIDenoise should default to the hosted proxy endpoint');
assert.match(
    serverAIDenoiseCompiledFeature,
    /DEFAULT_ENDPOINT =\s*['"]https:\/\/ld-server-ai-denoise\.fly\.dev\/api\/server-ai-denoise['"]/,
    'compiled serverAIDenoise should default to the hosted proxy endpoint');
assert.doesNotMatch(
    serverAIDenoiseCompiledFeature,
    /localhost:3001/,
    'compiled serverAIDenoise should not call the local proxy by default');
assert.match(
    serverAIDenoiseFeature,
    /captureServerAIDenoiseImage/,
    'serverAIDenoise should capture through the shared denoise capture helper');
assert.match(
    serverAIDenoiseFeature,
    /fetch\(\s*endpoint/,
    'serverAIDenoise should post to the configured proxy endpoint');
assert.match(
    serverAIDenoiseFeature,
    /sceneDescription\?: string/,
    'serverAIDenoise should accept an optional scene description');
assert.match(
    serverAIDenoiseFeature,
    /body\.sceneDescription = sceneDescription/,
    'serverAIDenoise should include scene description in the request body');
assert.doesNotMatch(
    serverAIDenoiseFeature,
    /Clean up this noisy 3D render/,
    'serverAIDenoise should not include the server-owned prompt');

assert.match(
    pathTracerComposer,
    /samples:\s*32,/,
    'path tracer feature should default to 32 target samples');
assert.match(
    pathTracerComposer,
    /samplesThreshold:\s*6,/,
    'path tracer feature should default to 6 display-threshold samples');
