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

import {$renderer, $scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {tryCloneExistingGltfScene} from '../../features/ld-modular/gltf-reuse.js';
import {
  hasGltfLifecycle,
  LD_GLTF_SRC,
} from '../../features/ld-modular/gltf-lifecycle.js';

const prepareSceneHarness = (element: ModelViewerElement) => {
  const target = new Object3D();
  target.name = 'scene-target';

  const scene = {
    target,
    add(child: Object3D) {
      target.add(child);
    },
    getObjectByName(name: string) {
      return target.getObjectByName(name);
    },
    getObjectByProperty(prop: string, value: unknown) {
      let found: Object3D | null = null;
      target.traverse((child) => {
        if ((child as unknown as Record<string, unknown>)[prop] === value) {
          found = child;
        }
      });
      return found;
    },
    queueRender() {},
  };

  (element as any)[$scene] = scene;
  return {target};
};

const installMockLoader = (element: ModelViewerElement) => {
  let loadCount = 0;
  let disposeCount = 0;
  const renderer = (element as any)[$renderer];
  const originalLoad = renderer.loader.load.bind(renderer.loader);
  renderer.loader.load = async (src: string) => {
    loadCount += 1;
    const sceneNode = new Object3D();
    sceneNode.userData.loadedFrom = src;
    const mesh = new Mesh(
      new BoxGeometry(0.5, 0.5, 0.5),
      new MeshBasicMaterial()
    );
    sceneNode.add(mesh);
    return {
      scene: sceneNode,
      dispose: () => {
        disposeCount += 1;
      },
    };
  };
  return {
    getLoadCount: () => loadCount,
    getDisposeCount: () => disposeCount,
    restore: () => {
      renderer.loader.load = originalLoad;
    },
  };
};

const addPlacedPart = (
  target: Object3D,
  name: string,
  position: [number, number, number],
  extras?: {selection?: unknown; displayName?: string}
) => {
  const part = new Object3D();
  part.name = name;
  part.userData.isPlacedObject = true;
  part.position.set(position[0], position[1], position[2]);
  if (extras?.displayName) {
    part.userData.name = extras.displayName;
  }
  if (extras?.selection !== undefined) {
    part.userData.selection = extras.selection;
  }
  const mesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshBasicMaterial()
  );
  part.add(mesh);
  target.add(part);
  return part;
};

suite('ld-modular gltf reuse', () => {
  test('tryCloneExistingGltfScene returns null (placeholder)', () => {
    const scene = new Object3D();
    expect(tryCloneExistingGltfScene('model.glb', scene)).to.equal(null);
    expect(
      tryCloneExistingGltfScene('model.glb', scene, {partId: 'part-1'})
    ).to.equal(null);
  });
});

