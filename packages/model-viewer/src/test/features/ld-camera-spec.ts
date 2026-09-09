import { expect } from 'chai';
import CameraControls from 'camera-controls';
import { Box3, Vector3 } from 'three';

import { $controls } from '../../features/controls.js';
import {
  channelProgress,
  pickStaggerWindows,
} from '../../features/ld-camera.js';
import { $scene, $userInputElement } from '../../model-viewer-base.js';
import { ModelViewerElement } from '../../model-viewer.js';
import { timePasses, waitForEvent } from '../../utilities.js';
import { assetPath } from '../helpers.js';

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
  const host = { ...object };
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
      false
    );
    cc.update(1);

    const worldTarget = new Vector3();
    cc.getTarget(worldTarget);
    const expectedModelTarget = worldTargetToModel(scene, worldTarget);

    expect((element as any).getCameraPosition().x).to.be.closeTo(position.x, 0.01);
    expect((element as any).getCameraPosition().y).to.be.closeTo(position.y, 0.01);
    expect((element as any).getCameraPosition().z).to.be.closeTo(position.z, 0.01);

    const meta = element.getCameraJSON();
    expect(meta).to.not.be.null;
    expect(meta!.object.target).to.not.be.undefined;
    expect(meta!.object.worldTarget).to.not.be.undefined;
    expect(meta!.object.controlsSnapshot).to.not.be.undefined;
    expect(meta!.object.controlsState).to.be.undefined;
    expect((meta!.metadata as any).controlsState).to.be.undefined;

    for (let i = 0; i < 3; ++i) {
      expect(meta!.object.target[i]).to.be.closeTo(
        expectedModelTarget.toArray()[i],
        0.001
      );
      expect(meta!.object.worldTarget[i]).to.be.closeTo(
        worldTarget.toArray()[i],
        0.001
      );
    }

    // Scene pivot was not updated by CameraControls pan.
    expect(scene.getTarget().x).to.be.closeTo(sceneTargetBeforePan.x, 0.001);
    expect(scene.getTarget().y).to.be.closeTo(sceneTargetBeforePan.y, 0.001);
    expect(scene.getTarget().z).to.be.closeTo(sceneTargetBeforePan.z, 0.001);

    const apiTarget = element.getCameraTarget();
    expect(apiTarget.x).to.be.closeTo(expectedModelTarget.x, 0.001);
    expect(apiTarget.y).to.be.closeTo(expectedModelTarget.y, 0.001);
    expect(apiTarget.z).to.be.closeTo(expectedModelTarget.z, 0.001);
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
      false
    );
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
      expect(restored!.object.position[i]).to.be.closeTo(
        source!.object.position[i],
        0.001
      );
      expect(restored!.object.target[i]).to.be.closeTo(
        source!.object.target[i],
        0.001
      );
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
      false
    );
    cc.update(1);

    const source = element.getCameraJSON();
    expect(source).to.not.be.null;

    const legacy = { ...source!.object };
    legacy.controlsState = JSON.stringify(legacy.controlsSnapshot);
    delete legacy.controlsSnapshot;

    await cc.setLookAt(0, 0, 5, 0, 0, 0, false);
    cc.update(1);

    await element.setCameraFromJSON(legacy);
    await timePasses();

    const restored = element.getCameraJSON();
    expect(restored).to.not.be.null;
    expect(restored!.object.position[0]).to.be.closeTo(
      source!.object.position[0],
      0.001
    );
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
      false
    );
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
      expect(restored!.object.position[i]).to.be.closeTo(
        source!.object.position[i],
        0.001
      );
      expect(restored!.object.target[i]).to.be.closeTo(
        source!.object.target[i],
        0.001
      );
    }
  });

  test('setCameraControlsMode switches between orbit and fps controls', async () => {
    expect((element as any).cameraControlMode).to.equal('orbit');

    (element as any).setCameraControlsMode('fps', {
      enableKeyboardMove: false,
    });
    await element.updateComplete;

    expect((element as any).cameraControlMode).to.equal('fps');
    expect((element as any).fpsKeyboardMove).to.equal(false);
    expect((element as any).fpsFlyMode).to.equal(false);

    (element as any).setCameraControlsMode('fps', {
      enableKeyboardMove: true,
      enableFlyMode: true,
    });
    await element.updateComplete;

    expect((element as any).fpsKeyboardMove).to.equal(true);
    expect((element as any).fpsFlyMode).to.equal(true);

    (element as any).setCameraControlsMode('orbit');
    await element.updateComplete;

    expect((element as any).cameraControlMode).to.equal('orbit');
  });

  test('FPS to orbit restores wheel zoom when disableZoom is false', async () => {
    const cc = (element as any)[$controls].thirdPartyControls;

    (element as any).setCameraControlsMode('fps');
    await element.updateComplete;
    expect(cc.mouseButtons.wheel).to.equal(CameraControls.ACTION.NONE);

    (element as any).setCameraControlsMode('orbit');
    await element.updateComplete;
    expect(cc.mouseButtons.wheel).to.not.equal(CameraControls.ACTION.NONE);
  });

  test('clearing disableZoom after FPS restores orbit wheel zoom', async () => {
    const cc = (element as any)[$controls].thirdPartyControls;

    element.disableZoom = true;
    (element as any).setCameraControlsMode('fps');
    await element.updateComplete;
    expect(cc.mouseButtons.wheel).to.equal(CameraControls.ACTION.NONE);

    element.disableZoom = false;
    (element as any).setCameraControlsMode('orbit');
    await element.updateComplete;
    expect(element.disableZoom).to.equal(false);
    expect(cc.mouseButtons.wheel).to.not.equal(CameraControls.ACTION.NONE);
  });

  test('FPS mode lifts orbit min-distance so the camera can sit inside the model', async () => {
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;
    cc.minDistance = 5;

    (element as any).setCameraControlsMode('fps');
    await element.updateComplete;

    expect(cc.minDistance).to.equal(0);
    expect(cc.maxDistance).to.equal(Number.POSITIVE_INFINITY);

    // Orbit limits are stored but not reapplied while FPS is active.
    controls.applyOptions({minimumRadius: 5});
    expect(cc.minDistance).to.equal(0);
  });

  test('FPS pointer drag right looks right', async () => {
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;
    await cc.setLookAt(0, 0, 0, 0, 0, -1, false);
    cc.update(0);

    (element as any).setCameraControlsMode('fps');
    await element.updateComplete;

    const input = (element as any)[$userInputElement];
    input.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      })
    );
    input.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        button: 0,
        clientX: 125,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      })
    );

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

    (element as any).setCameraControlsMode('fps', { enableKeyboardMove: true });
    await element.updateComplete;

    const input = (element as any)[$userInputElement];
    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'w',
        bubbles: true,
        cancelable: true,
      })
    );
    controls.update(0, 1000);

    expect(cc.camera.position.z).to.be.closeTo(-0.45, 0.001);
  });

  test('FPS keyboard Q and E move straight down and up', async () => {
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;

    (element as any).setCameraControlsMode('fps', { enableKeyboardMove: true });
    await element.updateComplete;

    const input = (element as any)[$userInputElement];
    await cc.setLookAt(0, 0, 0, 0, 0.5, -1, false);
    cc.update(0);

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'e',
        bubbles: true,
        cancelable: true,
      })
    );
    controls.update(0, 1000);
    input.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'e', bubbles: true })
    );

    expect(cc.camera.position.x).to.be.closeTo(0, 0.001);
    expect(cc.camera.position.y).to.be.closeTo(0.45, 0.001);
    expect(cc.camera.position.z).to.be.closeTo(0, 0.001);

    await cc.setLookAt(0, 0, 0, 0, 0.5, -1, false);
    cc.update(0);

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'q',
        bubbles: true,
        cancelable: true,
      })
    );
    controls.update(0, 1000);

    expect(cc.camera.position.x).to.be.closeTo(0, 0.001);
    expect(cc.camera.position.y).to.be.closeTo(-0.45, 0.001);
    expect(cc.camera.position.z).to.be.closeTo(0, 0.001);
  });

  test('setCameraPose moves the camera in fps mode', async () => {
    await (element as any).setCameraControlsMode('fps', {
      enableKeyboardMove: true,
    });
    (element as any).setCameraPose({
      position: [1.25, 0.8, -2.1],
      worldTarget: [0, 0.4, 0],
      fov: 40,
    });
    await timePasses();

    const position = (element as any).getCameraPosition();
    expect(position.x).to.be.closeTo(1.25, 0.05);
    expect(position.y).to.be.closeTo(0.8, 0.05);
    expect(position.z).to.be.closeTo(-2.1, 0.05);
    expect(element.getFieldOfView()).to.be.closeTo(40, 0.5);
  });

  test('setCameraView moves an fps camera to a saved context pose', async () => {
    const scene = element[$scene];
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;

    // Capture a pose in orbit mode, the way the Context editor does.
    await (element as any).setCameraView({
      controlMode: 'orbit',
      cameraOrbit: '30deg 70deg 3.5m',
      cameraTarget: '0m 0.2m 0m',
      fieldOfView: '38deg',
    });
    await timePasses();
    const saved = (element as any).getCameraView();
    const expected = scene.camera.position.clone();

    // Walk the camera away in FPS, as the viewer's user would.
    await (element as any).setCameraControlsMode('fps', {
      enableKeyboardMove: true,
    });
    await cc.setLookAt(6, 2, 6, 6.5, 2, 5.5, false);
    cc.update(1);
    await timePasses();

    // Switching Context must land the saved pose, not orbit the stale look-at.
    await (element as any).setCameraView(saved);
    await timePasses();

    expect((element as any).cameraControlMode).to.equal('fps');
    expect(scene.camera.position.x).to.be.closeTo(expected.x, 0.05);
    expect(scene.camera.position.y).to.be.closeTo(expected.y, 0.05);
    expect(scene.camera.position.z).to.be.closeTo(expected.z, 0.05);
    expect(element.getFieldOfView()).to.be.closeTo(38, 0.5);
  });

  test('animated fps restore lands the pose and keeps look angles in sync', async () => {
    const scene = element[$scene];
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;

    await (element as any).setCameraView({
      controlMode: 'orbit',
      cameraOrbit: '35deg 70deg 3.5m',
      cameraTarget: '0m 0.2m 0m',
      fieldOfView: '38deg',
    });
    await timePasses();
    const saved = (element as any).getCameraView();
    const expected = scene.camera.position.clone();

    await (element as any).setCameraControlsMode('fps', {
      enableKeyboardMove: true,
    });
    await cc.setLookAt(6, 2, 6, 6.5, 2, 5.5, false);
    cc.update(1);
    await timePasses();

    await (element as any).animateCameraTo(saved, {duration: 40});
    await timePasses();

    expect((element as any).cameraControlMode).to.equal('fps');
    expect(scene.camera.position.x).to.be.closeTo(expected.x, 0.05);
    expect(scene.camera.position.y).to.be.closeTo(expected.y, 0.05);
    expect(scene.camera.position.z).to.be.closeTo(expected.z, 0.05);

    // Stale FPS yaw/pitch would swing the view somewhere unrelated on the
    // first look input rather than nudging it.
    const before = new Vector3();
    cc.getTarget(before);
    const beforeDirection = before
      .clone()
      .sub(scene.camera.position)
      .normalize();

    const input = (element as any)[$userInputElement];
    input.dispatchEvent(
      new PointerEvent('pointerdown', {
        pointerId: 1,
        button: 0,
        clientX: 100,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      })
    );
    input.dispatchEvent(
      new PointerEvent('pointermove', {
        pointerId: 1,
        button: 0,
        clientX: 102,
        clientY: 100,
        bubbles: true,
        cancelable: true,
      })
    );

    const after = new Vector3();
    cc.getTarget(after);
    const afterDirection = after.clone().sub(scene.camera.position).normalize();
    expect(afterDirection.angleTo(beforeDirection)).to.be.lessThan(0.2);
  });

  test('animated restore resolves its destination without a probe jump', async () => {
    const scene = element[$scene];

    await (element as any).setCameraView({
      controlMode: 'orbit',
      cameraOrbit: '10deg 70deg 3m',
      cameraTarget: '0m 0m 0m',
    });
    await timePasses();
    const from = scene.camera.position.clone();

    // animateCameraTo owns CameraControls directly. It must not probe or land
    // through setCameraView, because that replays declarative limits and can
    // produce a visible endpoint snap.
    let setCameraViewCalls = 0;
    const original = (element as any).setCameraView.bind(element);
    (element as any).setCameraView = async (view: any, options?: any) => {
      setCameraViewCalls += 1;
      return original(view, options);
    };

    try {
      await (element as any).animateCameraTo(
        {
          controlMode: 'orbit',
          cameraOrbit: '150deg 60deg 4m',
          cameraTarget: '0m 0.3m 0m',
        },
        {duration: 40}
      );
      await timePasses();
    } finally {
      delete (element as any).setCameraView;
    }

    const total = from.distanceTo(scene.camera.position);
    expect(total).to.be.greaterThan(0.5);
    expect(setCameraViewCalls).to.equal(0);
  });

  test('animated restore keeps the live orbit when the view omits it', async () => {
    const scene = element[$scene];
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;

    await (element as any).setCameraView({
      controlMode: 'orbit',
      cameraOrbit: '0deg 70deg 3m',
      cameraTarget: '0m 0m 0m',
    });
    await timePasses();

    // Move the camera the way a drag does, which leaves the camera-orbit
    // attribute reading the last applied goal rather than the live pose.
    await cc.setLookAt(4, 1, 0, 0, 0, 0, false);
    cc.update(0);
    await timePasses();
    const moved = scene.camera.position.clone();

    // A target-only view must re-aim from where the camera is, not fall back
    // to the stale 3m attribute orbit.
    await (element as any).animateCameraTo(
      {cameraTarget: '0m 0.5m 0m'},
      {duration: 40}
    );
    await timePasses();

    const target = new Vector3();
    cc.getTarget(target);
    expect(target.y).to.be.closeTo(0.5, 0.05);
    expect(scene.camera.position.x).to.be.closeTo(moved.x, 0.1);
    expect(scene.camera.position.y).to.be.closeTo(moved.y, 0.1);
    expect(scene.camera.position.z).to.be.closeTo(moved.z, 0.1);
  });

  test('animated restore still lands the pose when avoiding the subject', async () => {
    const scene = element[$scene];
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;

    await (element as any).setCameraView({
      controlMode: 'orbit',
      cameraOrbit: '20deg 70deg 3m',
      cameraTarget: '0m 0m 0m',
    });
    await timePasses();
    const saved = (element as any).getCameraView();
    const expected = scene.camera.position.clone();

    // Start diametrically opposite so a straight line would cut the model.
    await cc.setLookAt(-expected.x, expected.y, -expected.z, 0, 0, 0, false);
    cc.update(1);
    await timePasses();

    await (element as any).animateCameraTo(saved, {
      duration: 40,
      avoidSubject: true,
      avoidMargin: 0.25,
      transitionStyle: 'direct',
    });
    await timePasses();

    expect(scene.camera.position.x).to.be.closeTo(expected.x, 0.05);
    expect(scene.camera.position.y).to.be.closeTo(expected.y, 0.05);
    expect(scene.camera.position.z).to.be.closeTo(expected.z, 0.05);
  });

  test('setCameraPose resolves orbit/target strings and partial views', async () => {
    const scene = element[$scene];

    expect(
      (element as any).setCameraPose({
        cameraOrbit: '0rad 1.2rad 3m',
        cameraTarget: '0m 0m 0m',
      })
    ).to.equal(true);
    await timePasses();
    const full = scene.camera.position.clone();
    expect(full.length()).to.be.closeTo(3, 0.05);

    // Only azimuth given: polar and radius come from the current pose.
    expect(
      (element as any).setCameraPose({cameraOrbit: '1.5708rad auto auto'})
    ).to.equal(true);
    await timePasses();
    expect(scene.camera.position.length()).to.be.closeTo(3, 0.05);
    expect(scene.camera.position.distanceTo(full)).to.be.greaterThan(0.5);

    // Nothing usable to work from.
    expect((element as any).setCameraPose({})).to.equal(false);
  });

  test('setCameraView applies partial fps orbits instead of bailing', async () => {
    const scene = element[$scene];

    await (element as any).setCameraControlsMode('fps', {});
    await (element as any).setCameraView({
      cameraOrbit: '20deg 80deg 4m',
      cameraTarget: '0m 0m 0m',
    });
    await timePasses();
    const before = scene.camera.position.clone();

    // `auto` tokens resolve through model-viewer's intrinsics; the explicit
    // azimuth must still be applied rather than the whole view discarded.
    await (element as any).setCameraView({
      cameraOrbit: '90deg auto auto',
      cameraTarget: '0m 0m 0m',
    });
    await timePasses();

    expect(element.getCameraOrbit().theta).to.be.closeTo(Math.PI / 2, 0.02);
    expect(scene.camera.position.distanceTo(before)).to.be.greaterThan(0.5);
  });

  test('getCameraView round-trips through setCameraView', async () => {
    const scene = element[$scene];

    await (element as any).setCameraView({
      controlMode: 'orbit',
      cameraOrbit: '15deg 65deg 5m',
      cameraTarget: '0m 0.1m 0m',
      fieldOfView: '30deg',
    });
    await timePasses();

    const view = (element as any).getCameraView();
    const before = scene.camera.position.clone();

    await (element as any).setCameraView(view);
    await timePasses();

    expect(scene.camera.position.x).to.be.closeTo(before.x, 0.05);
    expect(scene.camera.position.y).to.be.closeTo(before.y, 0.05);
    expect(scene.camera.position.z).to.be.closeTo(before.z, 0.05);
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

  test('setCameraView with live pose does not move CameraControls look-at', async () => {
    const scene = element[$scene];
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls;
    const position = scene.camera.position.clone();
    await cc.setLookAt(
      position.x,
      position.y,
      position.z,
      position.x + 1.25,
      position.y + 0.4,
      position.z - 0.8,
      false
    );
    cc.update(1);

    const before = new Vector3();
    cc.getTarget(before);

    const orbit = element.getCameraOrbit();
    const target = element.getCameraTarget();
    await (element as any).setCameraView({
      cameraOrbit: orbit.toString(),
      cameraTarget: target.toString(),
      fieldOfView: `${element.getFieldOfView()}deg`,
    });
    await timePasses();

    const after = new Vector3();
    cc.getTarget(after);
    expect(after.x).to.be.closeTo(before.x, 0.01);
    expect(after.y).to.be.closeTo(before.y, 0.01);
    expect(after.z).to.be.closeTo(before.z, 0.01);
  });

  test('animateCameraTo accepts easing strings and avoid margin', async () => {
    await (element as any).animateCameraTo(
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
        avoidMargin: 0,
        transitionStyle: 'direct',
      }
    );
    await timePasses();

    expect((element as any).cameraControlMode).to.equal('fps');
    expect(element.fieldOfView).to.equal('40deg');
    expect(element.getFieldOfView()).to.be.closeTo(40, 0.1);
  });

  test('animateCameraTo does not apply JSON destination before animating', async () => {
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

    await (element as any).animateCameraTo(
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
      { duration: 1, easing: 'linear' }
    );

    cc.setLookAt = originalSetLookAt;

    expect(calls.length).to.be.greaterThan(0);
    expect(calls[0]).to.deep.equal([1, 2, 3, 0.5, 0.25, -0.5]);
  });

  test('animateCameraTo does not avoid-route targets inside the subject bounds', async () => {
    const scene = element[$scene] as any;
    scene.boundingBox = new Box3(
      new Vector3(-0.5, -0.5, -0.5),
      new Vector3(0.5, 0.5, 0.5)
    );

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

    await (element as any).animateCameraTo(
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
      { duration: 32, easing: 'linear', avoidSubject: true, transitionStyle: 'direct' }
    );

    cc.setLookAt = originalSetLookAt;

    expect(calls.length).to.be.greaterThan(2);
    for (const call of calls) {
      expect(call[3]).to.be.within(-0.101, 0.101);
      expect(call[4]).to.be.within(-0.101, 0.101);
      expect(call[5]).to.be.within(-0.101, 0.101);
    }
  });

  test('channelProgress remaps within stagger windows', () => {
    const window = {start: 0.2, end: 0.6};
    expect(channelProgress(0, window)).to.equal(0);
    expect(channelProgress(0.2, window)).to.equal(0);
    expect(channelProgress(0.4, window)).to.be.closeTo(0.5, 0.001);
    expect(channelProgress(0.6, window)).to.equal(1);
    expect(channelProgress(1, window)).to.equal(1);
  });

  test('pickStaggerWindows overlaps orbit with radius and couples target/fov', () => {
    const out = pickStaggerWindows(1, 15);
    expect(out.target).to.deep.equal(out.orbit);
    expect(out.fov).to.deep.equal(out.radius);
    expect(out.orbit.start).to.be.greaterThan(0);
    expect(out.orbit.start).to.be.at.most(0.15);
    // Out: orbit finishes last so timeline ease-out decelerates the swing.
    expect(out.orbit.end).to.equal(1);
    expect(out.radius.end).to.be.lessThan(out.orbit.end);
    expect(out.radius.end).to.be.greaterThan(out.orbit.start);
    expect(out.radius.start).to.equal(0);

    const into = pickStaggerWindows(15, 1);
    expect(into.target).to.deep.equal(into.orbit);
    expect(into.fov).to.deep.equal(into.radius);
    expect(into.orbit.start).to.equal(0);
    // In: radius finishes last so timeline ease-out decelerates the zoom.
    expect(into.radius.end).to.equal(1);
    expect(into.orbit.end).to.be.lessThan(into.radius.end);
    expect(into.orbit.end).to.be.greaterThan(into.radius.start);
  });

  test('staggered animateCameraTo lands on the destination pose', async () => {
    const scene = element[$scene];

    await (element as any).setCameraView({
      cameraOrbit: '10deg 80deg 4m',
      cameraTarget: '0m 0.2m 0m',
      fieldOfView: '35deg',
    });
    await timePasses();

    await (element as any).animateCameraTo(
      {
        cameraOrbit: '-120deg 70deg 2m',
        cameraTarget: '0.1m 0.3m -0.1m',
        fieldOfView: '50deg',
      },
      {duration: 40, transitionStyle: 'staggered'}
    );
    await timePasses();

    const expected = (element as any).getCameraView();
    // Land writes cameraOrbit/target/fov attributes from the finished pose.
    expect(element.fieldOfView).to.equal(expected.fieldOfView);
    expect(scene.camera.position.length()).to.be.closeTo(2, 0.15);
  });
});
