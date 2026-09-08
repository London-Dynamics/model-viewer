/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {Vector3} from 'three';

import {$controls} from '../../features/controls.js';
import {worldTargetToModelSpace} from '../../features/ld-camera-space.js';
import {$scene, $userInputElement} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {timePasses, waitForEvent} from '../../utilities.js';
import {assetPath, rafPasses} from '../helpers.js';

function dispatchTap(target: HTMLElement, clientX: number, clientY: number) {
  target.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 1,
    button: 0,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  }));
  target.dispatchEvent(new PointerEvent('pointerup', {
    pointerId: 1,
    button: 0,
    clientX,
    clientY,
    bubbles: true,
    cancelable: true,
  }));
}

function distance3(
    a: {x: number; y: number; z: number},
    b: {x: number; y: number; z: number}): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

async function settleTapLookAt(element: ModelViewerElement) {
  const cc = (element as any)[$controls].thirdPartyControls;
  cc.smoothTime = 0;
  cc.update(1);
  await rafPasses();
}

suite('LD controls tap-to-recenter', () => {
  let element: ModelViewerElement;

  setup(async () => {
    element = new ModelViewerElement();
    element.cameraControls = true;
    element.interactionPrompt = 'none';
    element.style.width = '200px';
    element.style.height = '200px';
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
      'tap on the model trucks CameraControls look-at without moving the pivot',
      async () => {
        const scene = element[$scene];
        const input = element[$userInputElement];
        const pivotBefore = scene.getTarget().clone();
        const hitPoint = new Vector3(0.25, 0.15, 0.35);
        const originalHit = scene.positionAndNormalFromPoint.bind(scene);
        scene.positionAndNormalFromPoint = () => ({
          position: hitPoint.clone(),
          normal: new Vector3(0, 0, 1),
          uv: null,
        });

        try {
          const before = element.getCameraTarget();
          dispatchTap(input, 100, 100);

          const cc = (element as any)[$controls].thirdPartyControls;
          const current = new Vector3();
          const end = new Vector3();
          cc.getTarget(current, false);
          cc.getTarget(end, true);
          const expected = worldTargetToModelSpace(scene, hitPoint);
          expect(distance3(end, hitPoint)).to.be.lessThan(0.02, 'goal is hit');
          expect(distance3(current, end))
              .to.be.greaterThan(0.02, 'current look-at is still easing');

          await settleTapLookAt(element);

          const actual = element.getCameraTarget();
          expect(actual.x).to.be.closeTo(expected.x, 0.02, 'X');
          expect(actual.y).to.be.closeTo(expected.y, 0.02, 'Y');
          expect(actual.z).to.be.closeTo(expected.z, 0.02, 'Z');
          expect(distance3(before, actual)).to.be.greaterThan(0.02, 'moved');

          const pivotAfter = scene.getTarget();
          expect(pivotAfter.x).to.be.closeTo(pivotBefore.x, 0.001, 'pivot X');
          expect(pivotAfter.y).to.be.closeTo(pivotBefore.y, 0.001, 'pivot Y');
          expect(pivotAfter.z).to.be.closeTo(pivotBefore.z, 0.001, 'pivot Z');
        } finally {
          scene.positionAndNormalFromPoint = originalHit;
        }
      });

  test('disable-tap leaves the look-at unchanged', async () => {
    element.disableTap = true;
    await element.updateComplete;

    const scene = element[$scene];
    const input = element[$userInputElement];
    const targetBefore = element.getCameraTarget();
    scene.positionAndNormalFromPoint = () => ({
      position: new Vector3(0.4, 0.2, 0.1),
      normal: new Vector3(0, 1, 0),
      uv: null,
    });

    dispatchTap(input, 100, 100);
    await rafPasses();

    const targetAfter = element.getCameraTarget();
    expect(targetAfter.x).to.be.closeTo(targetBefore.x, 0.001, 'X');
    expect(targetAfter.y).to.be.closeTo(targetBefore.y, 0.001, 'Y');
    expect(targetAfter.z).to.be.closeTo(targetBefore.z, 0.001, 'Z');
  });

  test('pointer drag still orbits', async () => {
    const input = element[$userInputElement];
    const orbitBefore = element.getCameraOrbit();

    input.dispatchEvent(new PointerEvent('pointerdown', {
      pointerId: 2,
      button: 0,
      buttons: 1,
      clientX: 80,
      clientY: 80,
      bubbles: true,
      cancelable: true,
    }));
    document.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 2,
      button: 0,
      buttons: 1,
      clientX: 140,
      clientY: 90,
      bubbles: true,
      cancelable: true,
    }));
    await rafPasses();
    document.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 2,
      button: 0,
      clientX: 140,
      clientY: 90,
      bubbles: true,
      cancelable: true,
    }));
    await rafPasses();

    const orbitAfter = element.getCameraOrbit();
    expect(orbitAfter.theta).to.not.equal(orbitBefore.theta);
  });

  test('a second tap retargets without snapping to the first hit', async () => {
    const scene = element[$scene];
    const input = element[$userInputElement];
    const firstHit = new Vector3(0.3, 0.1, 0.2);
    const secondHit = new Vector3(-0.25, 0.2, 0.4);
    let hit = firstHit;
    scene.positionAndNormalFromPoint = () => ({
      position: hit.clone(),
      normal: new Vector3(0, 0, 1),
      uv: null,
    });

    dispatchTap(input, 100, 100);

    const cc = (element as any)[$controls].thirdPartyControls;
    hit = secondHit;
    dispatchTap(input, 120, 110);

    const current = new Vector3();
    const end = new Vector3();
    cc.getTarget(current, false);
    cc.getTarget(end, true);
    expect(distance3(end, secondHit))
        .to.be.lessThan(0.02, 'goal is second hit');
    expect(distance3(current, firstHit))
        .to.be.greaterThan(0.02, 'did not snap to first hit');
    expect(distance3(current, end))
        .to.be.greaterThan(0.02, 'still easing toward second hit');
  });

  test(
      'tap still works after disableCameraDrag / enableCameraDrag',
      async () => {
        element.disableCameraDrag();
        element.enableCameraDrag();
        await element.updateComplete;

        const scene = element[$scene];
        const input = element[$userInputElement];
        const hitPoint = new Vector3(-0.2, 0.05, 0.4);
        scene.positionAndNormalFromPoint = () => ({
          position: hitPoint.clone(),
          normal: new Vector3(0, 0, 1),
          uv: null,
        });

        dispatchTap(input, 110, 110);
        await settleTapLookAt(element);

        const actual = element.getCameraTarget();
        const expected = worldTargetToModelSpace(scene, hitPoint);
        expect(actual.x).to.be.closeTo(expected.x, 0.02, 'X');
        expect(actual.y).to.be.closeTo(expected.y, 0.02, 'Y');
        expect(actual.z).to.be.closeTo(expected.z, 0.02, 'Z');
      });
});
