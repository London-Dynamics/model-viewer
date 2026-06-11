/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {BoxGeometry, Euler, Mesh, MeshBasicMaterial, Quaternion, Vector3} from 'three';

import {$scene, $tick} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath, rafPasses} from '../helpers.js';

const MAIN_MODEL = assetPath('models/Astronaut.glb');
const ENVIRONMENT_MODEL = assetPath('models/reflective-sphere.gltf');

suite('LDEnvironment', () => {
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
    document.body.insertBefore(element, document.body.firstChild);
  });

  teardown(() => {
    element.remove();
  });

  test('keeps environment objects outside the main target', async () => {
    const scene = element[$scene];
    const main = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    const environment =
        new Mesh(new BoxGeometry(100, 100, 100), new MeshBasicMaterial());

    await scene.setObject(main);
    const dimensions = element.getDimensions().toString();
    scene.setEnvironmentModel(environment);

    expect(scene.environmentRoot.parent).to.equal(scene);
    expect(environment.parent).to.equal(scene.environmentRoot);
    expect(element.getDimensions().toString()).to.equal(dimensions);
    expect(scene.target.children).not.to.include(environment);
  });

  test('loads the environment model after the main load event', async () => {
    const events: string[] = [];
    const load = waitForEvent(element, 'load');
    const environmentLoad = waitForEvent(element, 'environment-model-load');

    element.environmentModel = ENVIRONMENT_MODEL;
    element.addEventListener('load', () => events.push('load'));
    element.addEventListener(
        'environment-model-load',
        () => events.push('environment-model-load'));
    element.src = MAIN_MODEL;

    await load;
    await environmentLoad;

    expect(events[0]).to.equal('load');
    expect(events).to.include('environment-model-load');
  });

  test('does not fail the main model when the environment model fails',
       async () => {
         const load = waitForEvent(element, 'load');
         const environmentError =
             waitForEvent(element, 'environment-model-error');

         element.environmentModel = assetPath('models/does-not-exist.glb');
         element.src = MAIN_MODEL;

         await load;
         await environmentError;

         expect(element.loaded).to.equal(true);
         expect(element[$scene].currentGLTF).to.be.ok;
       });

  test('marks environment model nodes non-interactive', async () => {
    element.environmentModel = ENVIRONMENT_MODEL;
    element.src = MAIN_MODEL;
    await waitForEvent(element, 'environment-model-load');

    const environmentRoot = element[$scene].environmentRoot;
    environmentRoot.traverse((node) => {
      if (node !== environmentRoot) {
        expect(node.userData.noHit).to.equal(true);
        expect(node.userData.selectable).to.equal(false);
      }
    });
  });

  test('removing environment-model leaves the main model loaded', async () => {
    element.environmentModel = ENVIRONMENT_MODEL;
    element.src = MAIN_MODEL;
    await waitForEvent(element, 'environment-model-load');

    const mainModel = element[$scene].model;
    element.environmentModel = null;
    await rafPasses();

    expect(element[$scene].environmentRoot.children).to.have.lengthOf(0);
    expect(element[$scene].model).to.equal(mainModel);
    expect(element.loaded).to.equal(true);
  });

  test('can hide the environment root for AR and restore it afterwards',
       async () => {
         const scene = element[$scene];
         scene.setEnvironmentModel(new Mesh(
             new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));

         scene.setEnvironmentModelVisible(false);
         expect(scene.environmentRoot.visible).to.equal(false);

         scene.setEnvironmentModelVisible(true);
         expect(scene.environmentRoot.visible).to.equal(true);
       });

  test('applies environment model transforms to the environment root',
       async () => {
         const scene = element[$scene];

         element.environmentModelPosition = '1m 2m 3m';
         element.environmentModelOrientation = '10deg 20deg 30deg';
         element.environmentModelScale = '2 3 4';
         await element.updateComplete;

         const expectedQuaternion = new Quaternion().setFromEuler(new Euler(
             20 * Math.PI / 180,
             30 * Math.PI / 180,
             10 * Math.PI / 180,
             'YXZ'));

         expect(scene.environmentRoot.position)
             .to.eql(new Vector3(1, 2, 3));
         expect(scene.environmentRoot.quaternion.x)
             .to.be.closeTo(expectedQuaternion.x, 0.0001);
         expect(scene.environmentRoot.quaternion.y)
             .to.be.closeTo(expectedQuaternion.y, 0.0001);
         expect(scene.environmentRoot.quaternion.z)
             .to.be.closeTo(expectedQuaternion.z, 0.0001);
         expect(scene.environmentRoot.quaternion.w)
             .to.be.closeTo(expectedQuaternion.w, 0.0001);
         expect(scene.environmentRoot.scale)
             .to.eql(new Vector3(2, 3, 4));
       });

  test('applies skybox rotation to the visible skybox', async () => {
    element.skyboxRotation = '10deg 20deg 30deg';
    await element.updateComplete;

    const rotation = element[$scene].getSkyboxRotation();

    expect(rotation.x).to.be.closeTo(20 * Math.PI / 180, 0.0001);
    expect(rotation.y).to.be.closeTo(30 * Math.PI / 180, 0.0001);
    expect(rotation.z).to.be.closeTo(10 * Math.PI / 180, 0.0001);
  });

  test('applies skybox rotation to the render environment', async () => {
    element.skyboxRotation = '10deg 20deg 30deg';
    await element.updateComplete;

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
    await element.updateComplete;

    element[$tick](performance.now(), 50);

    expect(element[$scene].getSkyboxRotation().y).to.be.greaterThan(0);
  });
});
