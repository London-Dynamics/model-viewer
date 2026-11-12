/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';

import {
  createPlanarJointGeometry,
  createPlanarStrokeGeometry,
  joinCoincidentGridStrokes,
  resolveGridShapeStrokes,
} from '../../features/ld-measure/grid-shapes.js';

suite('grid shape strokes', () => {
  test('keeps one centre and each stroke thickness', () => {
    const resolved = resolveGridShapeStrokes(
      [
        {points: [[0, 0], [4, 0]], thickness: 0.1, closed: false},
        {points: [[1, 1], [1, 3]], thickness: 0.05, closed: false},
      ],
      0.025
    );

    expect(resolved.center).to.deep.equal([2, 1.5]);
    expect(resolved.strokes.map((stroke) => stroke.thickness)).to.deep.equal([
      0.1, 0.05,
    ]);
    expect(resolved.strokes.every((stroke) => stroke.closed === false)).to.be
      .true;
  });

  test('keeps the legacy close rule for a point ring', () => {
    const resolved = resolveGridShapeStrokes(
      [
        [0, 0],
        [4, 0],
        [4, 2],
        [0, 2],
      ],
      0.05
    );

    expect(resolved.strokes).to.have.length(1);
    expect(resolved.strokes[0].thickness).to.equal(0.05);
    expect(resolved.strokes[0].closed).to.equal(true);
    expect(resolved.center).to.deep.equal([2, 1]);
  });

  test('leaves a three-point stroke open when closed is false', () => {
    const points: Array<[number, number]> = [
      [0, 0],
      [2, 0],
      [2, 2],
    ];
    const resolved = resolveGridShapeStrokes(
      [{points, thickness: 0.1, closed: false}],
      0.025
    );
    expect(resolved.strokes[0].closed).to.equal(false);

    const open = createPlanarStrokeGeometry(points, 0.1, 0, 0, 0, false);
    const closed = createPlanarStrokeGeometry(points, 0.1, 0, 0, 0, true);
    expect(open).to.not.equal(null);
    expect(closed).to.not.equal(null);
    expect(open!.getIndex()!.count).to.equal(12);
    expect(closed!.getIndex()!.count).to.equal(18);
  });

  test('miters two strokes that share an endpoint', () => {
    const joined = joinCoincidentGridStrokes([
      {points: [[0, 0], [1, 0]], thickness: 0.1, closed: false},
      {points: [[1, 0], [1, 1]], thickness: 0.1, closed: false},
    ]);

    expect(joined.joints).to.have.length(0);
    expect(joined.strokes).to.have.length(1);
    expect(joined.strokes[0].closed).to.equal(false);
    expect(joined.strokes[0].points).to.deep.equal([
      [0, 0],
      [1, 0],
      [1, 1],
    ]);

    const geometry = createPlanarStrokeGeometry(
      joined.strokes[0].points,
      0.1,
      0,
      0,
      0,
      false
    );
    const position = geometry!.getAttribute('position');
    const cornerDistance = Math.hypot(position.getX(3) - 1, position.getZ(3));
    expect(cornerDistance).to.be.closeTo(0.05 * Math.SQRT2, 1e-6);
  });

  test('chains a reversed middle segment in order', () => {
    const joined = joinCoincidentGridStrokes([
      {points: [[0, 0], [1, 0]], thickness: 0.1, closed: false},
      {points: [[2, 0], [1, 0]], thickness: 0.1, closed: false},
      {points: [[2, 0], [2, 1]], thickness: 0.1, closed: false},
    ]);

    expect(joined.strokes).to.have.length(1);
    expect(joined.strokes[0].closed).to.equal(false);
    expect(joined.strokes[0].points).to.deep.equal([
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
    ]);
  });

  test('closes a loop of three segments', () => {
    const joined = joinCoincidentGridStrokes([
      {points: [[0, 0], [1, 0]], thickness: 0.1, closed: false},
      {points: [[1, 0], [0.5, 1]], thickness: 0.1, closed: false},
      {points: [[0.5, 1], [0, 0]], thickness: 0.1, closed: false},
    ]);

    expect(joined.joints).to.have.length(0);
    expect(joined.strokes).to.have.length(1);
    expect(joined.strokes[0].closed).to.equal(true);
    const geometry = createPlanarStrokeGeometry(
      joined.strokes[0].points,
      0.1,
      0,
      0,
      0,
      true
    );
    expect(geometry!.getIndex()!.count).to.equal(18);
  });

  test('leaves a two-segment cycle unmerged', () => {
    const joined = joinCoincidentGridStrokes([
      {points: [[0, 0], [1, 0]], thickness: 0.1, closed: false},
      {points: [[1, 0], [0, 0]], thickness: 0.1, closed: false},
    ]);

    expect(joined.strokes).to.have.length(2);
    expect(joined.joints).to.have.length(0);
    expect(joined.strokes.every((stroke) => stroke.closed === false)).to.be
      .true;
  });

  test('does not join disjoint strokes or different thicknesses', () => {
    const disjoint = joinCoincidentGridStrokes([
      {points: [[0, 0], [1, 0]], thickness: 0.1, closed: false},
      {points: [[2, 0], [3, 0]], thickness: 0.1, closed: false},
    ]);
    expect(disjoint.strokes).to.have.length(2);
    expect(disjoint.joints).to.have.length(0);

    const different = joinCoincidentGridStrokes([
      {points: [[0, 0], [1, 0]], thickness: 0.1, closed: false},
      {points: [[1, 0], [1, 1]], thickness: 0.2, closed: false},
    ]);
    expect(different.strokes).to.have.length(2);
    expect(different.joints).to.have.length(0);
  });

  test('fills a joint where three strokes meet and does not merge them', () => {
    const joined = joinCoincidentGridStrokes([
      {points: [[0, 0], [1, 0]], thickness: 0.1, closed: false},
      {points: [[1, 0], [2, 0]], thickness: 0.1, closed: false},
      {points: [[1, 0], [1, 1]], thickness: 0.1, closed: false},
    ]);

    expect(joined.strokes).to.have.length(3);
    expect(joined.strokes.every((stroke) => stroke.points.length === 2)).to.be
      .true;
    expect(joined.joints).to.deep.equal([{center: [1, 0], thickness: 0.1}]);

    const disc = createPlanarJointGeometry([1, 0], 0.1, 0, 0, 0);
    const position = disc.getAttribute('position');
    expect(position.getX(1)).to.be.closeTo(1.05, 1e-6);
    expect(position.getZ(1)).to.be.closeTo(0, 1e-6);
  });

  test('does not close one stroke only because its own ends meet', () => {
    const points: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ];
    const joined = joinCoincidentGridStrokes([
      {points, thickness: 0.1, closed: false},
    ]);

    expect(joined.strokes).to.have.length(1);
    expect(joined.strokes[0].closed).to.equal(false);
    expect(joined.strokes[0].points).to.equal(points);
    expect(joined.joints).to.have.length(0);
  });
});
