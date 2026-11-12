/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';

import {
  createPlanarStrokeGeometry,
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
});
