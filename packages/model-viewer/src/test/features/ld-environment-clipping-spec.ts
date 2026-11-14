/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {Box3, BoxGeometry, Camera, Mesh, MeshBasicMaterial, Object3D, PerspectiveCamera, Vector3} from 'three';

import {$controls} from '../../features/controls.js';
import {$isElementInViewport, $scene, $tick} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath} from '../helpers.js';

const MAIN_MODEL = assetPath('models/cube.gltf');
const ENVIRONMENT_MODEL = assetPath('models/reflective-sphere.gltf');
const PADDING_SLOP = 0.02;

/**
 * Independent of ModelScene: max view-space depth of an object's world AABB.
 * Three.js cameras look down -Z, so depth is -cameraZ.
 */
function environmentViewDepth(object: Object3D, camera: Camera): number {
  object.updateWorldMatrix(true, true);
  camera.updateWorldMatrix(true, false);
  const box = new Box3().setFromObject(object);
  if (box.isEmpty()) {
    return 0;
  }
  const corner = new Vector3();
  let depth = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        depth = Math.max(depth, -corner.z);
      }
    }
  }
  return depth;
}

function legacyCameraFar(element: ModelViewerElement): number {
  const scene = element[$scene];
  const controls = (element as any)[$controls];
  const orbitRadius = controls.options?.maximumRadius ?? 0;
  return Math.abs(2 * Math.max(scene.farRadius(), orbitRadius));
}

function expectFarCovers(
    camera: PerspectiveCamera, object: Object3D, legacyFar: number) {
  const depth = environmentViewDepth(object, camera);
  const required = Math.max(legacyFar, depth);
  expect(camera.far).to.be.at.least(required - 1e-3);
  expect(camera.far).to.be.at.most(required * (1 + PADDING_SLOP) + 0.05);
  expect(camera.near).to.equal(0.1);
}

