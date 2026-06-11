/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  computeTransformDelta,
  getObjectDisplayName,
  inferRotationAxesFromParsed,
  normalizeAngleDeltaDeg,
  SELECTION_TRANSFORM_PIVOT_NAME,
  SELECTION_TRANSFORM_PIVOT_UUID,
  shortestAngleDeltaDeg,
  type TransformEventDetail,
} from '../../features/ld-modular/transform-events.js';

suite('ld-modular transform events', () => {
  test('inferRotationAxesFromParsed detects a single relative Y change', () => {
    const axes = inferRotationAxesFromParsed(
      [
        {isRelative: false, absolute: 0},
        {isRelative: true, delta: 15},
        {isRelative: false, absolute: 0},
      ],
      [0, 0, 0]
    );
    expect(axes).to.deep.equal(['y']);
  });

  test('inferRotationAxesFromParsed defaults to all axes when nothing changes', () => {
    const axes = inferRotationAxesFromParsed(
      [
        {isRelative: false, absolute: 0},
        {isRelative: false, absolute: 0},
        {isRelative: false, absolute: 0},
      ],
      [0, 0, 0]
    );
    expect(axes).to.deep.equal(['x', 'y', 'z']);
  });

  test('getObjectDisplayName prefers userData.name over object key', () => {
    expect(
      getObjectDisplayName({
        name: '1717940000000_4821',
        userData: {name: 'Aspire Treadmill'},
      })
    ).to.equal('Aspire Treadmill');
  });

  test('getObjectDisplayName falls back to part.name then object key', () => {
    expect(
      getObjectDisplayName({
        name: '1717940000000_4821',
        userData: {part: {name: 'Elliptical'}},
      })
    ).to.equal('Elliptical');
    expect(getObjectDisplayName({name: 'Scene'})).to.equal('Scene');
  });

  test('transformend detail clears active', () => {
    const detail: TransformEventDetail = {
      target: {uuid: 'test-uuid', name: 'part-a'},
      transform: {
        position: [1, 2, 3],
        rotation: [0, 45, 0],
        scale: [1, 1, 1],
      },
      active: null,
    };
    expect(detail.active).to.equal(null);
    expect(detail.transform.rotation[1]).to.equal(45);
  });

  test('shortestAngleDeltaDeg uses shortest arc', () => {
    expect(shortestAngleDeltaDeg(-170, 170)).to.equal(20);
  });

  test('computeTransformDelta uses applied rotation Y when provided', () => {
    const delta = computeTransformDelta(
      {
        position: [0, 0, 0],
        rotation: [0, -170, 0],
        scale: [1, 1, 1],
      },
      {
        position: [0, 0, 0],
        rotation: [0, 170, 0],
        scale: [1, 1, 1],
      },
      {rotationYDelta: 20}
    );
    expect(delta.rotation[1]).to.equal(20);
  });

  test('normalizeAngleDeltaDeg wraps accumulated gesture rotation', () => {
    expect(normalizeAngleDeltaDeg(270)).to.equal(-90);
    expect(normalizeAngleDeltaDeg(450)).to.equal(90);
    expect(normalizeAngleDeltaDeg(-270)).to.equal(90);
  });

  test('computeTransformDelta normalizes large accumulated rotation Y', () => {
    const delta = computeTransformDelta(
      {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      {rotationYDelta: 450}
    );
    expect(delta.rotation[1]).to.equal(90);
  });

  test('rotation-disc-y active carries gesture delta not start snapshot', () => {
    const detail: TransformEventDetail = {
      target: {uuid: 'u1', name: 'box'},
      transform: {
        position: [0, 0, 0],
        rotation: [0, 45, 0],
        scale: [1, 1, 1],
      },
      active: {
        source: 'rotation-disc-y',
        components: ['rotation'],
        axes: {rotation: ['y']},
        delta: {
          position: [0, 0, 0],
          rotation: [0, 90, 0],
          scale: [0, 0, 0],
        },
      },
    };
    expect(detail.active?.source).to.equal('rotation-disc-y');
    expect(detail.active?.delta.rotation[1]).to.equal(90);
    expect(detail.active).to.not.have.property('start');
  });

  test('multi-select transform detail uses pivot proxy and targets list', () => {
    const detail: TransformEventDetail = {
      target: {
        uuid: SELECTION_TRANSFORM_PIVOT_UUID,
        name: SELECTION_TRANSFORM_PIVOT_NAME,
      },
      targets: [
        {uuid: 'a', name: 'Sofa A'},
        {uuid: 'b', name: 'Sofa B'},
      ],
      transform: {
        position: [1, 0, 2],
        rotation: [0, 45, 0],
        scale: [1, 1, 1],
      },
      active: {
        source: 'rotation-disc-y',
        components: ['rotation'],
        axes: {rotation: ['y']},
        delta: {
          position: [0, 0, 0],
          rotation: [0, 45, 0],
          scale: [0, 0, 0],
        },
      },
    };
    expect(detail.targets).to.have.length(2);
    expect(detail.active?.delta.rotation[1]).to.equal(45);
  });

  test('multi-select orbit uses Three.js positive Y handedness', () => {
    const delta = Math.PI / 2;
    const cos = Math.cos(delta);
    const sin = Math.sin(delta);
    const dx = 1;
    const dz = 0;
    const rx = dx * cos + dz * sin;
    const rz = -dx * sin + dz * cos;
    expect(rx).to.be.closeTo(0, 1e-6);
    expect(rz).to.be.closeTo(1, 1e-6);
  });
});
