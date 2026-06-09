/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  computeTransformDelta,
  getObjectDisplayName,
  inferRotationAxesFromParsed,
  normalizeAngleDeltaDeg,
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
});
