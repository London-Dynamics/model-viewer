import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplePath = resolve(
    __dirname, '../examples/ld_camera_controls_animation/index.html');
const registryPath = resolve(__dirname, '../data/examples.json');

const html = await readFile(examplePath, 'utf8');
const registry = JSON.parse(await readFile(registryPath, 'utf8'));

assert.match(
    html,
    /<title>&lt;model-viewer&gt; LD Camera Controls &amp; Animation<\/title>/,
    'example should have the LD Camera Controls & Animation title');
assert.match(
    html,
    /LD_Car1\.glb/,
    'example should use the same car asset as the LD AO bloom environment');
assert.match(
    html,
    /environment-model-position="0m 0m 0m"[\s\S]*environment-model-orientation="0deg 0deg 0deg"[\s\S]*environment-model-scale="1 1 1"/,
    'example should use the same environment model transform as LD AO bloom environment');
assert.match(
    html,
    /camera-control-mode="orbit"/,
    'example should launch declaratively in orbit control mode');
assert.match(
    html,
    /camera-target="0m 0\.45m 0m"/,
    'example should set a camera target without offsetting the environment model');
assert.match(
    html,
    /fps-look-sensitivity="0\.5"/,
    'example should declare reduced FPS mouse look sensitivity');
assert.match(
    html,
    /fps-move-sensitivity="0\.3"/,
    'example should declare reduced FPS keyboard movement sensitivity');
assert.match(
    html,
    /href="\.\.\/\.\.\/styles\/ld-examples\.css"/,
    'example should load LD examples styles for minimized info/code panels');
assert.match(
    html,
    /class="sample minimized-content"/,
    'example should start with the info/code panel minimized');
assert.match(
    html,
    /class="content-toggle"[\s\S]*aria-expanded="false"[\s\S]*Info & code/,
    'example should expose the Info & code toggle');
assert.match(
    html,
    /sample\.classList\.toggle\('content-expanded'\)/,
    'example toggle should expand and collapse the info/code panel');

for (const id of [
  'camera-outside-1-orbit',
  'camera-outside-2-orbit',
  'camera-inside-fps',
  'camera-override-fps',
  'camera-toggle-animation',
  'camera-save-outside-1',
  'camera-save-outside-2',
  'camera-save-inside',
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} button should exist`);
}

assert.match(
    html,
    /Outside 1, Orbit/,
    'front orbit button should be renamed to Outside 1, Orbit');
assert.match(
    html,
    /Outside 2, Orbit/,
    'example should expose an Outside 2 orbit button');
assert.match(
    html,
    /Override/,
    'example should expose an Override button');

assert.match(
    html,
    /outside1:\s*\{[\s\S]*controlMode:\s*['"]orbit['"]/,
    'outside 1 slot should define an orbit view');
assert.match(
    html,
    /outside2:\s*\{[\s\S]*controlMode:\s*['"]orbit['"]/,
    'outside 2 slot should define an orbit view');
assert.match(
    html,
    /inside:\s*\{[\s\S]*controlMode:\s*['"]fps['"]/,
    'inside slot should define an FPS view');
assert.match(
    html,
    /setCameraView\(cameraSlots\.outside1\)/,
    'outside 1 button should use the mutable outside 1 slot');
assert.match(
    html,
    /setCameraView\(cameraSlots\.outside2\)/,
    'outside 2 button should use the mutable outside 2 slot');
assert.match(
    html,
    /setCameraView\(cameraSlots\.inside\)/,
    'inside button should use the mutable inside slot');
assert.match(
    html,
    /enableKeyboardMove:\s*true[\s\S]*enableFlyMode:\s*true/,
    'override should enable FPS keyboard movement and fly mode');
assert.match(
    html,
    /animateCameraTo\([\s\S]*duration:\s*1500[\s\S]*easing:\s*['"]easeInOutQuad['"][\s\S]*avoidSubject:\s*true/,
    'toggle button should animate for 1500ms with easing and avoid subject');
assert.match(
    html,
    /const saveCameraSlot = \(slotName\) => \{/,
    'example should provide a camera slot save helper');
assert.match(
    html,
    /console\.log\([\s\S]*`LD Camera \$\{slotName\}`,[\s\S]*JSON\.stringify\(cameraSlots\[slotName\],\s*null,\s*2\)/,
    'saving a slot should log the captured camera payload as JSON');

const page = registry.find((entry) => entry.htmlName === 'ld_camera_controls_animation');
assert.ok(page, 'example registry should include ld_camera_controls_animation');
assert.equal(page.name, 'LD Camera Controls & Animation');
assert.deepEqual(page.examples, [
  {
    htmlId: 'camera-controls-animation',
    name: 'Camera Controls & Animation',
  },
]);
