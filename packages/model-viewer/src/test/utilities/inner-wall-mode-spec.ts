/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {BufferAttribute, BufferGeometry, FrontSide, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector2,} from 'three';

import {InnerWallModeState, isAttachedToInnerWall, normalizeInnerWallMode,} from '../../utilities/inner-wall-mode.js';
import {findRoomSurfaceHitForNdc, getRoomCeilingY, isInnerWallCutaway, isInnerWallPart, isRoomWallNode, isRoomWallShellNode,} from '../../utilities/surface-snapping.js';

function face(
    name: string, material: MeshStandardMaterial|MeshStandardMaterial[]): Mesh {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
      'position',
      new BufferAttribute(
          new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
  geometry.setAttribute(
      'normal',
      new BufferAttribute(
          new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

suite('inner wall mode', () => {
  test('matches inner-wall parts and not perimeter walls', () => {
    expect(isInnerWallPart('innerWall_0_left')).to.be.true;
    expect(isInnerWallPart('innerWall_1_top')).to.be.true;
    expect(isInnerWallPart('innerWall_2_cap_start')).to.be.true;
    expect(isInnerWallPart('innerWall_2_cap_end')).to.be.true;
    expect(isInnerWallPart('innerWall_0_reveal')).to.be.true;
    expect(isInnerWallPart('innerSkirting_0_right')).to.be.true;
    expect(isInnerWallPart('innerPanelling_3_left')).to.be.true;
    expect(isInnerWallPart('innerWall_0')).to.be.false;
    expect(isInnerWallPart('wall_0')).to.be.false;
    expect(isInnerWallPart('wall_0_reveal')).to.be.false;
    expect(isInnerWallPart('innerWallCutaway_0_left')).to.be.false;
    expect(isInnerWallCutaway('innerWallCutaway_0_left')).to.be.true;
    expect(isInnerWallCutaway('innerWallCutaway_2_jamb')).to.be.true;
    expect(isInnerWallCutaway('innerWallCutaway_0')).to.be.false;
    expect(isInnerWallCutaway('innerWall_0_left')).to.be.false;
    expect(isRoomWallNode('innerWall_0_left')).to.be.false;
    expect(isRoomWallNode('innerWallCutaway_0_top')).to.be.false;
    expect(isRoomWallShellNode('wall_0')).to.be.true;
    expect(isRoomWallShellNode('walls')).to.be.true;
    expect(isRoomWallShellNode('innerWalls')).to.be.true;
    expect(isRoomWallShellNode('innerWall_0')).to.be.true;
    expect(isRoomWallShellNode('innerWall_0_left')).to.be.true;
    expect(isRoomWallShellNode('innerWallsCutaway')).to.be.true;
    expect(isRoomWallShellNode('innerWallCutaway_0_left')).to.be.true;
    expect(isRoomWallShellNode('floor_0')).to.be.false;
    expect(isRoomWallShellNode('innerSkirting_0_left')).to.be.false;
    expect(normalizeInnerWallMode('nope')).to.equal('solid');
    expect(normalizeInnerWallMode('cutaway')).to.equal('cutaway');
    expect(normalizeInnerWallMode(undefined)).to.equal('solid');
    expect(isAttachedToInnerWall({
      attachedWallName: 'innerWall_0_left'
    })).to.be.true;
    expect(isAttachedToInnerWall({
      attachedSurfaceName: 'innerSkirting_1_right'
    })).to.be.true;
    expect(isAttachedToInnerWall({attachedWallName: 'wall_0'})).to.be.false;
    expect(isAttachedToInnerWall({attachedSurfaceName: 'floor'})).to.be.false;
    expect(isAttachedToInnerWall(undefined)).to.be.false;
  });

  test(
      'glasses every inner part from one shared clone and leaves the source alone',
      () => {
        const shared = new MeshStandardMaterial({color: 0xcccccc});
        const trim = new MeshStandardMaterial();
        const root = new Group();
        const left = face('innerWall_0_left', shared);
        const right = face('innerWall_0_right', shared);
        const top = face('innerWall_0_top', shared);
        const cap = face('innerWall_0_cap_end', shared);
        const reveal = face('innerWall_0_reveal', shared);
        const skirt = face('innerSkirting_0_left', trim);
        const panel = face('innerPanelling_0_right', trim);
        const perimeter = face('wall_0', shared);
        const perimeterReveal = face('wall_0_reveal', shared);
        const cutaway = face('innerWallCutaway_0_left', shared);
        const cutawayTop = face('innerWallCutaway_0_top', shared);
        root.add(
            left,
            right,
            top,
            cap,
            reveal,
            skirt,
            panel,
            perimeter,
            perimeterReveal,
            cutaway,
            cutawayTop);
        const cutawayGeometry = cutaway.geometry;
        const fullGeometry = left.geometry;

        const state = new InnerWallModeState();
        state.apply(root, 'transparent');

        const glass = left.material as MeshStandardMaterial;
        for (const mesh of [left, right, top, cap, reveal]) {
          expect(mesh.visible).to.be.true;
          expect(mesh.material).to.equal(glass);
        }
        expect(skirt.material).to.equal(panel.material);
        expect(skirt.material).to.not.equal(trim);
        expect(glass).to.not.equal(shared);
        expect(glass.transparent).to.be.true;
        expect(glass.opacity).to.equal(0.2);
        expect(glass.depthWrite).to.be.false;
        expect(glass.side).to.equal(FrontSide);
        expect(shared.opacity).to.equal(1);
        expect(shared.transparent).to.be.false;
        expect(shared.side).to.equal(FrontSide);
        expect(perimeter.material).to.equal(shared);
        expect(perimeter.visible).to.be.true;
        expect(perimeter.material).to.have.property('side', FrontSide);
        expect(perimeterReveal.material).to.equal(shared);
        expect(cutaway.material).to.equal(shared);
        expect(cutaway.visible).to.be.false;
        expect(cutawayTop.material).to.equal(shared);
        expect(cutawayTop.visible).to.be.false;

        state.apply(root, 'hidden');
        for (const mesh of [left, right, top, cap, reveal, skirt, panel]) {
          expect(mesh.visible).to.be.false;
          expect(mesh.material === shared || mesh.material === trim).to.be.true;
        }
        expect(perimeter.visible).to.be.true;
        expect(perimeterReveal.visible).to.be.true;
        expect(cutaway.visible).to.be.false;
        expect(cutaway.material).to.equal(shared);

        state.apply(root, 'cutaway');
        for (const mesh of [left, right, top, cap, reveal, skirt, panel]) {
          expect(mesh.visible).to.be.false;
          expect(mesh.material === shared || mesh.material === trim).to.be.true;
        }
        expect(cutaway.visible).to.be.true;
        expect(cutawayTop.visible).to.be.true;
        expect(cutaway.material).to.equal(shared);
        expect(cutaway.geometry).to.equal(cutawayGeometry);
        expect(left.geometry).to.equal(fullGeometry);
        expect(perimeter.visible).to.be.true;
        expect(perimeter.material).to.equal(shared);

        state.apply(root, 'solid');
        for (const mesh of [left, right, top, cap, reveal]) {
          expect(mesh.visible).to.be.true;
          expect(mesh.material).to.equal(shared);
        }
        expect(skirt.visible).to.be.true;
        expect(skirt.material).to.equal(trim);
        expect(cutaway.visible).to.be.false;
        expect(cutawayTop.visible).to.be.false;
        expect(shared.opacity).to.equal(1);
        state.reset();
      });

  test(
      'ignores cutaway meshes when snapping and measuring ceiling height',
      () => {
        const room = new Group();
        const group = new Group();
        group.name = 'innerWallsCutaway';
        const wallMaterial = new MeshStandardMaterial();
        wallMaterial.name = 'wall-material';
        const cutaway = face('panel', wallMaterial);
        group.add(cutaway);
        const named = face('innerWallCutaway_0_top', wallMaterial);
        named.position.y = 10;
        const full = face('innerWall_0_left', new MeshStandardMaterial());
        full.position.x = 20;
        const perimeter = face('wall_0', new MeshStandardMaterial());
        perimeter.position.z = -1;
        room.add(group, named, full, perimeter);

    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0.8, 0.2, 5);
        camera.lookAt(0.8, 0.2, 0);
        camera.updateMatrixWorld(true);
        room.updateMatrixWorld(true);

        const hit = findRoomSurfaceHitForNdc(camera, new Vector2(0, 0), room);
        expect(hit?.object.name).to.equal('wall_0');
        expect(getRoomCeilingY(room)).to.be.closeTo(1, 1e-5);

        const onlyCutaway = new Group();
        onlyCutaway.add(group);
        onlyCutaway.updateMatrixWorld(true);
        expect(findRoomSurfaceHitForNdc(camera, new Vector2(0, 0), onlyCutaway))
            .to.equal(null);
      });

  test('restores a material array and treats an unknown mode as solid', () => {
    const a = new MeshStandardMaterial();
    const b = new MeshStandardMaterial();
    const root = new Group();
    const mesh = face('innerWall_0_left', [a, b]);
    root.add(mesh);
    const state = new InnerWallModeState();
    state.apply(root, 'transparent');
    const glass = mesh.material as MeshStandardMaterial[];
    expect(glass).to.have.lengthOf(2);
    expect(glass[0]).to.not.equal(a);
    expect(glass[0].opacity).to.equal(0.2);
    expect(a.opacity).to.equal(1);
    state.apply(root, normalizeInnerWallMode('glass'));
    expect(mesh.material).to.deep.equal([a, b]);
    expect(mesh.visible).to.be.true;
    state.reset();
  });
});
