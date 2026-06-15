/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';

import {
  computeAlignDistributeDeltas,
  resolveLayoutContext,
} from '../../features/ld-modular/align-distribute.js';

const addBoxPart = (
  parent: Object3D,
  name: string,
  position: [number, number, number],
  size: [number, number, number] = [1, 1, 1]
) => {
  const part = new Object3D();
  part.name = name;
  part.position.set(position[0], position[1], position[2]);
  part.userData.isPlacedObject = true;

  const mesh = new Mesh(
    new BoxGeometry(size[0], size[1], size[2]),
    new MeshBasicMaterial()
  );
  part.add(mesh);
  parent.add(part);
  return part;
};

const floorContext = () =>
  ({
    kind: 'floor' as const,
    axisH: new Vector3(1, 0, 0),
    axisV: new Vector3(0, 0, 1),
  });

suite('align-distribute layout context', () => {
  test('rejects fewer than two targets', () => {
    const root = new Object3D();
    const part = addBoxPart(root, 'a', [0, 0, 0]);
    expect(resolveLayoutContext([], () => null)).to.equal(null);
    expect(resolveLayoutContext([part], () => null)).to.equal(null);
  });

  test('rejects mixed floor and wall selections', () => {
    const floor = addBoxPart(new Object3D(), 'floor', [0, 0, 0]);
    const wall = addBoxPart(new Object3D(), 'wall', [1, 1, 1]);
    wall.userData.attachedSurfaceType = 'wall';
    wall.userData.attachedWallUuid = 'wall-1';
    expect(resolveLayoutContext([floor, wall], () => null)).to.equal(null);
  });

  test('accepts wall selection on same wall', () => {
    const wall = new Object3D();
    wall.uuid = 'wall-1';
    const a = addBoxPart(new Object3D(), 'a', [0, 1, 0]);
    const b = addBoxPart(new Object3D(), 'b', [2, 1, 0]);
    a.userData.attachedSurfaceType = 'wall';
    a.userData.attachedWallUuid = 'wall-1';
    b.userData.attachedSurfaceType = 'wall';
    b.userData.attachedWallUuid = 'wall-1';

    const context = resolveLayoutContext([a, b], (uuid) =>
      uuid === 'wall-1' ? wall : null
    );
    expect(context?.kind).to.equal('wall');
  });
});

suite('align-distribute floor deltas', () => {
  let root: Object3D;

  setup(() => {
    root = new Object3D();
  });

  test('align-left moves objects to common min X', () => {
    const a = addBoxPart(root, 'a', [-2, 0, 0]);
    const b = addBoxPart(root, 'b', [1, 0, 0]);
    const c = addBoxPart(root, 'c', [3, 0, 2]);
    const context = floorContext();
    const deltas = computeAlignDistributeDeltas('align-left', [a, b, c], context);
    expect(deltas.size).to.be.greaterThan(0);

    for (const obj of [a, b, c]) {
      const delta = deltas.get(obj.uuid) ?? new Vector3(0, 0, 0);
      obj.position.add(delta);
      const minX = obj.position.x - 0.5;
      expect(minX).to.be.closeTo(-2.5, 1e-3);
    }
  });

  test('distribute-h keeps first and last anchored', () => {
    const a = addBoxPart(root, 'a', [-3, 0, 0]);
    const b = addBoxPart(root, 'b', [0, 0, 1]);
    const c = addBoxPart(root, 'c', [4, 0, -1]);
    const context = floorContext();
    const beforeB = b.position.x;
    const beforeA = a.position.x;
    const beforeC = c.position.x;

    const deltas = computeAlignDistributeDeltas(
      'distribute-h',
      [a, b, c],
      context
    );
    expect(deltas.has(a.uuid)).to.equal(false);
    expect(deltas.has(c.uuid)).to.equal(false);
    expect(deltas.has(b.uuid)).to.equal(true);

    b.position.add(deltas.get(b.uuid)!);
    expect(a.position.x).to.be.closeTo(beforeA, 1e-4);
    expect(c.position.x).to.be.closeTo(beforeC, 1e-4);
    expect(b.position.x).to.not.be.closeTo(beforeB, 1e-3);
  });

  test('distribute requires at least three objects', () => {
    const a = addBoxPart(root, 'a', [0, 0, 0]);
    const b = addBoxPart(root, 'b', [2, 0, 0]);
    const context = floorContext();
    const deltas = computeAlignDistributeDeltas('distribute-h', [a, b], context);
    expect(deltas.size).to.equal(0);
  });

  test('equal-gap-h creates uniform horizontal gaps', () => {
    const a = addBoxPart(root, 'a', [-4, 0, 0], [1, 1, 1]);
    const b = addBoxPart(root, 'b', [-1, 0, 0], [1, 1, 1]);
    const c = addBoxPart(root, 'c', [3, 0, 0], [1, 1, 1]);
    const context = floorContext();
    const deltas = computeAlignDistributeDeltas('equal-gap-h', [a, b, c], context);
    b.position.add(deltas.get(b.uuid)!);

    const gap =
      b.position.x - 0.5 - (a.position.x + 0.5);
    const secondGap =
      (c.position.x - 0.5) - (b.position.x + 0.5);
    expect(gap).to.be.closeTo(secondGap, 1e-3);
  });
});

suite('align-distribute wall deltas', () => {
  test('align-top uses world Y on wall context', () => {
    const wall = new Object3D();
    wall.uuid = 'wall-1';
    const a = addBoxPart(new Object3D(), 'a', [0, 1, 0]);
    const b = addBoxPart(new Object3D(), 'b', [1, 3, 0]);
    for (const obj of [a, b]) {
      obj.userData.attachedSurfaceType = 'wall';
      obj.userData.attachedWallUuid = 'wall-1';
    }

    const context = resolveLayoutContext([a, b], (uuid) =>
      uuid === 'wall-1' ? wall : null
    )!;
    expect(context.kind).to.equal('wall');

    const deltas = computeAlignDistributeDeltas('align-top', [a, b], context);
    const movedA = a.position.y + (deltas.get(a.uuid)?.y ?? 0);
    const movedB = b.position.y + (deltas.get(b.uuid)?.y ?? 0);
    expect(movedA).to.be.closeTo(1, 1e-3);
    expect(movedB).to.be.closeTo(1, 1e-3);
  });
});
