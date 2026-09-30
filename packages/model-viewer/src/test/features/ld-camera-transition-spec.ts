import {expect} from 'chai';
import {Vector3} from 'three';

import {$controls} from '../../features/controls.js';
import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {timePasses, waitForEvent} from '../../utilities.js';
import {assetPath} from '../helpers.js';

suite('LD camera transitions', () => {
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

  test('remains settled with camera controls enabled', async () => {
    await (element as any).setCameraView({
      cameraOrbit: '10deg 70deg 3m',
      cameraTarget: '0m 0m 0m',
      fieldOfView: '25deg',
    });
    element.interactionPrompt = 'auto';
    element.interactionPromptStyle = 'wiggle';
    element.interactionPromptThreshold = 0;
    await element.updateComplete;
    await timePasses();

    await (element as any)
        .animateCameraTo(
            {
              cameraOrbit: '120deg 60deg 4m',
              cameraTarget: '0m 0.25m 0m',
              fieldOfView: '35deg',
            },
            {duration: 40});

    const landed = element[$scene].camera.position.clone();
    await timePasses();
    await timePasses();
    expect(element[$scene].camera.position.distanceTo(landed))
        .to.be.lessThan(0.001);
  });

  test(
      'waits for a replacement model before resolving its target', async () => {
        element.src = assetPath('models/offcenter-cube.gltf');
        const loaded = waitForEvent(element, 'load');
        const animation = (element as any)
                              .animateCameraTo(
                                  {
                                    cameraOrbit: '90deg 70deg 3m',
                                    cameraTarget: 'auto auto auto',
                                  },
                                  {duration: 20});

        await loaded;
        await animation;

        const target = element.getCameraTarget();
        expect(new Vector3(target.x, target.y, target.z)
                   .distanceTo(
                       element[$scene].boundingBox.getCenter(new Vector3())))
            .to.be.lessThan(0.1);
      });

  test('clamps animated field of view to configured limits', async () => {
    element.minFieldOfView = '20deg';
    element.maxFieldOfView = '40deg';
    await element.updateComplete;

    await (element as any)
        .animateCameraTo(
            {
              cameraOrbit: '45deg 70deg 3m',
              cameraTarget: '0m 0m 0m',
              fieldOfView: '70deg',
            },
            {duration: 20});

    expect(element.getFieldOfView()).to.be.closeTo(40, 0.1);
  });

  test('honors one-sided explicit zoom limits', async () => {
    element.minFieldOfView = '20deg';
    element.maxFieldOfView = 'auto';
    element.minCameraOrbit = 'auto auto 2m';
    element.maxCameraOrbit = 'auto auto auto';
    await element.updateComplete;

    await (element as any)
        .animateCameraTo(
            {
              cameraOrbit: '45deg 70deg 0.5m',
              cameraTarget: '0m 0m 0m',
              fieldOfView: '5deg',
            },
            {duration: 20});

    expect(element.getFieldOfView()).to.be.closeTo(20, 0.1);
    expect(element.getCameraOrbit().radius).to.be.closeTo(2, 0.1);

    element.minFieldOfView = 'auto';
    element.maxFieldOfView = '40deg';
    element.minCameraOrbit = 'auto auto auto';
    element.maxCameraOrbit = 'auto auto 5m';
    await element.updateComplete;

    await (element as any)
        .animateCameraTo(
            {
              cameraOrbit: '45deg 70deg 8m',
              cameraTarget: '0m 0m 0m',
              fieldOfView: '70deg',
            },
            {duration: 20});

    expect(element.getFieldOfView()).to.be.closeTo(40, 0.1);
    expect(element.getCameraOrbit().radius).to.be.closeTo(5, 0.1);
  });

  test('removing orbit limit attributes does not throw', async () => {
    element.minCameraOrbit = 'auto auto 2m';
    element.maxCameraOrbit = 'auto 95deg auto';
    await element.updateComplete;

    element.removeAttribute('min-camera-orbit');
    element.removeAttribute('max-camera-orbit');
    await element.updateComplete;
  });

  suite('orbit limits after a transition', () => {
    const DEG = Math.PI / 180;
    const cameraControls = () =>
        ((element as any)[$controls] as any).thirdPartyControls;

    setup(async () => {
      element.minCameraOrbit = 'auto 0deg 0.5m';
      element.maxCameraOrbit = 'auto 95deg 4m';
      await element.updateComplete;
    });

    test('keeps unchanged limits in force', async () => {
      await (element as any)
          .animateCameraTo(
              {cameraOrbit: '45deg 70deg 3m', cameraTarget: '0m 0m 0m'},
              {duration: 20});

      const cc = cameraControls();
      expect(cc.maxPolarAngle).to.be.closeTo(95 * DEG, 1e-6);
      expect(cc.minPolarAngle).to.be.closeTo(0, 1e-6);
      expect(cc.maxDistance).to.be.closeTo(4, 1e-6);
      expect(cc.minDistance).to.be.closeTo(0.5, 1e-6);
    });

    test('keeps limits in force for an instant transition', async () => {
      await (element as any)
          .animateCameraTo(
              {cameraOrbit: '45deg 70deg 3m', cameraTarget: '0m 0m 0m'},
              {duration: 0});

      expect(cameraControls().maxPolarAngle).to.be.closeTo(95 * DEG, 1e-6);
      expect(cameraControls().maxDistance).to.be.closeTo(4, 1e-6);
    });

    test('limits written after the transition win', async () => {
      await (element as any)
          .animateCameraTo(
              {cameraOrbit: '45deg 70deg 3m', cameraTarget: '0m 0m 0m'},
              {duration: 20});
      element.maxCameraOrbit = 'auto 80deg 5m';
      await element.updateComplete;

      expect(cameraControls().maxPolarAngle).to.be.closeTo(80 * DEG, 1e-6);
      expect(cameraControls().maxDistance).to.be.closeTo(5, 1e-6);
    });

    test('limits changed mid-transition apply without clamping it', async () => {
      const animation = (element as any)
                            .animateCameraTo(
                                {
                                  cameraOrbit: '45deg 85deg 3m',
                                  cameraTarget: '0m 0m 0m',
                                },
                                {duration: 200});
      await timePasses(50);
      element.maxCameraOrbit = 'auto 80deg 4m';
      await element.updateComplete;
      await animation;

      expect(element.getCameraOrbit().phi).to.be.closeTo(85 * DEG, 0.01);
      expect(cameraControls().maxPolarAngle).to.be.closeTo(80 * DEG, 1e-6);
    });

    test('FPS mode keeps limits open', async () => {
      (element as any).setCameraControlsMode('fps');
      await element.updateComplete;

      await (element as any)
          .animateCameraTo(
              {cameraOrbit: '45deg 70deg 3m', cameraTarget: '0m 0m 0m'},
              {duration: 20});

      expect(cameraControls().maxPolarAngle).to.be.closeTo(Math.PI, 1e-6);
      expect(cameraControls().maxDistance).to.equal(Infinity);
    });
  });

  test('allows pointer interaction to cancel a transition', async () => {
    const animation = (element as any)
                          .animateCameraTo(
                              {
                                cameraOrbit: '160deg 70deg 3m',
                                cameraTarget: '0m 0m 0m',
                              },
                              {duration: 500});
    await timePasses();

    element.dispatchEvent(new PointerEvent('pointerdown', {
      clientX: 10,
      clientY: 10,
      bubbles: true,
    }));
    await animation;

    const cancelledAt = element[$scene].camera.position.clone();
    await timePasses();
    expect(element[$scene].camera.position.distanceTo(cancelledAt))
        .to.be.lessThan(0.001);
  });
});
