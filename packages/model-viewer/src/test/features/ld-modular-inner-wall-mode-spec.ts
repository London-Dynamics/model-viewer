/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {Group, Object3D} from 'three';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';

function placed(
    parent: Object3D, attachedWallName: string | undefined,
    attachedSurfaceName: string): Object3D {
  const object = new Object3D();
  object.userData.isPlacedObject = true;
  object.userData.attachedSurfaceName = attachedSurfaceName;
  if (attachedWallName) object.userData.attachedWallName = attachedWallName;
  parent.add(object);
  return object;
}

suite('ld-modular inner wall mode', () => {
  test('hides objects snapped to inner walls without removing them', () => {
    const element = new ModelViewerElement();
    const scene = new Group();
    const room = new Group();
    room.userData.isBaseModel = true;
    scene.add(room);
    const target = new Group();
    (scene as Group & {target: Object3D; queueRender(): void}).target = target;
    (scene as Group & {queueRender(): void}).queueRender = () => {};
    (element as unknown as {[$scene]: Object3D})[$scene] = scene;
    const apply =
        () => (element as unknown as {_applyInnerWallMode(): void})
                  ._applyInnerWallMode();

    const onInner = placed(target, 'innerWall_0_left', 'innerWall_0_left');
    const tagged = placed(target, 'innerWall_1_right', 'innerWall_1_right');
    tagged.userData.tagHidden = true;
    const onPerimeter = placed(target, 'wall_0', 'wall_0');
    const onFloor = placed(target, undefined, 'floor');
    onFloor.userData.attachedSurfaceType = 'floor';

    element.srcIsRoom = true;
    element.walls = true;
    element.innerWallMode = 'cutaway';
    apply();

    expect(onInner.visible).to.equal(false);
    expect(onInner.parent).to.equal(target);
    expect(onInner.userData.isPlacedObject).to.equal(true);
    expect(onInner.userData.attachedWallName).to.equal('innerWall_0_left');
    expect(tagged.visible).to.equal(false);
    expect(onPerimeter.visible).to.equal(true);
    expect(onFloor.visible).to.equal(true);

    element.innerWallMode = 'hidden';
    apply();
    expect(onInner.visible).to.equal(false);
    expect(onInner.parent).to.equal(target);

    element.innerWallMode = 'transparent';
    apply();
    expect(onInner.visible).to.equal(true);
    expect(tagged.visible).to.equal(false);
    expect(onPerimeter.visible).to.equal(true);

    element.innerWallMode = 'solid';
    apply();
    expect(onInner.visible).to.equal(true);
    expect(onInner.parent).to.equal(target);
    expect(onInner.userData.attachedWallName).to.equal('innerWall_0_left');
    expect(tagged.visible).to.equal(false);
    expect(onPerimeter.visible).to.equal(true);
    expect(onFloor.visible).to.equal(true);

    element.srcIsRoom = false;
    apply();
    expect(onInner.visible).to.equal(true);
    expect(onInner.parent).to.equal(target);
  });
});
