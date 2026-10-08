import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = await readFile(
    resolve(__dirname, '../examples/ld_water_aquila_live/index.html'), 'utf8');
const examples = await readFile(
    resolve(__dirname, '../data/examples.json'), 'utf8');

assert.match(examples, /"htmlName": "ld_water_aquila_live"/);
assert.match(
    html,
    /puzzledefault\/6f7c6_49cdcf76-f547-483d-b804-7fd1fc3b9f65\.glb/);
assert.match(html, /shadow-intensity="1"/);
assert.match(html, /shadow-softness="1"/);
assert.match(html, /ar-modes="webxr scene-viewer quick-look"/);
assert.match(html, /quick-look-browsers="safari chrome"/);
assert.match(html, /ar-placement="floor"/);
assert.match(html, /bounds="tight"/);
assert.match(html, /tone-mapping="neutral"/);
assert.match(html, /measurement-unit="mm"/);
assert.match(html, /measurement-precision="0"/);
assert.match(html, /preserve-animation-state/);
assert.match(html, /photo_studio_01_1k\.hdr/);
assert.match(html, /ao-algorithm="ssao"/);
assert.match(html, /ao-radius="7.4"/);
assert.match(html, /camera-control-mode="orbit"/);
assert.match(html, /interaction-mode="rotate"/);
assert.match(html, /0\.6503468063646036rad 1\.2467046763680913rad 14\.725606916893865m/);
assert.match(html, /-0\.02472647152503387m 0\.3m -0\.08125509455546603m/);
assert.match(html, /setCameraControlsMode\('orbit'/);
assert.match(html, /enableKeyboardMove: false/);
assert.match(html, /enableFlyMode: false/);
assert.match(html, /setCameraView\(EXTERIOR_VIEW\)/);
assert.match(html, /toggleLights\(false\)/);
assert.doesNotMatch(html, /ld-boat/);
assert.doesNotMatch(html, /water-preset/);
assert.match(html, /water-waterline', waterline/);
assert.match(html, /const WATERLINE = '0\.95'/);
assert.doesNotMatch(html, /placeLDWaterHull|ShipController|LDWaterDrive/);
assert.doesNotMatch(html, /position\.y\s*=/);
