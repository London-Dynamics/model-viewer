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
  let loadCount = 0;
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
    return {scene: sceneNode};
  };
  return {
    getLoadCount: () => loadCount,
    restore: () => {
      renderer.loader.load = originalLoad;
    },
  };
};

const boundsPart = {
  type: 'scene' as const,
  bounds: {
    min: [-0.5, 0, -0.5] as [number, number, number],
    max: [0.5, 1, 0.5] as [number, number, number],
    center: [0, 0.5, 0] as [number, number, number],
    radius: 1,
  },
};

suite('ld-modular placeGlb', () => {
  let element: ModelViewerElement;
  let target: Object3D;
  let loader: ReturnType<typeof installMockLoader>;

  setup(() => {
    element = new ModelViewerElement();
    const harness = prepareSceneHarness(element);
    target = harness.target;
    // Offset camera so viewport-center ray hits a non-origin point on the floor.
    harness.camera.position.set(4, 3, 4);
    harness.camera.lookAt(0, 0, 0);
    harness.camera.updateMatrixWorld(true);
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

  test('placeGlb emits placeholder-loaded before loading-start on session', async () => {
    const events: string[] = [];
    let placeholderVisibleOnLoad = false;

    await element.placeGlb(undefined, {
      id: 'chair-1',
      part: boundsPart,
      getHighResUrl: async () => 'chair.glb',
      onSession: (session) => {
        session.addEventListener('placeholder-loaded', () => {
          events.push('placeholder-loaded');
          placeholderVisibleOnLoad = session.placeholder?.visible === true;
        });
        session.addEventListener('loading-start', () => {
          events.push('loading-start');
        });
      },
    });

    expect(events).to.deep.equal(['placeholder-loaded', 'loading-start']);
    expect(placeholderVisibleOnLoad).to.equal(true);
    expect(loader.getLoadCount()).to.equal(1);

    const placed: Object3D[] = [];
    target.traverse((child) => {
      if (child.userData?.isPlacedObject && child !== target) {
        placed.push(child);
      }
    });
    expect(placed).to.have.length(1);
    expect(placed[0].userData.id).to.equal('chair-1');
  });

  test('placeGlb calls onSession synchronously before placeholder load', () => {
    let onSessionCalled = false;
    let sessionIdAtCallback: string | undefined;

    const promise = element.placeGlb(undefined, {
      id: 'sync-check',
      part: boundsPart,
      getHighResUrl: async () => 'chair.glb',
      onSession: (session) => {
        onSessionCalled = true;
        sessionIdAtCallback = session.id;
      },
    });

    expect(onSessionCalled).to.equal(true);
    expect(sessionIdAtCallback).to.be.a('string');
    return promise;
  });

  test('placeGlb without position uses scene origin fallback (0, y, 0)', async () => {
    let placeholderPosition: [number, number, number] | null = null;

    await element.placeGlb(undefined, {
      id: 'origin-fallback',
      part: boundsPart,
      getHighResUrl: async () => 'chair.glb',
      onSession: (session) => {
        session.addEventListener('loading-start', () => {
          if (session.placeholder) {
            placeholderPosition = session.placeholder.position.toArray() as [
              number,
              number,
              number,
            ];
          }
        });
      },
    });

    expect(placeholderPosition).to.not.equal(null);
    expect(placeholderPosition![0]).to.equal(0);
    expect(placeholderPosition![2]).to.equal(0);
  });

  test('placeGlb with skipPlaceholderFeedback skips placeholder-loaded', async () => {
    const events: string[] = [];

    await element.placeGlb('chair.glb', {
      id: 'bulk-item',
      part: boundsPart,
      position: [0, 0, 0],
      skipPlaceholderFeedback: true,
      onSession: (session) => {
        session.addEventListener('placeholder-loaded', () => {
          events.push('placeholder-loaded');
        });
        session.addEventListener('loading-start', () => {
          events.push('loading-start');
        });
      },
    });

    expect(events).to.deep.equal(['loading-start']);
  });
});
