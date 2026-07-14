/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from 'three';

import {
  attachGltfLifecycle,
  disposePlacedObjectSubtree,
  hasGltfLifecycle,
  LD_GLTF_SRC,
  releaseGltfLifecycle,
} from '../../features/ld-modular/gltf-lifecycle.js';

suite('ld-modular gltf-lifecycle', () => {
  test('attachGltfLifecycle stores src and release; release runs once', () => {
    const root = new Object3D();
    let releases = 0;
    attachGltfLifecycle(root, 'part.glb', () => {
      releases += 1;
    });

    expect(root.userData[LD_GLTF_SRC]).to.equal('part.glb');
    expect(hasGltfLifecycle(root)).to.equal(true);

    releaseGltfLifecycle(root);
    expect(releases).to.equal(1);
    expect(hasGltfLifecycle(root)).to.equal(false);

    releaseGltfLifecycle(root);
    expect(releases).to.equal(1);
  });

  test('lifecycle survives userData object replacement', () => {
    const root = new Object3D();
    let releases = 0;
    attachGltfLifecycle(root, 'part.glb', () => {
      releases += 1;
    });

    root.userData = {
      ...root.userData,
      isPlacedObject: true,
      id: 'x',
    };

    expect(hasGltfLifecycle(root)).to.equal(true);
    expect(root.userData[LD_GLTF_SRC]).to.equal('part.glb');
    releaseGltfLifecycle(root);
    expect(releases).to.equal(1);
  });

  test('disposePlacedObjectSubtree does not dispose shared geometry', () => {
    const geometry = new BoxGeometry(1, 1, 1);
    const materialA = new MeshBasicMaterial();
    const materialB = new MeshBasicMaterial();
    const meshA = new Mesh(geometry, materialA);
    const meshB = new Mesh(geometry, materialB);
    const root = new Object3D();
    root.add(meshA);
    root.add(meshB);

    disposePlacedObjectSubtree(root);

    expect(geometry.getAttribute('position')).to.not.equal(undefined);
    expect(geometry.uuid).to.be.a('string');
  });
});
