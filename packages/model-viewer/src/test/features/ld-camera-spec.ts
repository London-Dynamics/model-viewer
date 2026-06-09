import {expect} from 'chai';
import {Vector3} from 'three';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {$controls} from '../../features/controls.js';
import {timePasses, waitForEvent} from '../../utilities.js';
import {assetPath} from '../helpers.js';

function worldTargetToModel(scene: any, worldTarget: Vector3): Vector3 {
  const modelTarget = worldTarget.clone();
  if (scene?.pivot?.worldToLocal) {
    scene.updateMatrixWorld(true);
    scene.pivot.worldToLocal(modelTarget);
  }
  return modelTarget;
}

suite('LD Camera JSON', () => {
  let element: ModelViewerElement;

  setup(async () => {
    element = new ModelViewerElement();
    element.cameraControls = true;
    element.interactionPrompt = 'none';
    element.src = assetPath('models/cube.gltf');
    document.body.insertBefore(element, document.body.firstChild);
    await waitForEvent(element, 'poster-dismissed');
    await timePasses();
  });

  teardown(() => {
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  test('getCameraJSON target matches CameraControls look-at after pan', async () => {
    const scene = element[$scene];
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;
    const sceneTargetBeforePan = scene.getTarget().clone();

    const position = scene.camera.position.clone();
    await cc.setLookAt(
        position.x,
        position.y,
        position.z,
        position.x + 2,
        position.y + 0.5,
        position.z - 1,
        false);
    cc.update(1);

    const worldTarget = new Vector3();
    cc.getTarget(worldTarget);
    const expectedModelTarget = worldTargetToModel(scene, worldTarget);

    const meta = element.getCameraJSON();
    expect(meta).to.not.be.null;
    expect(meta!.object.target).to.not.be.undefined;
    expect(meta!.object.worldTarget).to.not.be.undefined;
    expect(meta!.object.controlsSnapshot).to.not.be.undefined;
    expect(meta!.object.controlsPose).to.not.be.undefined;

    for (let i = 0; i < 3; ++i) {
      expect(meta!.object.target[i])
          .to.be.closeTo(expectedModelTarget.toArray()[i], 0.001);
      expect(meta!.object.worldTarget[i])
          .to.be.closeTo(worldTarget.toArray()[i], 0.001);
    }

    // Scene pivot was not updated by CameraControls pan.
    expect(scene.getTarget().x).to.be.closeTo(sceneTargetBeforePan.x, 0.001);
    expect(scene.getTarget().y).to.be.closeTo(sceneTargetBeforePan.y, 0.001);
    expect(scene.getTarget().z).to.be.closeTo(sceneTargetBeforePan.z, 0.001);
  });

  test('setCameraFromJSON restores target without controlsState after reset', async () => {
    const scene = element[$scene];
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;

    const position = scene.camera.position.clone();
    await cc.setLookAt(
        position.x,
        position.y,
        position.z,
        position.x + 1.5,
        position.y + 0.25,
        position.z - 0.75,
        false);
    cc.update(1);

    const source = element.getCameraJSON();
    expect(source).to.not.be.null;

    const saved = {...source!.object};
    delete saved.controlsState;
    expect(saved.controlsSnapshot).to.not.be.undefined;

    await element.resetCamera();
    await timePasses();

    await element.setCameraFromJSON(saved);
    await timePasses();

    const restored = element.getCameraJSON();
    expect(restored).to.not.be.null;

    for (let i = 0; i < 3; ++i) {
      expect(restored!.object.position[i])
          .to.be.closeTo(source!.object.position[i], 0.001);
      expect(restored!.object.target[i])
          .to.be.closeTo(source!.object.target[i], 0.001);
    }

    expect(restored!.object.fov).to.be.closeTo(source!.object.fov, 0.01);
    expect(restored!.object.aspect).to.be.closeTo(source!.object.aspect, 0.001);
    expect(restored!.object.near).to.be.closeTo(source!.object.near, 0.0001);
  });

  test('setCameraFromJSON restores view from controlsState', async () => {
    const scene = element[$scene];
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;

    const position = scene.camera.position.clone();
    await cc.setLookAt(
        position.x,
        position.y,
        position.z,
        position.x + 1,
        position.y + 0.2,
        position.z - 0.5,
        false);
    cc.update(1);

    const source = element.getCameraJSON();
    expect(source).to.not.be.null;

    await cc.setLookAt(0, 0, 5, 0, 0, 0, false);
    cc.update(1);

    await element.setCameraFromJSON(source!.object);
    await timePasses();

    const restored = element.getCameraJSON();
    expect(restored).to.not.be.null;

    for (let i = 0; i < 3; ++i) {
      expect(restored!.object.position[i])
          .to.be.closeTo(source!.object.position[i], 0.001);
      expect(restored!.object.target[i])
          .to.be.closeTo(source!.object.target[i], 0.001);
    }
  });
});
