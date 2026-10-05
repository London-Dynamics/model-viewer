import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplePath = resolve(__dirname, '../examples/ld_water/index.html');
const realScaleExamplePath =
    resolve(__dirname, '../examples/ld_water_real_scale/index.html');
const examplesDataPath = resolve(__dirname, '../data/examples.json');
const html = await readFile(examplePath, 'utf8');
const realScaleHtml = await readFile(realScaleExamplePath, 'utf8');
const examplesData = await readFile(examplesDataPath, 'utf8');

assert.match(
    examplesData,
    /"name": "LD Water"[\s\S]*"htmlName": "ld_water"/,
    'examples nav should include the standalone LD Water page');
assert.match(
    examplesData,
    /"name": "LD Water Real Scale"[\s\S]*"htmlName": "ld_water_real_scale"/,
    'examples nav should include the real-scale LD Water page');
assert.match(
    html,
    /id="water-demo"/,
    'LD Water example should include a water demo');
assert.match(
    html,
    /href="\.\.\/\.\.\/styles\/ld-examples\.css"/,
    'LD Water example should load shared minimized content styles');
assert.match(
    html,
    /<script type="importmap">/,
    'water demo should define an import map for shared Three modules');
assert.match(
    html,
    /"three\/webgpu": "\.\.\/\.\.\/\.\.\/model-viewer\/node_modules\/three\/build\/three\.webgpu\.js"/,
    'water demo should resolve three/webgpu to the model-viewer Three version');
assert.match(
    html,
    /"threejs-water-pro": "\.\.\/\.\.\/\.\.\/\.\.\/threejs-water-pro\/build\/index\.js"/,
    'water demo should resolve threejs-water-pro as a native module');
assert.match(
    html,
    /src="\.\.\/\.\.\/\.\.\/model-viewer\/dist\/model-viewer-module\.js(?:\?[^"]*)?"/,
    'water demo should import the module build so Three is shared with WebGPU water');
assert.match(
    html,
    /<div class="sample minimized-content">/,
    'LD Water example should start with Info & code minimized');
assert.match(
    html,
    /toggleAttribute\(\s*['"]water['"],\s*true\s*\)/,
    'water demo should enable LD Water after event listeners are attached');
assert.match(
    html,
    /water-preset="ld-boat"/,
    'water demo should default to the LD boat-scale water preset');
assert.match(
    html,
    /water-sky-image="\/threejs-water-pro\/demo\/public\/hdris\/industrial_sunset_02_puresky_4k\.jpg"/,
    'water demo should opt into a water sky source matching the upstream demo');
assert.match(
    html,
    /\swater-buoyancy(?:\s|>)/,
    'water demo should enable buoyancy for boat interaction testing');
assert.match(
    html,
    /shadow-intensity="0"/,
    'water demo should disable the WebGL soft-shadow path under WebGPU');
assert.match(
    html,
    /camera-orbit="45deg 65deg 160m"/,
    'water demo should match the 15x upstream reference camera distance');
assert.match(
    html,
    /camera-target="0m 1\.5m 0m"/,
    'water demo should target the boat instead of the water clipmap bounds');
assert.match(
    html,
    /min-camera-orbit="auto auto 0\.01m"/,
    'water demo should allow close camera orbit testing');
assert.match(
    html,
    /max-camera-orbit="auto auto 1000m"/,
    'water demo should allow wide camera orbit testing');
assert.match(
    html,
    /scale="15 15 15"/,
    'water demo should temporarily match the upstream demo ship scale for testing');
assert.match(
    html,
    /#061b28/,
    'water demo should provide a non-white viewport backdrop while WebGPU initializes');
assert.match(
    html,
    /id="water-preset"/,
    'water demo should expose a water preset selector');
assert.match(
    html,
    /<option value="ld-boat" selected>/,
    'water preset selector should expose the LD boat-scale preset');
for (const preset of [
  'sunset',
  'seaOfThieves',
  'storm',
  'arctic',
  'blackFlag',
  'dusk',
  'foggy',
  'moonlit',
]) {
  assert.match(
      html,
      new RegExp(`<option value="${preset}">\\s*${preset}\\s*</option>`),
      `water preset selector should expose the ${preset} preset`);
}
assert.match(
    html,
    /id="water-quality"/,
    'water demo should expose a water quality selector');
assert.match(
    html,
    /id="water-elevation"/,
    'water demo should expose water elevation control');
assert.match(
    html,
    /id="water-status-inline"/,
    'water demo should expose visible water status in the control card');
assert.match(
    html,
    /Centurion/,
    'water demo should label the Centurion model');
assert.match(
    html,
    /https:\/\/assets\.v2\.londondynamics\.com\/daa34851-84b3-4c29-8823-fc258ccd9049\/puzzle\/8561d8b0-f8a3-6ef4-241a-3f90abe64dc5\.glb/,
    'water demo should include the reachable Centurion Ri230 puzzle URL');
assert.doesNotMatch(
    html,
    /data-model=/,
    'water demo should not expose stale model toggles');
assert.doesNotMatch(
    html,
    /Astronaut|LD Car/,
    'water demo should not include the previous placeholder models');
assert.doesNotMatch(
    html,
    /water-preset[\s\S]{0,200}environment-image/,
    'water preset UI should not write environment-image');

assert.match(
    realScaleHtml,
    /id="water-real-scale-demo"/,
    'real-scale water example should include a real-scale water demo');
assert.match(
    realScaleHtml,
    /water-preset="ld-boat-real-scale"/,
    'real-scale water example should use the scale-equivalent LD preset');
assert.match(
    realScaleHtml,
    /<option\s+value="ld-boat-real-scale"\s+selected\s*>/,
    'real-scale preset selector should expose only the real-scale preset');
assert.match(
    realScaleHtml,
    /scale="1 1 1"/,
    'real-scale water example should keep the model at scale 1');
assert.match(
    realScaleHtml,
    /camera-orbit="45deg 65deg 10\.667m"/,
    'real-scale water example should divide the reference camera distance by 15');
assert.match(
    realScaleHtml,
    /camera-target="0m 0\.1m 0m"/,
    'real-scale water example should divide the reference camera target by 15');
assert.match(
    realScaleHtml,
    /min-camera-orbit="auto auto 0\.0007m"/,
    'real-scale water example should divide the close orbit limit by 15');
assert.match(
    realScaleHtml,
    /max-camera-orbit="auto auto 66\.667m"/,
    'real-scale water example should divide the wide orbit limit by 15');
assert.match(
    realScaleHtml,
    /water-elevation="-0\.053"/,
    'real-scale water example should divide the reference water elevation by 15');
assert.match(
    realScaleHtml,
    /src="\.\.\/\.\.\/\.\.\/model-viewer\/dist\/model-viewer-module\.js(?:\?[^"]*)?"/,
    'real-scale water demo should import the module build');
assert.doesNotMatch(
    realScaleHtml,
    /<option value="(?:sunset|seaOfThieves|storm|arctic|blackFlag|dusk|foggy|moonlit)"/,
    'real-scale preset selector should not expose raw upstream ocean presets');
