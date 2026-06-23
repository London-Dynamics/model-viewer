import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplePath = resolve(__dirname, '../examples/ld_car_demo/index.html');
const examplesDataPath = resolve(__dirname, '../data/examples.json');
const html = await readFile(examplePath, 'utf8');
const examplesData = JSON.parse(await readFile(examplesDataPath, 'utf8'));

const ASSETS_DOMAIN = 'https://assets.v2.londondynamics.com';
const MODEL_URL =
    '/5d9cfb30-10b4-4dd5-acab-27b5c51a61ea/00000000-0000-0000-0000-000000000000/HyundaiTucson.glb';
const ENVIRONMENT_URL =
    '/5d9cfb30-10b4-4dd5-acab-27b5c51a61ea/00000000-0000-0000-0000-000000000000/kloofendal_48d_partly_cloudy_puresky_4k.hdr';
const ENVIRONMENT_MODEL_URL =
    '/5d9cfb30-10b4-4dd5-acab-27b5c51a61ea/00000000-0000-0000-0000-000000000000/RealtimeCarTestE.glb';
const CAMERA_ORBIT =
    '0.9609756653494315rad 1.4053326396662438rad 7.625152037677848m';
const CAMERA_TARGET =
    '-0.08094152107454246m 0.6377577752587238m -0.035090749457932446m';

assert.match(html, /<title>&lt;model-viewer&gt; Car Demo<\/title>/);
assert.match(html, /<span class="font-medium">Car Demo<\/span>/);
assert.match(html, /id="car-demo"/, 'Car Demo snippet host should exist');
assert.match(
    html, /id="car-demo-viewer"/, 'Car Demo model-viewer should exist');
assert.match(
    html,
    new RegExp(`const ASSETS_DOMAIN = ['"]${ASSETS_DOMAIN}['"]`),
    'Car Demo should define the shared examples asset domain');

for (const [id, value] of [
  ['car-demo-model-url', MODEL_URL],
  ['car-demo-environment-url', ENVIRONMENT_URL],
  ['car-demo-skybox-url', ENVIRONMENT_URL],
  ['car-demo-environment-model-url', ENVIRONMENT_MODEL_URL],
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} input should exist`);
  assert.match(
      html,
      new RegExp(`id="${id}"[\\s\\S]*value="${value}"`),
      `${id} should default to the requested asset URL`);
}

for (const [attribute, value] of [
  ['src', `${ASSETS_DOMAIN}${MODEL_URL}`],
  ['environment-image', `${ASSETS_DOMAIN}${ENVIRONMENT_URL}`],
  ['skybox-image', `${ASSETS_DOMAIN}${ENVIRONMENT_URL}`],
  ['environment-model', `${ASSETS_DOMAIN}${ENVIRONMENT_MODEL_URL}`],
  ['environment-model-position', '0m 0m 0m'],
  ['environment-model-orientation', '0deg 0deg 0deg'],
  ['environment-model-scale', '1 1 1'],
  ['camera-orbit', CAMERA_ORBIT],
  ['camera-target', CAMERA_TARGET],
]) {
  assert.match(
      html,
      new RegExp(`${attribute}="${value}"`),
      `${attribute} should use the requested default asset`);
}

assert.match(
    html,
    /<details[\s\S]*class="ld-environment-advanced-section"[\s\S]*id="car-demo-url-section"[\s\S]*>/,
    'URL controls should be in a collapsed details section');
assert.match(
    html,
    /<details[\s\S]*class="ld-environment-advanced-section"[\s\S]*id="car-demo-environment-section"[\s\S]*>/,
    'environment controls should be in a collapsed details section');
assert.match(
    html,
    /<details[\s\S]*class="ld-environment-advanced-section"[\s\S]*id="car-demo-bloom-section"[\s\S]*>/,
    'bloom controls should be in a collapsed details section');
assert.match(
    html,
    /<details[\s\S]*class="ld-environment-advanced-section"[\s\S]*id="car-demo-soft-shadow-section"[\s\S]*>/,
    'soft shadow controls should be in a collapsed details section');
assert.match(
    html,
    /\.ld-environment-controls form \{[\s\S]*max-height:\s*min\(42vh,\s*28rem\);[\s\S]*overflow-y:\s*auto;[\s\S]*overscroll-behavior:\s*contain;/,
    'expanded controls should scroll inside a bounded panel instead of covering the scene');

for (const id of [
  'car-demo-exposure',
  'car-demo-skybox-rotation',
  'car-demo-skybox-rotation-axis',
  'car-demo-skybox-rotation-speed',
  'car-demo-skybox-rotation-animation',
  'car-demo-environment-model-position',
  'car-demo-environment-model-orientation',
  'car-demo-environment-model-scale',
  'car-demo-shadow-intensity',
  'car-demo-shadow-softness',
  'car-demo-bloom-enabled',
  'car-demo-bloom-mode',
  'car-demo-bloom-quality',
  'car-demo-bloom-strength',
  'car-demo-bloom-radius',
  'car-demo-bloom-threshold',
  'car-demo-bloom-msaa',
  'car-demo-bloom-target-rows',
  'car-demo-add-bloom-target',
  'car-demo-scene-names',
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} control should exist`);
}

