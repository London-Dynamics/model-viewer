/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {expect} from 'chai';
import {PerspectiveCamera, Vector3} from 'three';

import {applyShadowStretch, compositeFloorPixel, effectReach, effectSupport, effectiveFloorMode, floorDistanceFalloff, footprintDistance, footprintFromBounds, normalizePathTracerFloorMode, rectCorners, reflectionWeight, schlickFresnel, screenBoundsOfWorldPoints, shadowCatcherCoverage, traceAreaPercent, unionCrops,} from '../../../../three-components/postprocessing/ld-path-tracer/floor-matte.js';

suite('path tracer floor matte', () => {
  test('reads the three floor modes and the legacy on/off values', () => {
    expect(normalizePathTracerFloorMode('none')).to.equal('none');
    expect(normalizePathTracerFloorMode('shadow')).to.equal('shadow');
    expect(normalizePathTracerFloorMode('shadow-reflection'))
        .to.equal('shadow-reflection');
    expect(normalizePathTracerFloorMode('')).to.equal('shadow');
    expect(normalizePathTracerFloorMode('1')).to.equal('shadow');
    expect(normalizePathTracerFloorMode(true)).to.equal('shadow');
    expect(normalizePathTracerFloorMode('0')).to.equal('none');
    expect(normalizePathTracerFloorMode(false)).to.equal('none');
    expect(normalizePathTracerFloorMode('nope')).to.equal('none');
    expect(effectiveFloorMode('none', 'path-tracer')).to.equal('shadow');
    expect(effectiveFloorMode('none', 'soft-shadow')).to.equal('none');
    expect(effectiveFloorMode('shadow-reflection', 'soft-shadow'))
        .to.equal('shadow-reflection');
  });

  test('shadow is the luminance ratio of the full lighting, not a tint', () => {
    const open = {r: 4, g: 1, b: 0.2};
    const blocked = {r: 0, g: 0, b: 0};
    expect(shadowCatcherCoverage(open, open)).to.equal(0);
    expect(shadowCatcherCoverage(blocked, open)).to.equal(1);
    const half = {r: open.r * 0.5, g: open.g * 0.5, b: open.b * 0.5};
    expect(shadowCatcherCoverage(half, open)).to.be.closeTo(0.5, 1e-6);
    expect(shadowCatcherCoverage(blocked, {r: 0, g: 0, b: 0})).to.equal(0);
  });

  test('falloff is full on the footprint and gone past the effect reach', () => {
    const footprint = footprintFromBounds(-1, 0, -0.5, 1, 2, 0.5);
    expect(footprint.centerX).to.equal(0);
    expect(footprint.halfX).to.equal(1);
    expect(footprint.radius).to.be.greaterThan(1);
    expect(footprintDistance(0, 0, footprint)).to.equal(0);
    expect(floorDistanceFalloff(0, footprint.radius)).to.equal(1);
    const edge = footprintDistance(footprint.halfX + footprint.radius, 0, footprint);
    expect(edge).to.be.closeTo(footprint.radius, 1e-6);
    expect(floorDistanceFalloff(edge, footprint.radius)).to.be.closeTo(
        Math.exp(-3), 1e-6);
    const reach = effectReach(footprint.radius);
    expect(floorDistanceFalloff(reach, footprint.radius))
        .to.be.closeTo(0.02, 1e-6);
  });

  test('a missed reflection adds nothing and a hit fades with Fresnel', () => {
    expect(reflectionWeight(false, 1, 0.45, 1)).to.equal(0);
    const straight = reflectionWeight(true, 1, 1, 1);
    expect(straight).to.be.closeTo(schlickFresnel(1), 1e-6);
    expect(straight).to.be.closeTo(0.04, 1e-6);
    const grazing = reflectionWeight(true, 0, 1, 1);
    expect(grazing).to.be.closeTo(1, 1e-6);
    const faded = reflectionWeight(true, 1, 0.45, 0.5);
    expect(faded).to.be.closeTo(0.04 * 0.45 * 0.5, 1e-6);
  });

  test('no shadow and no reflection is exactly the page', () => {
    const clear = compositeFloorPixel(0, {r: 0, g: 0, b: 0}, 0);
    expect(clear).to.deep.equal({r: 0, g: 0, b: 0, a: 0});
  });

  test('shadow darkens by alpha and reflection stays premultiplied', () => {
    const shadow = compositeFloorPixel(0.4, {r: 0, g: 0, b: 0}, 0);
    expect(shadow.r).to.equal(0);
    expect(shadow.a).to.be.closeTo(0.4, 1e-6);
    const reflected = compositeFloorPixel(0, {r: 0.2, g: 0, b: 0}, 0.2);
    expect(reflected.a).to.be.closeTo(0.2, 1e-6);
    expect(reflected.r).to.be.closeTo(1, 1e-6);
    const both = compositeFloorPixel(0.4, {r: 0.2, g: 0, b: 0}, 0.2);
    expect(both.a).to.be.closeTo(1 - 0.6 * 0.8, 1e-6);
    expect(both.r * both.a).to.be.closeTo(0.2, 1e-6);
  });

  test('overhead light does not stretch the footprint', () => {
    const footprint = footprintFromBounds(-1, 0, -1, 1, 1, 1);
    const same = applyShadowStretch(footprint, [0, 1, 0]);
    expect(same.halfX).to.equal(footprint.halfX);
    expect(same.centerX).to.equal(footprint.centerX);
  });

  test('a side light extends the far edge and keeps the near edge', () => {
    const footprint = footprintFromBounds(-1, 0, -1, 1, 1, 1);
    const light = new Vector3(1, 1, 0).normalize();
    const next = applyShadowStretch(footprint, [light.x, light.y, light.z]);
    // The edge toward the light stays. The shadow side grows.
    const litEdge = footprint.centerX + footprint.halfX;
    expect(next.centerX + next.halfX).to.be.closeTo(litEdge, 1e-6);
    expect(next.centerX - next.halfX).to.be.lessThan(footprint.centerX - footprint.halfX);
  });

  test('the traced floor is the subject rect plus the fade, not a ground plane', () => {
    const camera = new PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.set(0, 2, 6);
    camera.lookAt(0, 0.5, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const footprint = footprintFromBounds(-0.5, 0, -0.5, 0.5, 1.2, 0.5);
    const support = effectSupport(footprint);
    const bare = screenBoundsOfWorldPoints(
        rectCorners(footprint), camera, 400, 400);
    const effect = screenBoundsOfWorldPoints(
        rectCorners(support), camera, 400, 400);
    expect(bare).to.not.equal(null);
    expect(effect).to.not.equal(null);
    expect(effect!.width * effect!.height)
        .to.be.greaterThan(bare!.width * bare!.height);
    expect(effect!.width).to.be.lessThan(400);
    const subject = {x: 160, y: 80, width: 80, height: 120};
    const tight = unionCrops(subject, effect, 400, 400);
    expect(tight).to.not.equal(null);
    expect(tight!.width).to.be.lessThan(400);
    expect(traceAreaPercent(tight!.width * tight!.height, 400 * 400))
        .to.be.lessThan(92);
  });

  test('a missing side of the union means the whole frame', () => {
    expect(unionCrops(null, {x: 0, y: 0, width: 10, height: 10}, 100, 100))
        .to.equal(null);
    expect(traceAreaPercent(10000, 10000)).to.equal(100);
  });
});
