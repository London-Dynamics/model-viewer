/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  Box3,
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Ray,
  Raycaster,
  Vector3,
} from 'three';

import {RotationControlDisc} from '../../features/ld-modular/rotation-control-disc.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {
  findRoomFloorHitForRay,
  findRoomSupportY,
} from '../../utilities/surface-snapping.js';

const DOWN = new Vector3(0, -1, 0);

/** Horizontal, upward-facing plane centred at (x, y, z). */
function floorPlane(
  name: string,
  width: number,
  depth: number,
  x: number,
  y: number,
  z = 0
): Mesh {
  const geometry = new PlaneGeometry(width, depth);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  mesh.name = name;
  mesh.position.set(x, y, z);
  return mesh;
}

/**
 * Ground floor `floor_a` at y = 0 spanning x in [-5, 5], and a mezzanine
 * `floor_b` at y = 1 spanning x in [0, 5].
 */
function twoLevelRoom(): Group {
  const room = new Group();
  room.add(floorPlane('floor_a', 10, 10, 0, 0));
  room.add(floorPlane('floor_b', 5, 10, 2.5, 1));
  room.updateMatrixWorld(true);
  return room;
}

function footprintAt(x: number, bottomY: number, size = 0.4): Box3 {
  return new Box3(
    new Vector3(x - size / 2, bottomY, -size / 2),
    new Vector3(x + size / 2, bottomY + size, size / 2)
  );
}

function boxObject(size = 0.4): Mesh {
  return new Mesh(new BoxGeometry(size, size, size), new MeshBasicMaterial());
}

