/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {Group, Object3D} from 'three';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';

const declaration = {
  version: '1.6.0',
  generator: 'createSpace' as const,
  perimeterWalls: 4,
  innerWalls: 1,
  cutaway: true,
};

suite('ld-modular roomSource', () => {
  test('reads a valid declaration from the room under the base model', () => {
    const element = new ModelViewerElement();
    const scene = new Group();
    const base = new Group();
    base.userData.isBaseModel = true;
    const room = new Group();
    room.name = 'room';
    room.userData.ldBuilder = declaration;
    base.add(room);
    scene.add(base);

    const decoy = new Group();
    decoy.userData.ldBuilder = {...declaration, generator: 'createRoom', cutaway: false};
    scene.add(decoy);
    (element as unknown as {[$scene]: Object3D})[$scene] = scene;

    expect(element.roomSource).to.deep.equal({
      kind: 'ldBuilder',
      ldBuilder: declaration,
    });
  });

  test('is null when the declaration is missing or malformed', () => {
    const element = new ModelViewerElement();
    const scene = new Group();
    const base = new Group();
    base.userData.isBaseModel = true;
    const room = new Group();
    room.name = 'room';
    base.add(room);
    scene.add(base);
    (element as unknown as {[$scene]: Object3D})[$scene] = scene;

    expect(element.roomSource).to.equal(null);

    room.userData.ldBuilder = {version: '1.6.0', generator: 'upload'};
    expect(element.roomSource).to.equal(null);

    room.userData.ldBuilder = {...declaration, perimeterWalls: 1.5};
    expect(element.roomSource).to.equal(null);

    scene.clear();
    expect(element.roomSource).to.equal(null);
  });
});