suite('environment far clipping', () => {
  let element: ModelViewerElement;

  setup(async () => {
    element = new ModelViewerElement();
    document.body.insertBefore(element, document.body.firstChild);
    element.cameraControls = true;
    element.interactionPrompt = 'none';
    element.maxCameraOrbit = 'auto auto 2m';
    element.minCameraOrbit = 'auto auto 0.5m';
    element.cameraOrbit = '0deg 90deg 2m';
    element.src = MAIN_MODEL;
    await waitForEvent(element, 'load');
    await element.updateComplete;
  });

  teardown(() => {
    element.remove();
  });

  function camera(): PerspectiveCamera {
    return element[$scene].camera as PerspectiveCamera;
  }

  function controls(): any {
    return (element as any)[$controls];
  }

  function box(width: number, height: number, depth: number): Mesh {
    return new Mesh(
        new BoxGeometry(width, height, depth), new MeshBasicMaterial());
  }

  test(
      'without an environment model, far stays on the legacy orbit range',
      async () => {
        const far = camera().far;
        const near = camera().near;
        const fov = camera().fov;
        const maxDistance = controls().thirdPartyControls.maxDistance;
        expect((element as any).clipToEnv).to.equal(true);
        expect(element.hasAttribute('clip-to-env')).to.equal(false);
        element.setAttribute('clip-to-env', 'true');
        await element.updateComplete;

        expect((element as any).clipToEnv).to.equal(true);
        expect(camera().near).to.equal(0.1);
        expect(near).to.equal(0.1);
        expect(camera().far).to.be.closeTo(legacyCameraFar(element), 1e-3);
        expect(camera().far).to.be.closeTo(far, 1e-3);
        expect(camera().fov).to.equal(fov);
        expect(controls().thirdPartyControls.maxDistance).to.equal(maxDistance);
        expect(camera().far).to.be.lessThan(20);
      });

  test(
      'a large environment extends far past a constrained max orbit without changing zoom or framing',
      () => {
        const scene = element[$scene];
        const near = camera().near;
        const fov = camera().fov;
        const orbitRadius = element.getCameraOrbit().radius;
        const maxDistance = controls().thirdPartyControls.maxDistance;
        const minDistance = controls().thirdPartyControls.minDistance;
        const framedRadius = scene.boundingSphere.radius;
        const farRadius = scene.farRadius();
        const dimensions = element.getDimensions().toString();
        const legacyFar = legacyCameraFar(element);
        const environment = box(20, 6, 20);
        const forward = new Vector3();
        camera().updateWorldMatrix(true, false);
        camera().getWorldDirection(forward);
        environment.position.copy(forward).multiplyScalar(80);

        scene.setEnvironmentModel(environment);

        const depth = environmentViewDepth(environment, camera());
        expect(depth).to.be.greaterThan(legacyFar + 20);
        expectFarCovers(camera(), environment, legacyFar);
        expect(camera().near).to.equal(near);
        expect(camera().fov).to.equal(fov);
        expect(element.getCameraOrbit().radius)
            .to.be.closeTo(orbitRadius, 1e-3);
        expect(controls().thirdPartyControls.maxDistance).to.equal(maxDistance);
        expect(controls().thirdPartyControls.minDistance).to.equal(minDistance);
        expect(element.maxCameraOrbit).to.equal('auto auto 2m');
        expect(scene.boundingSphere.radius).to.equal(framedRadius);
        expect(scene.farRadius()).to.equal(farRadius);
        expect(element.getDimensions().toString()).to.equal(dimensions);
        expect(scene.target.children).to.not.include(environment);
        expect(environment.parent).to.equal(scene.environmentRoot);
        expect((element as any).clipToEnv).to.equal(true);
        expect(element.hasAttribute('clip-to-env')).to.equal(false);
      });

  test('moving the environment along the view extends far', async () => {
    const environment = box(4, 4, 4);
    element[$scene].setEnvironmentModel(environment);
    const nearFar = camera().far;

    const forward = new Vector3();
    camera().getWorldDirection(forward);
    element.environmentModelPosition =
        `${forward.x * 60}m ${forward.y * 60}m ${forward.z * 60}m`;
    await element.updateComplete;

    expect(camera().far).to.be.greaterThan(nearFar + 20);
    expectFarCovers(camera(), environment, legacyCameraFar(element));
    expect(element.getCameraOrbit().radius).to.be.closeTo(2, 0.05);
  });

  test('scaling the environment extends far', async () => {
    const environment = box(4, 4, 4);
    const forward = new Vector3();
    camera().getWorldDirection(forward);
    element.environmentModelPosition =
        `${forward.x * 30}m ${forward.y * 30}m ${forward.z * 30}m`;
    await element.updateComplete;
    element[$scene].setEnvironmentModel(environment);
    const unscaled = camera().far;

    element.environmentModelScale = '8 8 8';
    await element.updateComplete;

    expect(camera().far).to.be.greaterThan(unscaled + 5);
    expectFarCovers(camera(), environment, legacyCameraFar(element));
    expect(element[$scene].boundingSphere.radius)
        .to.be.lessThan(legacyCameraFar(element));
  });

  test('rotating a long environment updates far', async () => {
    const environment = box(100, 1, 1);
    element[$scene].setEnvironmentModel(environment);
    const flat = camera().far;
    const legacyFar = legacyCameraFar(element);

    element.environmentModelOrientation = '0deg 0deg 90deg';
    await element.updateComplete;
    const turned = camera().far;

    expect(Math.abs(turned - flat)).to.be.greaterThan(20);
    expect(Math.max(turned, flat)).to.be.greaterThan(legacyFar + 20);
    expectFarCovers(camera(), environment, legacyFar);
    expect(camera().near).to.equal(0.1);
  });

  test(
      'a lateral environment uses view depth instead of a constant or slant range',
      () => {
        const environment = box(4, 4, 4);
        environment.position.set(200, 0, -10);
        element[$scene].setEnvironmentModel(environment);

        const depth = environmentViewDepth(environment, camera());
        expect(depth).to.be.lessThan(40);
        expectFarCovers(camera(), environment, legacyCameraFar(element));
        expect(camera().far).to.be.lessThan(80);
      });

  test('camera-orbit changes recalculate far', async () => {
    const environment = box(6, 6, 6);
    const forward = new Vector3();
    camera().getWorldDirection(forward);
    environment.position.copy(forward).multiplyScalar(70);
    element[$scene].setEnvironmentModel(environment);
    const facing = camera().far;
    expect(facing).to.be.greaterThan(legacyCameraFar(element) + 20);

    element.cameraOrbit = '180deg 90deg 2m';
    await element.updateComplete;

    expect(element.getCameraOrbit().radius).to.be.closeTo(2, 0.05);
    expect(controls().thirdPartyControls.maxDistance).to.be.closeTo(2, 1e-3);
    expect(camera().far).to.not.be.closeTo(facing, 10);
    expectFarCovers(camera(), environment, legacyCameraFar(element));
    expect(camera().near).to.equal(0.1);
  });

  test('camera-target changes recalculate far', async () => {
    const environment = box(6, 6, 6);
    const forward = new Vector3();
    camera().getWorldDirection(forward);
    environment.position.copy(forward).multiplyScalar(70);
    element[$scene].setEnvironmentModel(environment);
    const before = camera().far;
    const maxDistance = controls().thirdPartyControls.maxDistance;
    const framedRadius = element[$scene].boundingSphere.radius;

    const target = forward.clone().multiplyScalar(50);
    element.cameraTarget = `${target.x}m ${target.y}m ${target.z}m`;
    await element.updateComplete;

    expect(camera().far).to.not.be.closeTo(before, 5);
    expectFarCovers(camera(), environment, legacyCameraFar(element));
    expect(controls().thirdPartyControls.maxDistance).to.equal(maxDistance);
    expect(element[$scene].boundingSphere.radius).to.equal(framedRadius);
    expect(camera().near).to.equal(0.1);
    expect(camera().fov).to.be.greaterThan(0);
  });

  test(
      'a settled orbit change is picked up on tick without walking environment bounds',
      () => {
        const environment = box(6, 6, 6);
        const forward = new Vector3();
        camera().getWorldDirection(forward);
        environment.position.copy(forward).multiplyScalar(70);
        element[$scene].setEnvironmentModel(environment);
        const facing = camera().far;

        const original = Box3.prototype.setFromObject;
        let boundWalks = 0;
        Box3.prototype.setFromObject = function(
            this: Box3, ...args: unknown[]) {
          boundWalks++;
          return original.apply(this, args as [Object3D, boolean?]);
        };

        try {
          controls().setOrbit(Math.PI, Math.PI / 2, 2);
          expect(camera().far).to.be.closeTo(facing, 1e-3);

          (element as any)[$isElementInViewport] = true;
          element[$tick](performance.now(), 16);
          element[$tick](performance.now(), 16);

          expect(boundWalks).to.equal(0);
          expect(camera().far).to.not.be.closeTo(facing, 10);
          expectFarCovers(camera(), environment, legacyCameraFar(element));
        } finally {
          Box3.prototype.setFromObject = original;
        }
      });

  test('replacing the environment model recalculates far', () => {
    const scene = element[$scene];
    const small = box(1, 1, 1);
    scene.setEnvironmentModel(small);
    const smallFar = camera().far;

    const large = box(10, 10, 10);
    const forward = new Vector3();
    camera().getWorldDirection(forward);
    large.position.copy(forward).multiplyScalar(90);
    scene.setEnvironmentModel(large);

    expect(camera().far).to.be.greaterThan(smallFar + 20);
    expectFarCovers(camera(), large, legacyCameraFar(element));
    expect(scene.environmentRoot.children).to.deep.equal([large]);
  });

  test('removing the environment model restores legacy far', () => {
    const scene = element[$scene];
    const legacyFar = legacyCameraFar(element);
    const framedRadius = scene.boundingSphere.radius;
    const environment = box(8, 8, 8);
    const forward = new Vector3();
    camera().getWorldDirection(forward);
    environment.position.copy(forward).multiplyScalar(70);
    scene.setEnvironmentModel(environment);
    expect(camera().far).to.be.greaterThan(legacyFar + 20);

    scene.clearEnvironmentModel();

    expect(scene.environmentRoot.children).to.have.lengthOf(0);
    expect(camera().far).to.be.closeTo(legacyFar, 1e-3);
    expect(camera().near).to.equal(0.1);
    expect(scene.boundingSphere.radius).to.equal(framedRadius);
  });

  test(
      'clip-to-env="false" keeps the orbit-derived far, and true or omitting it fits the environment',
      async () => {
        const environment = box(8, 8, 8);
        const forward = new Vector3();
        camera().getWorldDirection(forward);
        environment.position.copy(forward).multiplyScalar(70);
        element[$scene].setEnvironmentModel(environment);
        const legacyFar = legacyCameraFar(element);
        expect(camera().far).to.be.greaterThan(legacyFar + 20);
        const fov = camera().fov;
        const maxDistance = controls().thirdPartyControls.maxDistance;

        element.setAttribute('clip-to-env', 'false');
        await element.updateComplete;

        expect((element as any).clipToEnv).to.equal(false);
        expect(camera().far).to.be.closeTo(legacyFar, 1e-3);
        expect(camera().near).to.equal(0.1);
        expect(camera().fov).to.equal(fov);
        expect(controls().thirdPartyControls.maxDistance).to.equal(maxDistance);
        expect(element[$scene].boundingSphere.radius).to.be.lessThan(10);

        element.setAttribute('clip-to-env', 'FALSE');
        await element.updateComplete;
        expect((element as any).clipToEnv).to.equal(false);
        expect(camera().far).to.be.closeTo(legacyFar, 1e-3);

        element.setAttribute('clip-to-env', 'true');
        await element.updateComplete;
        expect((element as any).clipToEnv).to.equal(true);
        expectFarCovers(camera(), environment, legacyFar);

        element.setAttribute('clip-to-env', '');
        await element.updateComplete;
        expect((element as any).clipToEnv).to.equal(true);
        expectFarCovers(camera(), environment, legacyFar);

        element.removeAttribute('clip-to-env');
        await element.updateComplete;
        expect((element as any).clipToEnv).to.equal(true);
        expect(element.hasAttribute('clip-to-env')).to.equal(false);
        expectFarCovers(camera(), environment, legacyFar);
      });

  test('setting clipToEnv from script updates the far plane', async () => {
    const environment = box(8, 8, 8);
    const forward = new Vector3();
    camera().getWorldDirection(forward);
    environment.position.copy(forward).multiplyScalar(70);
    element[$scene].setEnvironmentModel(environment);
    const legacyFar = legacyCameraFar(element);
    expect((element as any).clipToEnv).to.equal(true);
    expect(camera().far).to.be.greaterThan(legacyFar + 20);

    (element as any).clipToEnv = false;
    await element.updateComplete;

    expect((element as any).clipToEnv).to.equal(false);
    expect(camera().far).to.be.closeTo(legacyFar, 1e-3);
    expect(camera().near).to.equal(0.1);
    expect(element.getCameraOrbit().radius).to.be.closeTo(2, 0.05);
    expect(controls().thirdPartyControls.maxDistance).to.be.closeTo(2, 1e-3);

    (element as any).clipToEnv = true;
    await element.updateComplete;

    expect((element as any).clipToEnv).to.equal(true);
    expectFarCovers(camera(), environment, legacyFar);
  });

  test(
      'loading, shifting, and removing environment-model updates far and leaves framing alone',
      async () => {
        const scene = element[$scene];
        const legacyFar = legacyCameraFar(element);
        const framedRadius = scene.boundingSphere.radius;
        const dimensions = element.getDimensions().toString();
        const forward = new Vector3();
        camera().getWorldDirection(forward);
        element.environmentModelPosition =
            `${forward.x * 40}m ${forward.y * 40}m ${forward.z * 40}m`;
        element.environmentModel = ENVIRONMENT_MODEL;
        await waitForEvent(element, 'environment-model-load');
        await element.updateComplete;

        const environment = scene.environmentRoot;
        expect(camera().far).to.be.greaterThan(legacyFar);
        expectFarCovers(camera(), environment, legacyFar);
        expect(scene.boundingSphere.radius).to.equal(framedRadius);
        expect(element.getDimensions().toString()).to.equal(dimensions);
        environment.traverse((node) => {
          if (node !== environment) {
            expect(node.userData.noHit).to.equal(true);
            expect(node.userData.selectable).to.equal(false);
          }
        });

        element.environmentModel = null;
        await element.updateComplete;

        expect(scene.environmentRoot.children).to.have.lengthOf(0);
        expect(camera().far).to.be.closeTo(legacyFar, 1e-3);
        expect(camera().near).to.equal(0.1);
        expect(scene.boundingSphere.radius).to.equal(framedRadius);
      });
});
