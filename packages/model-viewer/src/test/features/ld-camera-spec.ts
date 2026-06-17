import {expect} from 'chai';
import {Box3, Vector3} from 'three';

import {$controls} from '../../features/controls.js';
import {$scene, $userInputElement} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
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

/** Mirror what the host persists: Blender fields + controlsSnapshot. */
function toHostCameraPayload(object: Record<string, unknown>) {
  const host = {...object};
  delete host.controlsState;
  delete host.controlsPose;
  delete host.focalOffset;
  delete host.controlsZoom;
  return host;
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

  test(
      'getCameraJSON target matches CameraControls look-at after pan',
      async () => {
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
        expect(meta!.object.controlsState).to.be.undefined;
        expect((meta!.metadata as any).controlsState).to.be.undefined;

        for (let i = 0; i < 3; ++i) {
          expect(meta!.object.target[i])
              .to.be.closeTo(expectedModelTarget.toArray()[i], 0.001);
          expect(meta!.object.worldTarget[i])
              .to.be.closeTo(worldTarget.toArray()[i], 0.001);
        }

        // Scene pivot was not updated by CameraControls pan.
        expect(scene.getTarget().x)
            .to.be.closeTo(sceneTargetBeforePan.x, 0.001);
        expect(scene.getTarget().y)
            .to.be.closeTo(sceneTargetBeforePan.y, 0.001);
        expect(scene.getTarget().z)
            .to.be.closeTo(sceneTargetBeforePan.z, 0.001);
      });

  test('setCameraFromJSON restores host payload after reset', async () => {
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

    const saved = toHostCameraPayload(source!.object);
    expect(saved.controlsSnapshot).to.not.be.undefined;
    expect(saved.controlsState).to.be.undefined;

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

  test('setCameraFromJSON accepts legacy controlsState string', async () => {
    const scene = element[$scene];
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;

    const position = scene.camera.position.clone();
    await cc.setLookAt(
        position.x,
        position.y,
        position.z,
        position.x + 0.5,
        position.y,
        position.z - 0.25,
        false);
    cc.update(1);

    const source = element.getCameraJSON();
    expect(source).to.not.be.null;

    const legacy = {...source!.object};
    legacy.controlsState = JSON.stringify(legacy.controlsSnapshot);
    delete legacy.controlsSnapshot;

    await cc.setLookAt(0, 0, 5, 0, 0, 0, false);
    cc.update(1);

    await element.setCameraFromJSON(legacy);
    await timePasses();

    const restored = element.getCameraJSON();
    expect(restored).to.not.be.null;
    expect(restored!.object.position[0])
        .to.be.closeTo(source!.object.position[0], 0.001);
  });

  test('setCameraFromJSON restores view from controlsSnapshot', async () => {
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

  test(
      'setCameraControlsMode switches between orbit and fps controls',
      async () => {
        expect((element as any).cameraControlMode).to.equal('orbit');

        (element as any).setCameraControlsMode('fps', {
          enableKeyboardMove: false
        });
        await element.updateComplete;

        expect((element as any).cameraControlMode).to.equal('fps');
        expect((element as any).fpsKeyboardMove).to.equal(false);
        expect((element as any).fpsFlyMode).to.equal(false);

        (element as any).setCameraControlsMode('fps', {
          enableKeyboardMove: true,
          enableFlyMode: true
        });
        await element.updateComplete;

        expect((element as any).fpsKeyboardMove).to.equal(true);
        expect((element as any).fpsFlyMode).to.equal(true);

        (element as any).setCameraControlsMode('orbit');
        await element.updateComplete;

        expect((element as any).cameraControlMode).to.equal('orbit');
      });

  test('FPS pointer drag right looks right', async () => {
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;
    await cc.setLookAt(0, 0, 0, 0, 0, -1, false);
    cc.update(0);

    (element as any).setCameraControlsMode('fps');
    await element.updateComplete;

    const input = (element as any)[$userInputElement];
    input.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 1,
      button: 0,
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    }));
    input.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1,
      button: 0,
      clientX: 125,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    }));

    const target = new Vector3();
    cc.getTarget(target);
    expect(target.x).to.be.greaterThan(0);
    expect(target.x).to.be.closeTo(Math.sin(0.05), 0.001);
  });

  test('FPS exposes look and movement sensitivity attributes', async () => {
    expect((element as any).fpsLookSensitivity).to.equal(0.5);
    expect((element as any).fpsMoveSensitivity).to.equal(0.3);

    (element as any).fpsLookSensitivity = 0.25;
    (element as any).fpsMoveSensitivity = 0.2;
    await element.updateComplete;

    const controls = (element as any)[$controls];
    expect(controls.fpsLookSensitivity).to.equal(0.25);
    expect(controls.fpsMoveSensitivity).to.equal(0.2);
  });

  test('FPS keyboard movement defaults to thirty percent speed', async () => {
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;
    await cc.setLookAt(0, 0, 0, 0, 0, -1, false);
    cc.update(0);

    (element as any).setCameraControlsMode('fps', {enableKeyboardMove: true});
    await element.updateComplete;

    const input = (element as any)[$userInputElement];
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'w',
      bubbles: true,
      cancelable: true,
    }));
    controls.update(0, 1000);

    expect(cc.camera.position.z).to.be.closeTo(-0.45, 0.001);
  });

  test('setCameraView accepts attribute-style camera settings', async () => {
    await (element as any).setCameraView({
      controlMode: 'orbit',
      enableFlyMode: true,
      cameraOrbit: '45deg 75deg 4m',
      cameraTarget: '0m 0m 0m',
      fieldOfView: '35deg',
    });
    await timePasses();

    expect((element as any).cameraControlMode).to.equal('orbit');
    expect(element.cameraOrbit).to.equal('45deg 75deg 4m');
    expect(element.cameraTarget).to.equal('0m 0m 0m');
    expect(element.fieldOfView).to.equal('35deg');
    expect((element as any).fpsFlyMode).to.equal(true);
    expect(element.getFieldOfView()).to.be.closeTo(35, 0.1);
  });

  test('animateCameraTo accepts easing strings and avoid margin', async () => {
    await (element as any)
        .animateCameraTo(
            {
              controlMode: 'fps',
              cameraOrbit: '0deg 90deg 3m',
              cameraTarget: '0m 0m 0m',
              fieldOfView: '40deg',
            },
            {
              duration: 1,
              easing: 'easeInOutQuad',
              avoidSubject: true,
              avoidMargin: 2,
            });
    await timePasses();

    expect((element as any).cameraControlMode).to.equal('fps');
    expect(element.fieldOfView).to.equal('40deg');
    expect(element.getFieldOfView()).to.be.closeTo(40, 0.1);
  });

  test(
      'animateCameraTo does not apply JSON destination before animating',
      async () => {
        const controls = (element as any)[$controls];
        const cc = controls.thirdPartyControls;
        await cc.setLookAt(1, 2, 3, 0.5, 0.25, -0.5, false);
        cc.update(0);

        const calls: number[][] = [];
        const originalSetLookAt = cc.setLookAt.bind(cc);
        cc.setLookAt = (...args: number[]) => {
          calls.push(args.slice(0, 6));
          return originalSetLookAt(...args);
        };

        await (element as any)
            .animateCameraTo(
                {
                  type: 'PerspectiveCamera',
                  position: [4, 5, 6],
                  target: [7, 8, 9],
                  fov: 40,
                  near: 0.1,
                  far: 2000,
                  zoom: 1,
                  up: [0, 1, 0],
                  controlMode: 'orbit',
                },
                {duration: 1, easing: 'linear'});

        cc.setLookAt = originalSetLookAt;

        expect(calls.length).to.be.greaterThan(0);
        expect(calls[0]).to.deep.equal([1, 2, 3, 0.5, 0.25, -0.5]);
      });

  test(
      'animateCameraTo does not avoid-route targets inside the subject bounds',
      async () => {
        const scene = element[$scene] as any;
        scene.boundingBox =
            new Box3(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5));

        const controls = (element as any)[$controls];
        const cc = controls.thirdPartyControls;
        await cc.setLookAt(2, 1, 2, 0.1, 0.1, 0.1, false);
        cc.update(0);

        const calls: number[][] = [];
        const originalSetLookAt = cc.setLookAt.bind(cc);
        cc.setLookAt = (...args: number[]) => {
          calls.push(args.slice(0, 6));
          return originalSetLookAt(...args);
        };

        await (element as any)
            .animateCameraTo(
                {
                  type: 'PerspectiveCamera',
                  position: [-2, 1, -2],
                  worldTarget: [-0.1, -0.1, -0.1],
                  target: [-0.1, -0.1, -0.1],
                  fov: 35,
                  near: 0.1,
                  far: 2000,
                  zoom: 1,
                  up: [0, 1, 0],
                  controlMode: 'orbit',
                },
                {duration: 32, easing: 'linear', avoidSubject: true});

        cc.setLookAt = originalSetLookAt;

        expect(calls.length).to.be.greaterThan(2);
        for (const call of calls) {
          expect(call[3]).to.be.within(-0.101, 0.101);
          expect(call[4]).to.be.within(-0.101, 0.101);
          expect(call[5]).to.be.within(-0.101, 0.101);
        }
      });
});
