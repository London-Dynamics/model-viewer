import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {readFileSync} from 'node:fs';

import {
  AQUILA_45_BOUNDS,
  AQUILA_45_GLB,
  AQUILA_45_SKU,
  AQUILA_45_WINDSHIELD,
  AQUILA_WATERLINE_Y,
  BOATS,
  CENTURION_RI230_BOUNDS,
  CENTURION_RI245_BOUNDS,
  CENTURION_RI245_GLB,
  CENTURION_RI245_SKU,
  CENTURION_RI245_WINDSHIELD,
  DEMO_BOAT_SCALE,
  RI245_WATERLINE_Y,
  boatDemoPlacement,
  boatFromParam,
  boundsSize,
  centurionDemoPlacement,
  demoParentPoint,
  frameCameraPose,
  hdriForTime,
  lakeLook,
  lakePresentation,
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
assert.ok(Math.abs(light.waves.fft.amplitude - 1.56 * 2.2) < 1e-9);
assert.ok(Math.abs(light.waves.gerstner.amplitude - 2.06 * 2.2) < 1e-9);
assert.equal(light.waves.fft.windSpeed, 17.9);
assert.equal(light.color.waterColor, '#0c3d5c');
assert.equal(light.color.absorptionColor, '#3a140c');
assert.equal(light.oceanFloor.depth, 420);
assert.equal(light.fresnel.surface.iorRatio, 1.08);
assert.equal(light.ssr.strength, 0.14);
assert.equal(light.sky.reflectionRoughness, 0.2);
assert.equal(light.sky.sun.elevation, 11);
assert.equal(light.fog.color, '#e08a55');

const calm = lakeLook(sunset, {time: 'sunset', sea: 'calm'});
assert.equal(calm.waves.gerstner.wavelength, 852);
assert.equal(calm.clipmap.baseSize, 800);
assert.ok(Math.abs(calm.waves.gerstner.amplitude - 2.06 * 0.12) < 1e-9);
assert.ok(Math.abs(calm.waves.fft.amplitude - 1.56 * 0.12) < 1e-9);
assert.equal(calm.waves.fft.windSpeed, 3);
assert.equal(calm.sky.sun.elevation, 11);
assert.ok(calm.waves.gerstner.amplitude < light.waves.gerstner.amplitude * 0.1);

const midday = lakeLook(sunset, {time: 'midday', sea: 'calm'});
assert.equal(midday.waves.gerstner.wavelength, 852);
assert.equal(midday.sky.sun.elevation, 74);
assert.equal(midday.fog.color, '#c9e4f6');
assert.equal(midday.color.waterColor, '#3ec8e6');
assert.notEqual(midday.color.waterColor, light.color.waterColor);
assert.equal(midday.fresnel.surface.iorRatio, 1.08);
assert.ok(midday.waves.gerstner.amplitude < light.waves.gerstner.amplitude * 0.1);
assert.ok(lakePresentation('midday').skyBrightness > lakePresentation('sunset').skyBrightness);
assert.ok(lakePresentation('midday').exposure > lakePresentation('sunset').exposure);

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
assert.match(demoJs, /boatFromParam/);
assert.match(demoJs, /boat\.url/);
assert.match(
    CENTURION_RI245_GLB,
    /17949ff9-26b2-7158-9112-42b65bcb9d37\.glb$/,
    'the demo loads the ready Ri245 puzzle GLB');
assert.equal(boatFromParam(null).id, 'ri245');
assert.equal(boatFromParam('').id, 'ri245');
assert.equal(boatFromParam('ri245').id, 'ri245');
assert.equal(boatFromParam('RI245'), BOATS.ri245);
assert.equal(boatFromParam('nope').id, 'ri245');
assert.equal(boatFromParam('aquila').id, 'aquila');
assert.equal(boatFromParam('45-sport'), BOATS.aquila);
assert.equal(boatFromParam('demo').id, 'demo');
assert.equal(boatFromParam('dutch'), BOATS.demo);
assert.equal(AQUILA_45_SKU, '45-sport');
assert.match(
    AQUILA_45_GLB,
    /49cdcf76-f547-483d-ce9b-dee55109f95e\.glb$/,
    'Aquila loads the ready 45 Sport puzzle GLB');
assert.match(html, /boat=ri245/);
assert.match(html, /boat=aquila/);

const aquilaSpanX = AQUILA_45_BOUNDS.max[0] - AQUILA_45_BOUNDS.min[0];
const aquilaSpanZ = AQUILA_45_BOUNDS.max[2] - AQUILA_45_BOUNDS.min[2];
assert.ok(Math.abs(aquilaSpanX - 4.607) < 0.01, 'Aquila beam is about 4.61 m on X');
assert.ok(Math.abs(aquilaSpanZ - 14.179) < 0.01, 'Aquila length is about 14.18 m on Z');
assert.ok(aquilaSpanZ > aquilaSpanX, 'Aquila length is the Z axis');
const aquila = boatDemoPlacement(BOATS.aquila);
assert.equal(aquila.scale, 15);
assert.equal(aquila.yaw, 0);
assert.equal(aquila.buoyancy.heightOffset, -AQUILA_WATERLINE_Y * 15);
assert.ok(aquila.buoyancy.heightOffset < -10, 'Aquila sinks to the rub rail');
const ri245Registry = boatDemoPlacement(BOATS.ri245);
assert.equal(ri245Registry.buoyancy.heightOffset, -RI245_WATERLINE_Y * 15);
assert.equal(boatDemoPlacement(BOATS.demo).buoyancy.heightOffset, 0);
const aquilaWaterline = demoParentPoint([0, AQUILA_WATERLINE_Y, 0], aquila);
assert.ok(
    Math.abs(aquilaWaterline[1] + aquila.buoyancy.heightOffset) < 1e-6,
    'Aquila rub-rail height meets the lake after the draft offset');
assert.ok(Math.abs(aquila.worldLength - aquilaSpanZ * 15) < 1e-6);
assert.ok(Math.abs(aquila.worldBeam - aquilaSpanX * 15) < 1e-6);
assert.ok(aquila.worldLength > 210 && aquila.worldLength < 215);
assert.ok(
    aquila.buoyancy.sampleLength > aquila.worldLength * 0.8 &&
        aquila.buoyancy.sampleLength < aquila.worldLength,
    'Aquila buoyancy spans the scaled length, not the beam');
assert.ok(aquila.buoyancy.sampleWidth < aquila.worldBeam);
const aquilaCenter = [
  (AQUILA_45_BOUNDS.min[0] + AQUILA_45_BOUNDS.max[0]) / 2,
  (AQUILA_45_BOUNDS.min[1] + AQUILA_45_BOUNDS.max[1]) / 2,
  (AQUILA_45_BOUNDS.min[2] + AQUILA_45_BOUNDS.max[2]) / 2,
];
const aquilaOrigin = demoParentPoint([0, 0, 0], aquila);
assert.ok(Math.abs(aquilaOrigin[1]) < 1e-6, 'Aquila glTF origin stays on the waterline');
const aquilaCentered = demoParentPoint(aquilaCenter, aquila);
assert.ok(Math.abs(aquilaCentered[0]) < 1e-6, 'Aquila hull centre X is on the parent origin');
assert.ok(Math.abs(aquilaCentered[2]) < 1e-6, 'Aquila hull centre Z is on the parent origin');
const aquilaBow = demoParentPoint([0, 0, AQUILA_45_BOUNDS.max[2]], aquila);
const aquilaStern = demoParentPoint([0, 0, AQUILA_45_BOUNDS.min[2]], aquila);
assert.ok(aquilaBow[2] > aquilaStern[2], 'Aquila bow +Z stays on +Z');
assert.ok(AQUILA_45_WINDSHIELD[2] > 1, 'Aquila windshield sits forward of the origin');
const aquilaGlass = demoParentPoint(AQUILA_45_WINDSHIELD, aquila);
assert.ok(aquilaGlass[2] > 0, 'Aquila windshield faces demo +Z');
assert.ok(aquilaGlass[1] > 30, 'Aquila windshield is above the scaled waterline');

const heroDirection = (pose) => {
  const d = [
    pose.position[0] - pose.target[0],
    pose.position[1] - pose.target[1],
    pose.position[2] - pose.target[2],
  ];
  const len = Math.hypot(d[0], d[1], d[2]);
  return d.map((component) => component / len);
};
const riHero = heroDirection(frameCameraPose(ri245Registry, BOATS.ri245.windshield, 'hero'));
const aqHero = heroDirection(frameCameraPose(aquila, BOATS.aquila.windshield, 'hero'));
const demoHero = heroDirection(frameCameraPose(
    boatDemoPlacement(BOATS.demo), null, 'hero'));
for (let axis = 0; axis < 3; axis += 1) {
  assert.ok(Math.abs(riHero[axis] - aqHero[axis]) < 1e-9, 'Ri245 and Aquila share the hero bearing');
  assert.ok(Math.abs(riHero[axis] - demoHero[axis]) < 1e-9, 'the demo ship shares the hero bearing');
}
assert.equal(frameCameraPose(boatDemoPlacement(BOATS.demo), null, 'glass'), null);
const riGlass = frameCameraPose(ri245Registry, BOATS.ri245.windshield, 'glass');
const aqGlass = frameCameraPose(aquila, BOATS.aquila.windshield, 'glass');
assert.ok(riGlass.target[2] > riGlass.position[2], 'Ri245 glass looks toward +Z');
assert.ok(aqGlass.target[2] > aqGlass.position[2], 'Aquila glass looks toward +Z');
assert.ok(aqGlass.target[1] < aqGlass.position[1], 'Aquila glass looks down at the lake');
assert.match(html, /boat=demo/);
assert.match(demoJs, /separateWindows/);
assert.match(demoJs, /frameCameraPose/);
assert.match(html, /three\/webgpu/);
assert.match(html, /threejs-water-pro\/build\/index\.js/);
assert.match(html, /water-pro-demo\.js/);
assert.match(html, /data-time="midday"/);
assert.match(html, /data-time="sunset"/);
assert.match(html, /data-sea="calm"/);
assert.match(html, /data-sea="light"/);
assert.match(html, /data-view="glass"/);
