import {expect} from 'chai';
import {Spherical, Vector3} from 'three';

import {$controls} from '../../features/controls.js';
import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {timePasses, waitForEvent} from '../../utilities.js';
import {assetPath} from '../helpers.js';

const DEG = Math.PI / 180;

suite('LD camera model swap', () => {
  let element: ModelViewerElement;

  setup(async () => {
    element = new ModelViewerElement();
    element.cameraControls = true;
    element.interactionPrompt = 'none';
    element.src = assetPath('models/cube.gltf');
    document.body.appendChild(element);
    await waitForEvent(element, 'poster-dismissed');
    await timePasses();
  });

  teardown(() => {
    element.remove();
  });

  function cameraControls() {
    return ((element as any)[$controls] as any).thirdPartyControls;
  }

  function worldTarget(): Vector3 {
    const target = new Vector3();
    cameraControls().getTarget(target);
    return target;
  }

  async function lookAt(position: Vector3, target: Vector3) {
    const cc = cameraControls();
    await cc.setLookAt(
        position.x,
        position.y,
        position.z,
        target.x,
        target.y,
        target.z,
        false);
    cc.update(0);
  }

  test('keeps the live pose when a later model replaces src', async () => {
    element.cameraOrbit = '10deg 120deg 14m';
    element.cameraTarget = '0m 1m 0m';
    await element.updateComplete;
    await timePasses();

    // Below the horizon, close to the subject. The preset properties stay
    // put, which is what an FPS fly does.
    const liveTarget = new Vector3(2, 0.4, -1);
    const livePosition =
        new Vector3()
            .setFromSpherical(new Spherical(1.5, 120 * DEG, 0.4))
            .add(liveTarget);
    await lookAt(livePosition, liveTarget);
    cameraControls().dispatchEvent({type: 'controlstart'});

    const beforePosition = element[$scene].camera.position.clone();
    const beforeTarget = worldTarget();
    const beforeOrbit = element.getCameraOrbit();
    expect(element.cameraOrbit).to.equal('10deg 120deg 14m');
    expect(beforeOrbit.radius).to.be.closeTo(1.5, 0.05);
    expect(beforePosition.y).to.be.lessThan(0.5);

    element.src = assetPath('models/cubes.gltf');
    await waitForEvent(element, 'load');
    await element.updateComplete;
    await timePasses();

    const afterOrbit = element.getCameraOrbit();
    expect(afterOrbit.radius).to.be.closeTo(beforeOrbit.radius, 0.08);
    expect(afterOrbit.phi).to.be.closeTo(beforeOrbit.phi, 0.05);
    expect(afterOrbit.theta).to.be.closeTo(beforeOrbit.theta, 0.05);
    expect(worldTarget().distanceTo(beforeTarget)).to.be.lessThan(0.08);
    expect(element[$scene].camera.position.distanceTo(beforePosition))
        .to.be.lessThan(0.08);
    // Rebuilding radius from the 14m property at this phi drops the camera
    // several metres below the live pose.
    expect(element[$scene].camera.position.y).to.be.greaterThan(-1);
  });

  test('applies an explicit camera goal after a model swap', async () => {
    element.cameraOrbit = '10deg 120deg 14m';
    element.cameraTarget = '0m 1m 0m';
    await element.updateComplete;

    const liveTarget = new Vector3(1, 0.2, 0);
    const livePosition =
        new Vector3()
            .setFromSpherical(new Spherical(1.2, 110 * DEG, 0.2))
            .add(liveTarget);
    await lookAt(livePosition, liveTarget);
    cameraControls().dispatchEvent({type: 'controlstart'});

    element.src = assetPath('models/cubes.gltf');
    await waitForEvent(element, 'load');
    await element.updateComplete;

    element.cameraOrbit = '30deg 60deg 5m';
    element.cameraTarget = '0m 0.2m 0m';
    await element.updateComplete;
    await timePasses();

    const orbit = element.getCameraOrbit();
    expect(orbit.radius).to.be.closeTo(5, 0.1);
    expect(orbit.phi).to.be.closeTo(60 * DEG, 0.05);
    expect(element.getCameraTarget().y).to.be.closeTo(0.2, 0.05);
  });

  test(
      'reapplies the same camera-orbit string when it is set again',
      async () => {
        element.cameraOrbit = '10deg 80deg 6m';
        element.cameraTarget = '0m 0m 0m';
        await element.updateComplete;
        await timePasses();

        await lookAt(new Vector3(1.2, 0.2, 0.4), new Vector3(0, 0.3, 0));
        expect(element.getCameraOrbit().radius).to.be.lessThan(3);

        element.cameraOrbit = '10deg 80deg 6m';
        await element.updateComplete;
        await timePasses();

        expect(element.getCameraOrbit().radius).to.be.closeTo(6, 0.1);
        expect(element.getCameraOrbit().phi).to.be.closeTo(80 * DEG, 0.05);
      });

  test('a src swap before interaction reframes an auto camera', async () => {
    element.cameraOrbit = 'auto auto auto';
    element.cameraTarget = 'auto auto auto';
    await element.updateComplete;
    await timePasses();

    // Left close to the origin, but the user never started a control.
    await lookAt(new Vector3(0.4, 0.2, 0.6), new Vector3(0, 0, 0));
    expect(element.getCameraOrbit().radius).to.be.lessThan(2);

    element.src = assetPath('models/offcenter-cube.gltf');
    await waitForEvent(element, 'load');
    await element.updateComplete;
    await timePasses();

    const center = element[$scene].boundingBox.getCenter(new Vector3());
    const target = element.getCameraTarget();
    const framed = 1.05 * element[$scene].idealCameraDistance();
    const after = element.getCameraOrbit();
    expect(center.length()).to.be.greaterThan(50);
    expect(new Vector3(target.x, target.y, target.z).distanceTo(center))
        .to.be.lessThan(0.5);
    expect(after.radius).to.be.closeTo(framed, 0.2);
    expect(after.radius).to.be.greaterThan(2);
    expect(after.phi).to.be.closeTo(75 * DEG, 0.05);
  });
});