suite('ld-modular room levels', () => {
  suite('findRoomFloorHitForRay', () => {
    test('returns the visible level under the cursor', () => {
      const room = twoLevelRoom();
      const overMezzanine = findRoomFloorHitForRay(
        new Ray(new Vector3(2, 5, 0), DOWN.clone()),
        room
      );
      const overGround = findRoomFloorHitForRay(
        new Ray(new Vector3(-2, 5, 0), DOWN.clone()),
        room
      );
      expect(overMezzanine?.point.y).to.be.closeTo(1, 1e-6);
      expect(overGround?.point.y).to.be.closeTo(0, 1e-6);
    });

    test('ignores level surfaces seen from below', () => {
      const room = new Group();
      const mezzanine = floorPlane('floor_b', 5, 10, 0, 1);
      (mezzanine.material as MeshBasicMaterial).side = DoubleSide;
      room.add(mezzanine);
      room.updateMatrixWorld(true);
      const hit = findRoomFloorHitForRay(
        new Ray(new Vector3(0, 0.2, 0), new Vector3(0, 1, 0)),
        room
      );
      expect(hit).to.equal(null);
    });
  });

  suite('findRoomSupportY', () => {
    test('keeps an object under a mezzanine on the ground floor', () => {
      const room = twoLevelRoom();
      expect(findRoomSupportY(room, footprintAt(2, 0))).to.be.closeTo(0, 1e-6);
    });

    test('finds the mezzanine when starting above it', () => {
      const room = twoLevelRoom();
      expect(findRoomSupportY(room, footprintAt(2, 0), 1.4)).to.be.closeTo(
        1,
        1e-6
      );
    });

    test('rests on the highest level under a footprint that straddles a step', () => {
      const room = twoLevelRoom();
      expect(findRoomSupportY(room, footprintAt(0, 1), 1.4)).to.be.closeTo(
        1,
        1e-6
      );
    });

    test('ignores untagged geometry when tagged floors exist', () => {
      const room = twoLevelRoom();
      room.add(floorPlane('table_top', 1, 1, -2, 0.5));
      room.updateMatrixWorld(true);
      expect(findRoomSupportY(room, footprintAt(-2, 0), 1)).to.be.closeTo(
        0,
        1e-6
      );
    });

    test('ignores furniture whose material name mentions floor', () => {
      const room = twoLevelRoom();
      const carPanel = floorPlane('interior_part9', 1, 1, -2, 0.42);
      (carPanel.material as MeshBasicMaterial).name = 'interior_third_floor';
      room.add(carPanel);
      room.updateMatrixWorld(true);
      expect(findRoomSupportY(room, footprintAt(-2, 0), 1)).to.be.closeTo(
        0,
        1e-6
      );
    });

    test('falls back to upward-facing untagged surfaces', () => {
      const room = new Group();
      room.add(floorPlane('scan_mesh_0', 10, 10, 0, 0.25));
      const wall = new Mesh(new PlaneGeometry(10, 3), new MeshBasicMaterial());
      wall.name = 'scan_mesh_1';
      wall.position.set(0, 1.5, 0);
      room.add(wall);
      room.updateMatrixWorld(true);
      expect(findRoomSupportY(room, footprintAt(1, 0.25), 2)).to.be.closeTo(
        0.25,
        1e-6
      );
    });

    test('returns null when nothing is under the footprint', () => {
      const room = twoLevelRoom();
      expect(findRoomSupportY(room, footprintAt(20, 0))).to.equal(null);
    });
  });

  suite('element integration', () => {
    let element: ModelViewerElement;

    setup(() => {
      element = new ModelViewerElement();
    });

    test('_restObjectOnRoomLevel steps an object up to the cursor level', () => {
      const room = twoLevelRoom();
      const parent = new Group();
      const object = boxObject();
      parent.add(object);
      object.position.set(2, 0.2, 0);
      parent.updateMatrixWorld(true);
      (element as any)._getRoomLevelObject = () => room;

      expect((element as any)._restObjectOnRoomLevel(object, 1)).to.equal(true);
      expect(new Box3().setFromObject(object).min.y).to.be.closeTo(1, 1e-6);

      expect((element as any)._restObjectOnRoomLevel(object, 0)).to.equal(true);
      expect(new Box3().setFromObject(object).min.y).to.be.closeTo(0, 1e-6);
    });

    test('_restObjectOnRoomLevel is a no-op outside src-is-room', () => {
      const object = boxObject();
      object.position.set(0, 0.7, 0);
      expect((element as any)._restObjectOnRoomLevel(object, 0)).to.equal(
        false
      );
      expect(object.position.y).to.equal(0.7);
    });

    test('rotation disc picking is blocked by the selection only', () => {
      const modular = element as any;
      const selected = boxObject(1);
      selected.position.set(0, 0, 0);
      selected.updateMatrixWorld(true);
      const roomWall = boxObject(1);
      roomWall.position.set(0, 0, 3);
      roomWall.updateMatrixWorld(true);
      const discHit = {
        point: new Vector3(),
        angleRad: 0,
        distance: 5,
      };

      modular._rotationControlDisc = {visible: true, intersectRay: () => discHit};
      modular._setPointerRayFromClient = () => true;
      modular.raycaster = new Raycaster(
        new Vector3(0, 0, 5),
        new Vector3(0, 0, -1)
      );

      modular._getRotationDiscTargets = (): Object3D[] => [];
      modular._findTargetObject = () => roomWall;
      expect(modular._intersectRotationControlFromClientPoint(0, 0)).to.equal(
        discHit
      );

      modular._getRotationDiscTargets = (): Object3D[] => [selected];
      expect(modular._intersectRotationControlFromClientPoint(0, 0)).to.equal(
        null
      );
    });
  });

  test('rotation disc sits on the supplied surface height', () => {
    const parent = new Group();
    const object = boxObject();
    parent.add(object);
    const disc = new RotationControlDisc();
    parent.add(disc);
    parent.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(45, 1, 0.01, 100);
    camera.position.set(0, 3, 3);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    disc.update({
      selectedObjects: [object],
      pivotWorld: new Vector3(),
      camera,
      viewportWidth: 800,
      viewportHeight: 600,
      floorY: 0,
      surfaceWorldY: 0.105,
      highlightColor: '#3b82f6',
      majorStepDegrees: 0,
      fineStepDegrees: 0,
      lockSize: true,
    });

    expect(disc.visible).to.equal(true);
    expect(disc.getCenterWorld(new Vector3()).y).to.be.closeTo(0.108, 1e-6);
    disc.dispose();
  });
});
