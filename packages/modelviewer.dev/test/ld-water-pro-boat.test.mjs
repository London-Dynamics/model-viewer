import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {readFileSync} from 'node:fs';

import {
  CENTURION_RI230_BOUNDS,
  CENTURION_RI245_BOUNDS,
  CENTURION_RI245_GLB,
  CENTURION_RI245_SKU,
  CENTURION_RI245_WINDSHIELD,
  DEMO_BOAT_SCALE,
  boundsSize,
  centurionDemoPlacement,
  demoParentPoint,
  hdriForTime,
  lakeLook,
} from '../examples/ld_water_pro/boat-placement.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = await readFile(
    resolve(__dirname, '../examples/ld_water_pro/index.html'), 'utf8');
const demoJs = readFileSync(
    resolve(__dirname, '../examples/ld_water_pro/water-pro-demo.js'), 'utf8');
const examplesData = await readFile(
    resolve(__dirname, '../data/examples.json'), 'utf8');

const size = boundsSize(CENTURION_RI230_BOUNDS);
assert.ok(Math.abs(size.length - 7.563) < 0.01, 'Ri230 length is about 7.56 m on X');
assert.ok(Math.abs(size.beam - 2.971) < 0.001, 'Ri230 beam matches the 2.971 m water sample width');
assert.ok(size.length > size.beam, 'length axis is longer than the beam');

const placement = centurionDemoPlacement();
assert.equal(placement.scale, DEMO_BOAT_SCALE);
assert.equal(placement.yaw, -Math.PI / 2);
assert.ok(
    Math.abs(placement.worldLength - size.length * 15) < 0.001,
    'demo scale multiplies real length by 15');
assert.ok(placement.buoyancy.sampleLength > 90, 'buoyancy spans the scaled hull, not the 7.6 m sample');
assert.ok(
    placement.buoyancy.sampleLength < placement.worldLength,
    'bow and stern samples sit inboard of the AABB tips');
assert.ok(
    placement.buoyancy.sampleWidth < placement.worldBeam &&
        placement.buoyancy.sampleWidth > placement.worldBeam * 0.7,
    'beam samples use the scaled beam');
assert.equal(placement.buoyancy.heightOffset, 0);

const origin = demoParentPoint([0, 0, 0], placement);
assert.ok(Math.abs(origin[1]) < 1e-6, 'glTF origin stays on the waterline');
const center = demoParentPoint(size.center, placement);
assert.ok(Math.abs(center[0]) < 1e-6, 'hull centre X is on the parent origin');
assert.ok(Math.abs(center[2]) < 1e-6, 'hull centre Z is on the parent origin');
const bow = demoParentPoint([CENTURION_RI230_BOUNDS.max[0], 0, 0], placement);
const stern = demoParentPoint([CENTURION_RI230_BOUNDS.min[0], 0, 0], placement);
assert.ok(bow[2] > stern[2], 'bow +X maps to +Z, the water-pro forward axis');
assert.ok(
    Math.abs((bow[2] - stern[2]) - placement.worldLength) < 1e-6,
    'bow-to-stern span is the scaled length');

const sunset = {
  clipmap: {baseSize: 800},
  fog: {color: '#e0b48a'},
  color: {waterColor: '#061b28', transmissionColor: '#50a890'},
  sky: {sun: {elevation: 14, azimuth: 91, diskColor: '#e6b5b2'}},
  waves: {
    fft: {
      amplitude: 1.56,
      windSpeed: 17.9,
      cascades: {ripples: {scale: 379}, waves: {scale: 2088}},
    },
    gerstner: {wavelength: 852, amplitude: 2.06},
  },
};

const light = lakeLook(sunset, {time: 'sunset', sea: 'light'});
assert.equal(light.waves.gerstner.wavelength, 852);
assert.equal(light.waves.fft.cascades.ripples.scale, 379);
assert.equal(light.waves.fft.cascades.waves.scale, 2088);
assert.equal(light.clipmap.baseSize, 800);
assert.equal(light.waves.fft.amplitude, 1.56);
assert.equal(light.waves.gerstner.amplitude, 2.06);
assert.equal(light.waves.fft.windSpeed, 17.9);

const calm = lakeLook(sunset, {time: 'sunset', sea: 'calm'});
assert.equal(calm.waves.gerstner.wavelength, 852);
assert.equal(calm.clipmap.baseSize, 800);
assert.ok(Math.abs(calm.waves.gerstner.amplitude - 2.06 * 0.28) < 1e-9);
assert.ok(Math.abs(calm.waves.fft.amplitude - 1.56 * 0.28) < 1e-9);
assert.equal(calm.waves.fft.windSpeed, 6);
assert.equal(calm.sky.sun.elevation, 14);

const midday = lakeLook(sunset, {time: 'midday', sea: 'light'});
assert.equal(midday.waves.gerstner.wavelength, 852);
assert.equal(midday.sky.sun.elevation, 58);
assert.equal(midday.fog.color, '#d7e6f0');
assert.notEqual(midday.color.waterColor, sunset.color.waterColor);

assert.equal(hdriForTime('sunset').includes('industrial_sunset'), true);
assert.equal(hdriForTime('midday').includes('kloofendal_43d_clear'), true);

assert.match(examplesData, /"htmlName": "ld_water_pro"/);
assert.match(html, /id="water-pro-canvas"/);
const ri245 = boundsSize(CENTURION_RI245_BOUNDS);
assert.ok(Math.abs(ri245.length - 8.232) < 0.01, 'Ri245 length is about 8.23 m on X');
assert.ok(Math.abs(ri245.beam - 3.882) < 0.01, 'Ri245 beam is about 3.88 m on Z');
assert.ok(ri245.length > size.length, 'Ri245 is longer than the Ri230 fixture');
const ri245Placement = centurionDemoPlacement(CENTURION_RI245_BOUNDS);
assert.equal(ri245Placement.scale, 15);
assert.equal(ri245Placement.buoyancy.heightOffset, 0);
assert.ok(ri245Placement.worldLength > 120 && ri245Placement.worldLength < 125);
assert.equal(CENTURION_RI245_SKU, 'ri245-my-2027');
assert.ok(CENTURION_RI245_WINDSHIELD[0] > 1, 'windshield sits forward of the origin');
const ri245Bow = demoParentPoint(
    [CENTURION_RI245_BOUNDS.max[0], 0, 0], ri245Placement);
const ri245Stern = demoParentPoint(
    [CENTURION_RI245_BOUNDS.min[0], 0, 0], ri245Placement);
assert.ok(ri245Bow[2] > ri245Stern[2], 'Ri245 bow +X maps to +Z');
assert.match(demoJs, /DRACOLoader/);
assert.match(demoJs, /CENTURION_RI245_GLB/);
assert.match(demoJs, /CENTURION_RI245_BOUNDS/);
assert.match(
    CENTURION_RI245_GLB,
    /1df5840a-34fd-6d79-9112-42b65bcb9d37\.glb$/,
    'the demo loads the published Ri245 puzzle GLB');
assert.match(html, /three\/webgpu/);
assert.match(html, /threejs-water-pro\/build\/index\.js/);
assert.match(html, /water-pro-demo\.js/);
assert.match(html, /data-time="midday"/);
assert.match(html, /data-time="sunset"/);
assert.match(html, /data-sea="calm"/);
assert.match(html, /data-sea="light"/);
assert.match(html, /data-view="glass"/);