suite('ld-modular replacePart / replaceManyParts', () => {
  let element: ModelViewerElement;
  let target: Object3D;
  let loader: ReturnType<typeof installMockLoader>;

  setup(() => {
    element = new ModelViewerElement();
    ({target} = prepareSceneHarness(element));
    loader = installMockLoader(element);
  });

  teardown(() => {
    loader.restore();
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  test('replacePart preserves transforms and updates userData.selection', async () => {
    const original = addPlacedPart(target, 'chair-a', [1, 2, 3], {
      displayName: 'Chair A',
      selection: {id: 'sel-old'},
    });
    const originalUuid = original.uuid;

    await element.replacePart(originalUuid, 'replacement.glb', {
      selection: {id: 'sel-new'},
      part: {name: 'Replacement Chair'},
    });

    const replaced = element.getPart(originalUuid);
    expect(replaced).to.equal(null);

    const nodes: Object3D[] = [];
    target.traverse((child) => {
      if (child.userData?.isPlacedObject && child !== target) {
        nodes.push(child);
      }
    });
    expect(nodes).to.have.length(1);

    const newNode = nodes[0];
    expect(newNode.uuid).to.not.equal(originalUuid);
    expect(newNode.position.toArray()).to.deep.equal([1, 2, 3]);
    expect(newNode.userData.selection).to.deep.equal({id: 'sel-new'});
    expect(newNode.userData.part?.name).to.equal('Replacement Chair');
    expect(loader.getLoadCount()).to.equal(1);
  });

  test('replacePart undo restores the original object', async () => {
    const original = addPlacedPart(target, 'undo-chair', [0, 0, 0], {
      displayName: 'Undo Chair',
    });
    const originalUuid = original.uuid;
    const originalName = original.name;

    await element.replacePart(originalUuid, 'replacement.glb');
    expect(element.canUndo()).to.equal(true);
    expect(element.getHistoryState().undoLabel).to.match(/Replace Undo Chair/);

    const afterReplace: Object3D[] = [];
    target.traverse((child) => {
      if (child.userData?.isPlacedObject && child !== target) {
        afterReplace.push(child);
      }
    });
    expect(afterReplace).to.have.length(1);
    expect(afterReplace[0].uuid).to.not.equal(originalUuid);

    expect(element.undo()).to.equal(true);
    const restored = element.getPart(originalUuid);
    expect(restored).to.not.equal(null);
    expect(restored?.name).to.equal(originalName);
    expect(restored?.position.toArray()).to.deep.equal([0, 0, 0]);
  });

  test('replaceManyParts replaces multiple objects and batches undo', async () => {
    const first = addPlacedPart(target, 'bulk-a', [-1, 0, 0]);
    const second = addPlacedPart(target, 'bulk-b', [1, 0, 0]);

    const results = await element.replaceManyParts(
      [
        {objectUuid: first.uuid, src: 'a.glb'},
        {objectUuid: second.uuid, src: 'b.glb'},
      ],
      {concurrency: 2}
    );

    expect(results).to.have.length(2);
    expect(results[0].node.uuid).to.not.equal(first.uuid);
    expect(results[1].node.uuid).to.not.equal(second.uuid);
    expect(loader.getLoadCount()).to.equal(2);

    expect(element.getPart(first.uuid)).to.equal(null);
    expect(element.getPart(second.uuid)).to.equal(null);
    expect(element.canUndo()).to.equal(true);
    expect(element.getHistoryState().undoLabel).to.equal('Replace 2 objects');

    expect(element.undo()).to.equal(true);
    expect(element.getPart(first.uuid)).to.not.equal(null);
    expect(element.getPart(second.uuid)).to.not.equal(null);
  });

  test('replacePart attaches gltf lifecycle and releases on clearUndoHistory', async () => {
    const original = addPlacedPart(target, 'lifecycle-chair', [0, 1, 0], {
      displayName: 'Lifecycle Chair',
    });

    await element.replacePart(original.uuid, 'replacement.glb');
    expect(loader.getLoadCount()).to.equal(1);
    expect(loader.getDisposeCount()).to.equal(0);

    const nodes: Object3D[] = [];
    target.traverse((child) => {
      if (child.userData?.isPlacedObject && child !== target) {
        nodes.push(child);
      }
    });
    expect(nodes).to.have.length(1);
    const newNode = nodes[0];
    expect(hasGltfLifecycle(newNode)).to.equal(true);
    expect(newNode.userData[LD_GLTF_SRC]).to.equal('replacement.glb');

    // Live replacement must keep its retain; clearing history only releases
    // the replaced (graveyard) node — which had no lifecycle in this harness.
    element.clearUndoHistory();
    expect(hasGltfLifecycle(newNode)).to.equal(true);
    expect(loader.getDisposeCount()).to.equal(0);

    expect(element.deleteNode!(newNode)).to.equal(true);
    expect(hasGltfLifecycle(newNode)).to.equal(true);
    element.clearUndoHistory();
    expect(loader.getDisposeCount()).to.equal(1);
    expect(hasGltfLifecycle(newNode)).to.equal(false);
  });
});
