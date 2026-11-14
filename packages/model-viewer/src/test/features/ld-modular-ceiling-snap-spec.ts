/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import type {SnapPoint} from '@london-dynamics/types/planner';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {
  applyCeilingHeightSnapTransform,
  CEILING_HEIGHT_CLEARANCE_DEFAULT,
  getCeilingHeightClearance,
  getRoomCeilingY,
  invalidateRoomSurfaceIndexCache,
  isCeilingHeightObject,
  isCeilingHeightSnapPoint,
} from '../../utilities/surface-snapping.js';

/** Axis-aligned box spanning [0, height] in Y, centred at (x, z). */
function standingBox(
  name: string,
  width: number,
  height: number,
  x: number,
  z: number
): Mesh {
  const mesh = new Mesh(
    new BoxGeometry(width, height, 0.1),
    new MeshBasicMaterial()
  );
  mesh.name = name;
  mesh.position.set(x, height / 2, z);
  return mesh;
}

/** A room whose walls are `wall_*` / `innerWall_*` shells of the given height. */
function roomWithWalls(height: number): Group {
  const room = new Group();
  room.add(standingBox('wall_0', 4, height, 0, 2));
  room.add(standingBox('wall_1', 4, height, 2, 0));
  room.add(standingBox('innerWall_0', 3, height, -1, 0));
  room.updateMatrixWorld(true);
  return room;
}

function snapPoint(
  allowedSurfaces: SnapPoint['allowedSurfaces'],
  surfaceSnap: SnapPoint['surfaceSnap'] = {align: 'keep-upright'},
  position: [number, number, number] = [0, 0, 0]
): SnapPoint {
  return {
    id: 'mount',
    transform: {position, rotation: [0, 0, 0]},
    allowedSurfaces,
    surfaceSnap,
  };
}

function ceilingSnapPoint(
  surfaceSnap?: SnapPoint['surfaceSnap'],
  position?: [number, number, number]
): SnapPoint {
  return snapPoint(['ceiling'], surfaceSnap, position);
}

function objectWithSnapPoints(snapPoints: SnapPoint[]): Object3D {
  const object = new Object3D();
  object.userData.snapPoints = snapPoints;
  return object;
}

