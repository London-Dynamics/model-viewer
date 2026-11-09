/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {BoxGeometry, Euler, Mesh, MeshBasicMaterial, Quaternion, Vector3} from 'three';

import {$controls} from '../../features/controls.js';
import {$markLoaded, $renderer, $scene, $tick} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {CachingGLTFLoader} from '../../three-components/CachingGLTFLoader.js';
import {timePasses, waitForEvent as waitForEventUnbounded,} from '../../utilities.js';
import {assetPath} from '../helpers.js';

function waitForEvent<T>(
    target: EventTarget,
    eventName: string,
    predicate?: ((event: T) => boolean)|null): Promise<T> {
  return within(
      waitForEventUnbounded(target, eventName, predicate ?? null),
      8000,
      eventName);
}

const MAIN_MODEL = assetPath('models/Astronaut.glb');
const OTHER_MODEL = assetPath('models/cube.gltf');
const ENVIRONMENT_MODEL = assetPath('models/reflective-sphere.gltf');
const OTHER_ENVIRONMENT = assetPath('models/Triangle.gltf');

function resourceFetches(fragment: string): number {
  return performance.getEntriesByType('resource')
      .filter((entry) => entry.name.includes(fragment))
      .length;
}

async function within<T>(
    promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(
        () => reject(new Error(`timed out waiting for ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}

function posterShown(element: ModelViewerElement): boolean {
  const poster = element.shadowRoot?.querySelector('.slot.poster');
  return !!poster && poster.classList.contains('show');
}

function delayLoaderUrl(element: ModelViewerElement, fragment: string) {
  const loader = element[$renderer].loader;
  const original = loader.load.bind(loader);
  let open = true;
  let releaseGate = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const wrapped: typeof loader.load = (url, el, progress, bucket) => {
    if (open && url.includes(fragment)) {
      return gate.then(() => original(url, el, progress, bucket));
    }
    return original(url, el, progress, bucket);
  };
  loader.load = wrapped;
  return {
    release() {
      open = false;
      releaseGate();
    },
    restore() {
      if (loader.load === wrapped) {
        loader.load = original as typeof loader.load;
      }
    },
  };
}

suite('LDEnvironment', function() {
  this.timeout(15000);
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
    document.body.insertBefore(element, document.body.firstChild);
  });

  teardown(async () => {
    element.remove();
    // Scene disposal releases cache retainers on a short timeout.
    await timePasses(30);
  });

  test('keeps environment objects outside the main target', async () => {
    const scene = element[$scene];
    const main = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const environment =
        new Mesh(new BoxGeometry(100, 100, 100), new MeshBasicMaterial());

    await scene.setObject(main);
    const dimensions = element.getDimensions().toString();
    const srcRadius = scene.boundingSphere.radius;
    scene.setEnvironmentModel(environment);

    expect(scene.environmentRoot.parent).to.equal(scene);
    expect(environment.parent).to.equal(scene.environmentRoot);
    expect(element.getDimensions().toString()).to.equal(dimensions);
    expect(scene.boundingSphere.radius).to.equal(srcRadius);
    expect(scene.target.children).not.to.include(environment);
  });

  test(
      'loads the environment model independently of the main load event',
      async () => {
        const events: string[] = [];
        const load = waitForEvent(element, 'load');
        const environmentLoad = waitForEvent(element, 'environment-model-load');

        element.environmentModel = ENVIRONMENT_MODEL;
        element.addEventListener('load', () => events.push('load'));
        element.addEventListener(
            'environment-model-load',
            () => events.push('environment-model-load'));
        element.src = MAIN_MODEL;

        await Promise.all([load, environmentLoad]);

        expect(events).to.include('load');
        expect(events).to.include('environment-model-load');
      });

  test(
      'does not reveal either model until a slower environment is ready',
      async () => {
        const gate = delayLoaderUrl(element, 'reflective-sphere');
        let sawBothAtReveal = false;
        const markLoaded = element[$markLoaded].bind(element);
        element[$markLoaded] = () => {
          const scene = element[$scene];
          sawBothAtReveal = scene.model != null &&
              scene.environmentRoot.children.length > 0 &&
              scene.environmentRoot.visible;
          markLoaded();
        };
        let loadFired = false;
        element.addEventListener('load', () => {
          loadFired = true;
        });
        const load = waitForEvent(element, 'load');
        const environmentLoad = waitForEvent(element, 'environment-model-load');
        try {
          element.environmentModel = ENVIRONMENT_MODEL;
          element.src = MAIN_MODEL;
          let appeared = false;
          for (let i = 0; i < 40 && !appeared; i++) {
            appeared = element[$scene].model != null;
            if (!appeared) {
              await timePasses(100);
            }
          }
          expect(appeared, `loaded=${element.loaded}`).to.equal(true);
          await timePasses(50);

          expect(loadFired).to.equal(false);
          expect(element.loaded).to.equal(false);
          expect(posterShown(element)).to.equal(true);
          expect(element[$scene].renderCount).to.equal(0);
          expect(element[$scene].environmentRoot.children).to.have.lengthOf(0);

          gate.release();
          await within(
              Promise.all([load, environmentLoad]), 8000, 'reveal together');
          await timePasses();

          expect(sawBothAtReveal).to.equal(true);
          expect(element.loaded).to.equal(true);
          expect(posterShown(element)).to.equal(false);
          expect(element[$scene].model).to.be.ok;
          expect(element[$scene].environmentRoot.children.length)
              .to.be.greaterThan(0);
        } finally {
          gate.release();
          gate.restore();
        }
      });

  test('does not reveal a faster environment model before src', async () => {
    const gate = delayLoaderUrl(element, 'Astronaut.glb');
    let sawBothAtReveal = false;
    const markLoaded = element[$markLoaded].bind(element);
    element[$markLoaded] = () => {
      const scene = element[$scene];
      sawBothAtReveal = scene.model != null &&
          scene.environmentRoot.children.length > 0 &&
          scene.environmentRoot.visible;
      markLoaded();
    };
    const environmentLoad = waitForEvent(element, 'environment-model-load');
    const load = waitForEvent(element, 'load');
    try {
      element.environmentModel = ENVIRONMENT_MODEL;
      element.src = MAIN_MODEL;
      await within(environmentLoad, 8000, 'environment before src');
      await timePasses(50);

      expect(element.loaded).to.equal(false);
      expect(posterShown(element)).to.equal(true);
      expect(element[$scene].renderCount).to.equal(0);
      expect(element[$scene].environmentRoot.children.length)
          .to.be.greaterThan(0);
      expect(element[$scene].model).to.equal(null);

      gate.release();
      await within(load, 8000, 'src reveal');
      await timePasses();

      expect(sawBothAtReveal).to.equal(true);
      expect(element.loaded).to.equal(true);
      expect(posterShown(element)).to.equal(false);
      expect(element[$scene].model).to.be.ok;
    } finally {
      gate.release();
      gate.restore();
    }
  });

  test(
      'does not wait for a new environment model when src changes later',
      async () => {
        const environmentLoad = waitForEvent(element, 'environment-model-load');
        const load = waitForEvent(element, 'load');
        element.environmentModel = ENVIRONMENT_MODEL;
        element.src = MAIN_MODEL;
        await Promise.all([environmentLoad, load]);

        const environment = element[$scene].environmentRoot.children[0];
        const gate = delayLoaderUrl(element, 'Triangle.gltf');
        const nextLoad = waitForEvent(element, 'load');
        try {
          element.environmentModel = OTHER_ENVIRONMENT;
          element.src = OTHER_MODEL;
          const result = await Promise.race([
            nextLoad.then(() => 'loaded' as const),
            timePasses(1000).then(() => 'timeout' as const),
          ]);

          expect(result).to.equal('loaded');
          expect(element.loaded).to.equal(true);
          expect(posterShown(element)).to.equal(false);

          const replaced = waitForEvent(element, 'environment-model-load');
          gate.release();
          await within(replaced, 8000, 'replacement environment');
          const nextEnvironment = element[$scene].environmentRoot.children[0];
          expect(nextEnvironment).to.be.ok;
          expect(nextEnvironment).to.not.equal(environment);
          expect(element[$scene].environmentRoot.visible).to.equal(true);
        } finally {
          gate.release();
          gate.restore();
        }
      });

  test('loads the environment model without waiting for src', async () => {
    const scene = element[$scene];
    const originalSetSource = scene.setSource.bind(scene);
    let releaseSrc = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseSrc = resolve;
    });
    scene.setSource = async (url, progressCallback) => {
      await gate;
      return originalSetSource(url, progressCallback);
    };

    try {
      const environmentLoad = waitForEvent(element, 'environment-model-load');
      element.environmentModel = ENVIRONMENT_MODEL;
      element.src = MAIN_MODEL;

      const result = await Promise.race([
        environmentLoad.then(() => 'loaded' as const),
        timePasses(1000).then(() => 'timeout' as const),
      ]);

      expect(result).to.equal('loaded');
      expect(element.loaded).to.equal(false);
      expect(scene.environmentRoot.children.length).to.be.greaterThan(0);
      expect(scene.target.children)
          .to.not.include(scene.environmentRoot.children[0]);
    } finally {
      releaseSrc();
      scene.setSource = originalSetSource;
    }
  });

  test(
      'does not fail the main model when the environment model fails',
      async () => {
        const load = waitForEvent(element, 'load');
        const environmentError =
            waitForEvent(element, 'environment-model-error');

        element.environmentModel = assetPath('models/does-not-exist.glb');
        element.src = MAIN_MODEL;

        await Promise.all([load, environmentError]);

        expect(element.loaded).to.equal(true);
        expect(posterShown(element)).to.equal(false);
        expect(element[$scene].currentGLTF).to.be.ok;
      });

  test('marks environment model nodes non-interactive', async () => {
    const environmentLoad = waitForEvent(element, 'environment-model-load');
    const load = waitForEvent(element, 'load');
    element.environmentModel = ENVIRONMENT_MODEL;
    element.src = MAIN_MODEL;
    await Promise.all([environmentLoad, load]);

    const environmentRoot = element[$scene].environmentRoot;
    environmentRoot.traverse((node) => {
      if (node !== environmentRoot) {
        expect(node.userData.noHit).to.equal(true);
        expect(node.userData.selectable).to.equal(false);
      }
    });
  });

  test(
      'keeps the same environment model visible when src changes', async () => {
        element.environmentModelPosition = '1m 2m 3m';
        element.environmentModelScale = '2 3 4';
        const environmentLoad = waitForEvent(element, 'environment-model-load');
        const load = waitForEvent(element, 'load');
        element.environmentModel = ENVIRONMENT_MODEL;
        element.src = MAIN_MODEL;
        await Promise.all([environmentLoad, load]);
        element.cameraControls = true;
        element.interactionPrompt = 'none';
        await within(element.updateComplete, 8000, 'updateComplete');

        const scene = element[$scene];
        const environment = scene.environmentRoot.children[0];
        const framedRadius = scene.boundingSphere.radius;
        const product = scene.model;
        expect(environment).to.be.ok;
        expect(scene.environmentRoot.visible).to.equal(true);
        expect(environment.visible).to.equal(true);
        expect(scene.hasEnvironmentBounds()).to.equal(true);

        const envFetches = resourceFetches('reflective-sphere');
        const nextLoad = waitForEvent(element, 'load');
        element.src = OTHER_MODEL;
        await within(element.updateComplete, 8000, 'updateComplete');

        expect(scene.environmentRoot.children[0]).to.equal(environment);
        expect(environment.parent).to.equal(scene.environmentRoot);
        expect(scene.environmentRoot.visible).to.equal(true);
        expect(environment.visible).to.equal(true);
        expect(scene.hasEnvironmentBounds()).to.equal(true);
        expect(scene.target.children).to.not.include(environment);

        await nextLoad;
        await timePasses(300);

        expect(scene.environmentRoot.children[0]).to.equal(environment);
        expect(scene.environmentRoot.visible).to.equal(true);
        expect(resourceFetches('reflective-sphere')).to.equal(envFetches);
        expect(scene.model).to.not.equal(product);
        expect(scene.boundingSphere.radius).to.not.equal(framedRadius);
        expect(scene.target.children).to.not.include(environment);
        expect(scene.environmentRoot.position.x).to.equal(1);
        expect(scene.environmentRoot.position.y).to.equal(2);
        expect(scene.environmentRoot.position.z).to.equal(3);
        expect(scene.environmentRoot.scale.x).to.equal(2);
        expect(scene.environmentRoot.scale.y).to.equal(3);
        expect(scene.environmentRoot.scale.z).to.equal(4);
        environment.traverse((node) => {
          if ('castShadow' in node && node !== scene.environmentRoot) {
            expect((node as {castShadow?: boolean}).castShadow).to.equal(false);
            expect((node as {receiveShadow?: boolean}).receiveShadow)
                .to.equal(false);
          }
        });
        const camera = scene.camera;
        expect(camera.far).to.be.at.least(scene.environmentViewDepth(camera));
      });

  for (const cacheSize of [0, 1]) {
    test(
        `modelCacheSize ${
            cacheSize} does not evict the in-use environment model`,
        async () => {
          const previousCacheSize = ModelViewerElement.modelCacheSize;
          ModelViewerElement.modelCacheSize = cacheSize;
          try {
            const environmentLoad =
                waitForEvent(element, 'environment-model-load');
            const load = waitForEvent(element, 'load');
            element.environmentModel = ENVIRONMENT_MODEL;
            element.src = MAIN_MODEL;
            await Promise.all([environmentLoad, load]);

            const environment = element[$scene].environmentRoot.children[0];
            expect(CachingGLTFLoader.has(ENVIRONMENT_MODEL)).to.equal(true);
            expect(CachingGLTFLoader.cache.has(ENVIRONMENT_MODEL))
                .to.equal(false);

            const envFetches = resourceFetches('reflective-sphere');
            const nextLoad = waitForEvent(element, 'load');
            element.src = OTHER_MODEL;
            await within(element.updateComplete, 8000, 'updateComplete');
            expect(CachingGLTFLoader.has(ENVIRONMENT_MODEL)).to.equal(true);
            expect(element[$scene].environmentRoot.children[0])
                .to.equal(environment);

            await nextLoad;
            await timePasses(300);

            expect(CachingGLTFLoader.has(ENVIRONMENT_MODEL)).to.equal(true);
            expect(element[$scene].environmentRoot.children[0])
                .to.equal(environment);
            expect(element[$scene].environmentRoot.visible).to.equal(true);
            expect(resourceFetches('reflective-sphere')).to.equal(envFetches);
          } finally {
            ModelViewerElement.modelCacheSize = previousCacheSize;
          }
        });
  }

  test(
      'replaces the environment model when environment-model changes',
      async () => {
        element.environmentModel = ENVIRONMENT_MODEL;
        element.src = MAIN_MODEL;
        await waitForEvent(element, 'environment-model-load');

        const scene = element[$scene];
        const first = scene.environmentRoot.children[0];
        const nextEnvironment = waitForEvent(element, 'environment-model-load');
        element.environmentModel = OTHER_ENVIRONMENT;
        await nextEnvironment;

        expect(scene.environmentRoot.children).to.have.lengthOf(1);
        expect(scene.environmentRoot.children[0]).to.not.equal(first);
        expect(scene.environmentRoot.children[0].visible).to.equal(true);
        expect(scene.environmentRoot.visible).to.equal(true);
        expect(first.parent).to.equal(null);
      });

  test(
      'keeps a replaced environment model cached when modelCacheSize is 0',
      async () => {
        const previousCacheSize = ModelViewerElement.modelCacheSize;
        ModelViewerElement.modelCacheSize = 0;
        try {
          const environmentLoad =
              waitForEvent(element, 'environment-model-load');
          const load = waitForEvent(element, 'load');
          element.environmentModel = ENVIRONMENT_MODEL;
          element.src = MAIN_MODEL;
          await Promise.all([environmentLoad, load]);
          expect(CachingGLTFLoader.has(ENVIRONMENT_MODEL)).to.equal(true);

          const replacement = waitForEvent(element, 'environment-model-load');
          element.environmentModel = OTHER_ENVIRONMENT;
          await replacement;
          expect(element[$scene].environmentRoot.children).to.have.lengthOf(1);
          expect(CachingGLTFLoader.has(ENVIRONMENT_MODEL)).to.equal(true);
          expect(CachingGLTFLoader.has(OTHER_ENVIRONMENT)).to.equal(true);

          const envFetches = resourceFetches('reflective-sphere');
          const restored = waitForEvent(element, 'environment-model-load');
          element.environmentModel = ENVIRONMENT_MODEL;
          await restored;
          await timePasses(300);
          expect(resourceFetches('reflective-sphere')).to.equal(envFetches);
          expect(element[$scene].environmentRoot.children).to.have.lengthOf(1);
          expect(element[$scene].environmentRoot.visible).to.equal(true);
        } finally {
          ModelViewerElement.modelCacheSize = previousCacheSize;
        }
      });

  test('removing environment-model leaves the main model loaded', async () => {
    const environmentLoad = waitForEvent(element, 'environment-model-load');
    const load = waitForEvent(element, 'load');
    element.environmentModel = ENVIRONMENT_MODEL;
    element.src = MAIN_MODEL;
    await Promise.all([environmentLoad, load]);

    const mainModel = element[$scene].model;
    element.environmentModel = null;
    await timePasses(50);

    expect(element[$scene].environmentRoot.children).to.have.lengthOf(0);
    expect(element[$scene].model).to.equal(mainModel);
    expect(element.loaded).to.equal(true);
  });

  test(
      'can hide the environment root for AR and restore it afterwards',
      async () => {
        const scene = element[$scene];
        scene.setEnvironmentModel(
            new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));

        scene.setEnvironmentModelVisible(false);
        expect(scene.environmentRoot.visible).to.equal(false);

        scene.setEnvironmentModelVisible(true);
        expect(scene.environmentRoot.visible).to.equal(true);
      });

  test(
      'applies environment model transforms to the environment root',
      async () => {
        const scene = element[$scene];

        element.environmentModelPosition = '1m 2m 3m';
        element.environmentModelOrientation = '10deg 20deg 30deg';
        element.environmentModelScale = '2 3 4';
        await within(element.updateComplete, 8000, 'updateComplete');

        const expectedQuaternion = new Quaternion().setFromEuler(new Euler(
            20 * Math.PI / 180, 30 * Math.PI / 180, 10 * Math.PI / 180, 'YXZ'));

        expect(scene.environmentRoot.position).to.eql(new Vector3(1, 2, 3));
        expect(scene.environmentRoot.quaternion.x)
            .to.be.closeTo(expectedQuaternion.x, 0.0001);
        expect(scene.environmentRoot.quaternion.y)
            .to.be.closeTo(expectedQuaternion.y, 0.0001);
        expect(scene.environmentRoot.quaternion.z)
            .to.be.closeTo(expectedQuaternion.z, 0.0001);
        expect(scene.environmentRoot.quaternion.w)
            .to.be.closeTo(expectedQuaternion.w, 0.0001);
        expect(scene.environmentRoot.scale).to.eql(new Vector3(2, 3, 4));
      });

  test(
      'camera-target changes CameraControls target when environment-model is set',
      async () => {
        element.cameraControls = true;
        element.environmentModel = ENVIRONMENT_MODEL;
        await within(element.updateComplete, 8000, 'updateComplete');

        const scene = element[$scene];
        const controls = (element as any)[$controls];
        const originalSceneTarget = scene.getTarget();

        element.cameraTarget = '0m 0.45m 0m';
        await within(element.updateComplete, 8000, 'updateComplete');

        const controlsTarget = new Vector3();
        controls.thirdPartyControls.getTarget(controlsTarget);

        expect(scene.getTarget().x).to.be.closeTo(originalSceneTarget.x, 0.001);
        expect(scene.getTarget().y).to.be.closeTo(originalSceneTarget.y, 0.001);
        expect(scene.getTarget().z).to.be.closeTo(originalSceneTarget.z, 0.001);
        expect(controlsTarget.y).to.be.closeTo(0.45, 0.001);
      });

  test('applies skybox rotation to the visible skybox', async () => {
    element.skyboxRotation = '10deg 20deg 30deg';
    await within(element.updateComplete, 8000, 'updateComplete');

    const rotation = element[$scene].getSkyboxRotation();

    expect(rotation.x).to.be.closeTo(20 * Math.PI / 180, 0.0001);
    expect(rotation.y).to.be.closeTo(30 * Math.PI / 180, 0.0001);
    expect(rotation.z).to.be.closeTo(10 * Math.PI / 180, 0.0001);
  });

  test('applies skybox rotation to the render environment', async () => {
    element.skyboxRotation = '10deg 20deg 30deg';
    await within(element.updateComplete, 8000, 'updateComplete');

    const rotation = element[$scene].environmentRotation;

    expect(rotation.x).to.be.closeTo(20 * Math.PI / 180, 0.0001);
    expect(rotation.y).to.be.closeTo(30 * Math.PI / 180, 0.0001);
    expect(rotation.z).to.be.closeTo(10 * Math.PI / 180, 0.0001);
  });

  test('animates skybox rotation around the configured axis', async () => {
    element.skyboxRotation = '0deg 0deg 0deg';
    element.skyboxRotationAnimation = true;
    element.skyboxRotationAxis = 'y';
    element.skyboxRotationSpeed = '90deg/s';
    await within(element.updateComplete, 8000, 'updateComplete');

    element[$tick](performance.now(), 50);

    expect(element[$scene].getSkyboxRotation().y).to.be.greaterThan(0);
  });
});