assert.match(
    html,
    /const DEFAULT_BLOOM_TARGETS = \[[\s\S]*kind: ['"]mesh['"],[\s\S]*name: ['"]DotFrontLights['"],[\s\S]*color: ['"]#ffffff['"],[\s\S]*name: ['"]DotFrontLights_\(1\)['"],[\s\S]*name: ['"]DotFrontLights_\(2\)['"],[\s\S]*name: ['"]DotLights['"],[\s\S]*name: ['"]SideHeadlightReflector['"],[\s\S]*color: ['"]#ffffff['"],[\s\S]*name: ['"]RedRearStopLight['"],[\s\S]*color: ['"]#ff0000['"],[\s\S]*name: ['"]RefReflector2['"],[\s\S]*name: ['"]RedTailLightReflector3['"],[\s\S]*name: ['"]RedTailLightReflector['"]/,
    'Car Demo should define editable default bloom targets');
assert.match(
    html,
    /const renderBloomTargetRow = \(target, index\) => \{/,
    'Car Demo should render bloom target rows');
assert.match(
    html,
    /const addBloomTarget = \(\) => \{/,
    'Car Demo should allow adding bloom targets');
assert.match(
    html,
    /targetRows\.addEventListener\(['"]input['"]/,
    'Car Demo should update bloom targets when row values change');
assert.match(
    html,
    /targetRows\.addEventListener\(['"]click['"]/,
    'Car Demo should allow removing bloom targets');
assert.match(
    html,
    /modelViewer\.setBloomTargets\([\s\S]*bloomTargets[\s\S]*\.map/,
    'Car Demo should apply editable bloom targets');
assert.match(
    html,
    /\[target\.kind\]: target\.name/,
    'Car Demo should support assigning bloom by mesh or material name');
assert.match(
    html,
    /modelViewer\.getSceneNames\(\)/,
    'Car Demo should inspect available mesh and material names');
assert.match(
    html,
    /sceneNamesTextarea\.value = `OBJECTS/,
    'Car Demo should dump available object and material names');
assert.match(
    html,
    /modelViewer\.setAttribute\(\s*['"]environment-model-position['"],\s*environmentModelPositionInput\.value\s*\)/,
    'environment model position control should update environment-model-position');
assert.match(
    html,
    /modelViewer\.setAttribute\(\s*['"]environment-model-orientation['"],\s*environmentModelOrientationInput\.value\s*\)/,
    'environment model orientation control should update environment-model-orientation');
assert.match(
    html,
    /modelViewer\.setAttribute\(\s*['"]environment-model-scale['"],\s*environmentModelScaleInput\.value\s*\)/,
    'environment model scale control should update environment-model-scale');
assert.match(
    html,
    /modelViewer\.setAttribute\(\s*['"]shadow-intensity['"],\s*shadowIntensityInput\.value\s*\)/,
    'shadow intensity control should update shadow-intensity');
assert.match(
    html,
    /modelViewer\.setAttribute\(\s*['"]shadow-softness['"],\s*shadowSoftnessInput\.value\s*\)/,
    'shadow softness control should update shadow-softness');

assert.match(
    html,
    /const URL_STORAGE_KEY = ['"]ld-car-demo-url-controls['"]/,
    'Car Demo should use a stable localStorage key for URL controls');
assert.match(
    html,
    /const SETTINGS_STORAGE_KEY =[\s\S]*['"]ld-car-demo-settings-controls-v2['"]/,
    'Car Demo should use a stable localStorage key for environment and bloom controls');
assert.match(
    html,
    /localStorage\.getItem\(URL_STORAGE_KEY\)/,
    'Car Demo should restore saved URL controls on load');
assert.match(
    html,
    /localStorage\.getItem\(SETTINGS_STORAGE_KEY\)/,
    'Car Demo should restore saved advanced controls on load');
assert.match(
    html,
    /localStorage\.setItem\(\s*URL_STORAGE_KEY,\s*JSON\.stringify/,
    'Car Demo should save URL controls when updating the scene');
assert.match(
    html,
    /localStorage\.setItem\(\s*SETTINGS_STORAGE_KEY,\s*JSON\.stringify/,
    'Car Demo should save advanced controls when values change');
assert.match(
    html,
    /bloomTargets: bloomTargets\.map/,
    'Car Demo should persist editable bloom targets with settings');
assert.match(
    html,
    /new URLSearchParams\([\s\S]*window\.location\.search[\s\S]*\)\.has\(['"]camera-setup['"]\)/,
    'Car Demo should expose camera setup mode through a query parameter');
assert.match(
    html,
    /modelViewer\.getCameraOrbit\(\)/,
    'Car Demo camera setup mode should read the current camera orbit');
assert.match(
    html,
    /modelViewer\.getCameraTarget\(\)/,
    'Car Demo camera setup mode should fall back to the public camera target');
assert.match(
    html,
    /modelViewer\.getCameraJSON\(\)/,
    'Car Demo camera setup mode should read LD CameraControls target data');
assert.match(
    html,
    /cameraJsonObject\?\.target/,
    'Car Demo camera setup mode should prefer the target updated by panning');
assert.match(
    html,
    /targetSource/,
    'Car Demo camera setup mode should report which target source is used');
assert.match(
    html,
    /cameraJsonObject\?\.position/,
    'Car Demo camera setup mode should expose camera JSON position for debugging');
assert.match(
    html,
    /requestAnimationFrame\(\s*updateCameraReadoutNow/,
    'Car Demo camera setup mode should sample the camera after camera-change updates settle');
assert.match(
    html,
    /\[car-demo-camera\] camera-orbit=/,
    'Car Demo camera setup mode should log camera values as readable text');

const carDemoEntry = examplesData.find(
    (entry) => entry.name === 'Car Demo' && entry.htmlName === 'ld_car_demo');
assert.ok(carDemoEntry, 'Car Demo should be registered in examples.json');
assert.deepEqual(carDemoEntry.examples, [
  {
    htmlId: 'car-demo',
    name: 'Car Demo',
  },
]);