suite('ld-modular ceiling-height snap', () => {
  suite('getRoomCeilingY', () => {
    test('uses the top of the tallest wall shell', () => {
      const room = roomWithWalls(2.5);
      // A taller non-wall mesh must not raise the ceiling.
      room.add(standingBox('furniture_tall', 1, 3.2, 0, 0));
      room.updateMatrixWorld(true);

      expect(getRoomCeilingY(room)).to.be.closeTo(2.5, 1e-6);
    });

    test('falls back to the room bounding box top without wall shells', () => {
      const room = new Group();
      room.add(standingBox('scan_geometry', 4, 3, 0, 0));
      room.updateMatrixWorld(true);

      expect(getRoomCeilingY(room)).to.be.closeTo(3, 1e-6);
    });

    test('returns null for an empty room', () => {
      expect(getRoomCeilingY(new Group())).to.equal(null);
    });

    test('is cached until the room surface cache is invalidated', () => {
      const room = roomWithWalls(2.5);
      expect(getRoomCeilingY(room)).to.be.closeTo(2.5, 1e-6);

      // Geometry changes are only picked up after invalidation.
      room.getObjectByName('wall_0')!.scale.y = 2;
      room.updateMatrixWorld(true);
      expect(getRoomCeilingY(room)).to.be.closeTo(2.5, 1e-6);

      // Box is centred on its origin, so doubling Y height raises the top to 3.75.
      invalidateRoomSurfaceIndexCache(room);
      expect(getRoomCeilingY(room)).to.be.closeTo(3.75, 1e-6);
    });
  });

  suite('ceiling-only snap points', () => {
    test('treats a ceiling-only snap point as ceiling height', () => {
      expect(isCeilingHeightSnapPoint(snapPoint(['ceiling']))).to.equal(true);
    });

    test('does not treat wall, floor or mixed snap points as ceiling height', () => {
      expect(isCeilingHeightSnapPoint(snapPoint(['wall']))).to.equal(false);
      expect(isCeilingHeightSnapPoint(snapPoint(['wall', 'ceiling']))).to.equal(
        false
      );
      expect(isCeilingHeightSnapPoint(snapPoint(['floor']))).to.equal(false);
    });

    test('does not treat unrestricted snap points as ceiling height', () => {
      expect(isCeilingHeightSnapPoint(snapPoint(undefined))).to.equal(false);
      expect(isCeilingHeightSnapPoint(snapPoint([]))).to.equal(false);
      expect(isCeilingHeightSnapPoint(null)).to.equal(false);
    });

    test('detects ceiling height from the primary surface snap point', () => {
      expect(
        isCeilingHeightObject(objectWithSnapPoints([ceilingSnapPoint()]))
      ).to.equal(true);
      expect(
        isCeilingHeightObject(objectWithSnapPoints([snapPoint(['wall'])]))
      ).to.equal(false);
      expect(isCeilingHeightObject(new Object3D())).to.equal(false);
    });
  });

  suite('clearance', () => {
    test('defaults to 1 mm', () => {
      expect(CEILING_HEIGHT_CLEARANCE_DEFAULT).to.equal(0.001);
      expect(getCeilingHeightClearance(ceilingSnapPoint())).to.equal(0.001);
    });

    test('uses surfaceSnap.offset when set', () => {
      expect(
        getCeilingHeightClearance(ceilingSnapPoint({offset: 0.005}))
      ).to.equal(0.005);
      expect(getCeilingHeightClearance(ceilingSnapPoint({offset: 0}))).to.equal(
        0
      );
    });
  });

  suite('applyCeilingHeightSnapTransform', () => {
    test('locks the mount 1 mm below the wall top and keeps XZ and yaw', () => {
      const room = roomWithWalls(2.5);
      const lamp = new Object3D();
      lamp.position.set(1.2, 0.4, -0.7);
      lamp.rotation.y = 0.6;
      lamp.updateMatrixWorld(true);

      const mount = applyCeilingHeightSnapTransform(
        lamp,
        ceilingSnapPoint(),
        room
      );

      expect(mount).to.not.equal(null);
      expect(mount!.y).to.be.closeTo(2.499, 1e-6);
      expect(lamp.position.x).to.be.closeTo(1.2, 1e-6);
      expect(lamp.position.z).to.be.closeTo(-0.7, 1e-6);
      expect(lamp.rotation.y).to.be.closeTo(0.6, 1e-6);
    });

    test('marks the object as a ceiling attachment, not a wall', () => {
      const room = roomWithWalls(2.5);
      const lamp = new Object3D();
      lamp.userData.attachedWallName = 'wall_0';
      lamp.userData.attachedWallUuid = 'stale';

      applyCeilingHeightSnapTransform(lamp, ceilingSnapPoint(), room);

      expect(lamp.userData.isSurfaceSnapped).to.equal(true);
      expect(lamp.userData.attachedSurfaceType).to.equal('ceiling');
      expect(lamp.userData.attachedWallName).to.equal(undefined);
      expect(lamp.userData.attachedWallUuid).to.equal(undefined);
    });

    test('uses the configured surfaceSnap.offset as the clearance', () => {
      const room = roomWithWalls(2.5);
      const lamp = new Object3D();

      const mount = applyCeilingHeightSnapTransform(
        lamp,
        ceilingSnapPoint({offset: 0.01}),
        room
      );

      expect(mount!.y).to.be.closeTo(2.49, 1e-6);
    });

    test('places the snap point, not the origin, at the wall-top clearance', () => {
      const room = roomWithWalls(2.5);
      const lamp = new Object3D();

      const mount = applyCeilingHeightSnapTransform(
        lamp,
        ceilingSnapPoint(undefined, [0, 0.2, 0]),
        room
      );

      expect(mount!.y).to.be.closeTo(2.499, 1e-6);
      expect(lamp.position.y).to.be.closeTo(2.299, 1e-6);
    });

    test('converts the world target into a translated parent', () => {
      const room = roomWithWalls(2.5);
      const parent = new Group();
      parent.position.set(0, 0.5, 0);
      const lamp = new Object3D();
      parent.add(lamp);
      parent.updateMatrixWorld(true);

      applyCeilingHeightSnapTransform(lamp, ceilingSnapPoint(), room);

      const world = lamp.getWorldPosition(new Vector3());
      expect(world.y).to.be.closeTo(2.499, 1e-6);
      expect(lamp.position.y).to.be.closeTo(1.999, 1e-6);
    });

    test('returns null and leaves the object alone when there is no room height', () => {
      const lamp = new Object3D();
      lamp.position.set(1, 1, 1);

      const mount = applyCeilingHeightSnapTransform(
        lamp,
        ceilingSnapPoint(),
        new Group()
      );

      expect(mount).to.equal(null);
      expect(lamp.position.toArray()).to.deep.equal([1, 1, 1]);
      expect(lamp.userData.attachedSurfaceType).to.equal(undefined);
    });
  });

  suite('element integration', () => {
    let element: ModelViewerElement;

    setup(() => {
      element = new ModelViewerElement();
    });

    /** Stubs the room lookup and a 100x100 viewport for placement NDC maths. */
    function stageRoom(room: Object3D | null) {
      const host = element as any;
      host._findRoomSurfaceObject = () => room;
      host.getBoundingClientRect = () =>
        ({left: 0, top: 0, width: 100, height: 100} as DOMRect);
    }

    test('applySurfaceSnapForPlacement locks a ceiling part to the wall top', () => {
      stageRoom(roomWithWalls(2.5));
      const lamp = new Object3D();
      lamp.position.set(1, 0.3, -0.5);
      lamp.userData.snapPoints = [ceilingSnapPoint()];

      const hit = (element as any).applySurfaceSnapForPlacement(lamp, 50, 50);

      expect(hit).to.not.equal(null);
      expect(hit.surfaceType).to.equal('ceiling');
      expect(hit.point.y).to.be.closeTo(2.499, 1e-6);
      expect(lamp.position.y).to.be.closeTo(2.499, 1e-6);
      expect(lamp.position.x).to.be.closeTo(1, 1e-6);
      expect(lamp.position.z).to.be.closeTo(-0.5, 1e-6);
      expect(lamp.userData.attachedSurfaceType).to.equal('ceiling');
    });

    test('shows the placement cursor at the ceiling mount', () => {
      stageRoom(roomWithWalls(2.5));
      const shown: Array<{point: Vector3; normal: Vector3}> = [];
      (element as any)._placementCursorMesh = {
        showOnSurface: (point: Vector3, normal: Vector3) =>
          shown.push({point, normal}),
      };
      const lamp = new Object3D();
      lamp.userData.snapPoints = [ceilingSnapPoint()];

      (element as any).applySurfaceSnapForPlacement(lamp, 50, 50);

      expect(shown.length).to.equal(1);
      expect(shown[0].point.y).to.be.closeTo(2.499, 1e-6);
      expect(shown[0].normal.y).to.equal(-1);
    });

    test('wall-only parts do not take the ceiling lock', () => {
      stageRoom(roomWithWalls(2.5));
      const host = element as any;
      // Only test routing: the scene has no camera, so the real wall raycast
      // is skipped, and the ceiling branch is spied on.
      host[$scene] = {getCamera: () => null};
      let ceilingCalls = 0;
      host._applyCeilingHeightSnap = () => {
        ceilingCalls += 1;
        return null;
      };
      const windowPart = new Object3D();
      windowPart.position.set(1, 0.3, -0.5);
      windowPart.userData.snapPoints = [snapPoint(['wall'])];

      expect(host.applySurfaceSnapForPlacement(windowPart, 50, 50)).to.equal(
        null
      );
      expect(ceilingCalls).to.equal(0);
      expect(windowPart.position.y).to.equal(0.3);
      expect(windowPart.userData.attachedSurfaceType).to.equal(undefined);
    });

    test('ceiling parts are invalid when there is no room', () => {
      stageRoom(null);
      const lamp = new Object3D();
      lamp.position.set(1, 1, 1);
      lamp.userData.snapPoints = [ceilingSnapPoint()];

      expect(
        (element as any).applySurfaceSnapForPlacement(lamp, 50, 50)
      ).to.equal(null);
      expect(lamp.position.toArray()).to.deep.equal([1, 1, 1]);
    });
  });
});
