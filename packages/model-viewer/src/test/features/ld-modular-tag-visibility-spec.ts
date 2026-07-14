/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
} from 'three';

import {$renderer, $scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';

const prepareSceneHarness = (element: ModelViewerElement) => {
  const target = new Object3D();
  target.name = 'scene-target';

  const camera = new PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 3, 6);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const scene = {
    target,
    camera,
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
    updateBoundingBox() {},
  };

  (element as any)[$scene] = scene;
  return {target, camera};
};

const installMockLoader = (element: ModelViewerElement) => {
  const renderer = (element as any)[$renderer];
  const originalLoad = renderer.loader.load.bind(renderer.loader);
  renderer.loader.load = async (src: string) => {
    const sceneNode = new Object3D();
    sceneNode.userData.loadedFrom = src;
    const mesh = new Mesh(
      new BoxGeometry(0.5, 0.5, 0.5),
      new MeshBasicMaterial()
    );
    sceneNode.add(mesh);
    return {scene: sceneNode};
  };
  return {
    restore: () => {
      renderer.loader.load = originalLoad;
    },
  };
};

const taggedPart = {
  type: 'scene' as const,
  id: 'ada-part',
  name: 'Ada Part',
  productId: 'product-ada',
  tags: ['ada'],
  bounds: {
    min: [-0.5, 0, -0.5] as [number, number, number],
    max: [0.5, 1, 0.5] as [number, number, number],
  },
};

const getPlacedRoots = (target: Object3D) => {
  const placed: Object3D[] = [];
  target.traverse((child) => {
    if (child.userData?.isPlacedObject && child !== target) {
      placed.push(child);
    }
  });
  return placed;
};

suite('ld-modular tag visibility', () => {
  let element: ModelViewerElement;
  let target: Object3D;
  let loader: ReturnType<typeof installMockLoader>;

  setup(() => {
    element = new ModelViewerElement();
    const harness = prepareSceneHarness(element);
    target = harness.target;
    loader = installMockLoader(element);
    element.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
        right: 800,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  });

  teardown(() => {
    loader.restore();
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  test('hideByTag and showByTag toggle placed object visibility', async () => {
    await element.placeGlb('ada.glb', {
      id: 'ada-1',
      part: taggedPart,
      position: [0, 0, 0],
      skipPlaceholderFeedback: true,
    });

    const [placed] = getPlacedRoots(target);
    expect(placed).to.exist;
    expect(placed.visible).to.equal(true);

    element.hideByTag('ada');
    expect(placed.visible).to.equal(false);
    expect(placed.userData.tagHidden).to.equal(true);

    element.showByTag('ada');
    expect(placed.visible).to.equal(true);
    expect(placed.userData.tagHidden).to.not.equal(true);
  });

  test('object placed while tag is hidden is hidden on commit', async () => {
    element.hideByTag('ada');

    await element.placeGlb('ada.glb', {
      id: 'ada-hidden',
      part: taggedPart,
      position: [1, 0, 0],
      skipPlaceholderFeedback: true,
    });

    const placed = getPlacedRoots(target).find(
      (node) => node.userData.id === 'ada-hidden'
    );
    expect(placed).to.exist;
    expect(placed!.visible).to.equal(false);
    expect(placed!.userData.tagHidden).to.equal(true);
  });

  test('replacePart reindexes tags and preserves tagHidden', async () => {
    await element.placeGlb('ada.glb', {
      id: 'replace-me',
      part: taggedPart,
      position: [0, 0, 0],
      skipPlaceholderFeedback: true,
    });

    const [placed] = getPlacedRoots(target);
    element.hideByTag('ada');
    expect(placed.visible).to.equal(false);

    const uuid = placed.uuid;
    await element.replacePart(uuid, 'other.glb', {
      part: {
        ...taggedPart,
        id: 'other-part',
        tags: ['other'],
      } as any,
    });

    const replaced = target.getObjectByName('replace-me') as Object3D;
    expect(replaced).to.exist;
    expect(replaced.userData.tagHidden).to.equal(true);
    expect(replaced.visible).to.equal(false);

    element.showByTag('other');
    expect(replaced.visible).to.equal(true);

    element.hideByTag('ada');
    expect(replaced.visible).to.equal(true);
  });

  test('hideByTag filter skips objects that do not match', async () => {
    await element.placeGlb('ada.glb', {
      id: 'bulk-ada',
      part: taggedPart,
      position: [0, 0, 0],
      skipPlaceholderFeedback: true,
    });

    const [placed] = getPlacedRoots(target);
    placed.userData.placedByUser = true;

    element.hideByTag('ada', (object) => object.userData.placedByUser !== true);
    expect(placed.visible).to.equal(true);

    element.hideByTag('ada');
    expect(placed.visible).to.equal(false);
  });

  test('room attachment visibility respects tagHidden', async () => {
    await element.placeGlb('ada.glb', {
      id: 'wall-ada',
      part: taggedPart,
      position: [0, 0, 0],
      skipPlaceholderFeedback: true,
    });

    const [placed] = getPlacedRoots(target);
    (element as any)._roomAttachedObjectsByWallName.set(
      'wall_north',
      new Set([placed])
    );

    element.hideByTag('ada');
    expect(placed.userData.tagHidden).to.equal(true);

    (element as any)._setWallAttachmentsVisibility('wall_north', true);
    expect(placed.visible).to.equal(false);
  });
});
