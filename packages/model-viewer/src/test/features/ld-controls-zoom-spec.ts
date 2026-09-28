import {expect} from 'chai';

import {$controls, DEFAULT_MIN_FOV_DEG} from '../../features/controls.js';
import {$userInputElement} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {timePasses, waitForEvent} from '../../utilities.js';
import {assetPath} from '../helpers.js';

suite('LD controls zoom', () => {
  let element: ModelViewerElement;
  let initialFov: number;
  let initialRadius: number;

  setup(async () => {
    element = new ModelViewerElement();
    document.body.insertBefore(element, document.body.firstChild);
    element.src = assetPath('models/cube.gltf');
    element.cameraControls = true;

    await waitForEvent(element, 'poster-dismissed');
    await timePasses();
    initialFov = element.getFieldOfView();
    initialRadius = element.getCameraOrbit().radius;
  });

  teardown(() => {
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  function cameraControls() {
    return (element as any)[$controls].thirdPartyControls as any;
  }

  function dolly(steps: number, delta: number) {
    const cc = cameraControls();
    for (let i = 0; i < steps; i++) {
      cc._dollyInternal(delta, 0, 0);
    }
    cc.update(0);
  }

  function wheel(steps: number, deltaY: number) {
    for (let i = 0; i < steps; i++) {
      element[$userInputElement].dispatchEvent(new WheelEvent('wheel', {
        deltaY,
        cancelable: true,
      }));
    }
    cameraControls().update(0);
  }

  async function setMinimumRadius(radius: number) {
    element.minCameraOrbit = `auto auto ${radius}m`;
    await element.updateComplete;
    await timePasses();
  }

  test('auto limits floor zoom-in FOV at the default minimum', async () => {
    await setMinimumRadius(initialRadius);

    dolly(200, -1);

    expect(element.getCameraOrbit().radius)
        .to.be.closeTo(initialRadius, 0.00001);
    expect(element.getFieldOfView()).to.be.closeTo(DEFAULT_MIN_FOV_DEG, 1e-6);
  });

  test('auto limits never widen FOV beyond the framed FOV', async () => {
    element.maxCameraOrbit = `auto auto ${initialRadius * 10}m`;
    await element.updateComplete;
    await timePasses();

    dolly(30, 1);

    expect(element.getFieldOfView()).to.be.closeTo(initialFov, 1e-6);
    expect(element.getCameraOrbit().radius).to.be.greaterThan(initialRadius);
  });

  test('mid-range zoom leaves FOV at the framed value', async () => {
    await setMinimumRadius(initialRadius * 0.5);

    dolly(3, -1);

    expect(element.getFieldOfView()).to.be.closeTo(initialFov, 1e-6);
    expect(element.getCameraOrbit().radius).to.be.lessThan(initialRadius);
  });

  test('zooming past minimum radius and back restores radius and FOV',
       async () => {
         const minimumRadius = initialRadius * 0.8;
         await setMinimumRadius(minimumRadius);

         dolly(15, -1);
         expect(element.getCameraOrbit().radius)
             .to.be.closeTo(minimumRadius, 1e-6);
         expect(element.getFieldOfView()).to.be.lessThan(initialFov);
         expect(element.getFieldOfView())
             .to.be.greaterThan(DEFAULT_MIN_FOV_DEG);

         dolly(15, 1);
         expect(element.getCameraOrbit().radius)
             .to.be.closeTo(initialRadius, 1e-6);
         expect(element.getFieldOfView()).to.be.closeTo(initialFov, 1e-6);
       });

  test('wheel zoom-in narrows FOV to an explicit minimum', async () => {
    await setMinimumRadius(initialRadius);
    element.minFieldOfView = '10deg';
    await element.updateComplete;

    wheel(200, -30);

    expect(element.getCameraOrbit().radius)
        .to.be.closeTo(initialRadius, 0.00001);
    expect(element.getFieldOfView()).to.be.closeTo(10, 0.00001);
  });

  test('adjustOrbit radius changes do not touch FOV', async () => {
    await setMinimumRadius(initialRadius);
    const controls = (element as any)[$controls];

    for (let i = 0; i < 50; i++) {
      controls.adjustOrbit(0, 0, 1);
    }

    expect(element.getFieldOfView()).to.be.closeTo(initialFov, 1e-6);
  });

  test('resetCamera restores FOV narrowed by zoom', async () => {
    await setMinimumRadius(initialRadius);
    dolly(20, -1);
    expect(element.getFieldOfView()).to.be.lessThan(initialFov);

    await (element as any).resetCamera();

    expect(element.getFieldOfView()).to.be.closeTo(initialFov, 1e-6);
  });

  test('setCameraView without fieldOfView uses the framed FOV', async () => {
    await setMinimumRadius(initialRadius);
    dolly(20, -1);
    expect(element.getFieldOfView()).to.be.lessThan(initialFov);

    await (element as any).setCameraView({cameraOrbit: '30deg 75deg'});

    expect(element.getFieldOfView()).to.be.closeTo(initialFov, 1e-6);
  });

  test('FPS mode wheel input leaves FOV untouched', async () => {
    (element as any).setCameraControlsMode('fps');
    await element.updateComplete;

    wheel(50, -30);

    expect(element.getFieldOfView()).to.be.closeTo(initialFov, 1e-6);
  });

  test('orthographic zoom leaves FOV untouched and hooks survive camera swap',
       async () => {
         (element as any).setCameraType('orthographic');
         const orthoControls = cameraControls();
         expect(orthoControls._ldHooksInstalled).to.equal(true);

         let dollyCalls = 0;
         let zoomCalls = 0;
         const dollyInternal = orthoControls._dollyInternal;
         const zoomInternal = orthoControls._zoomInternal;
         orthoControls._dollyInternal = (...args: unknown[]) => {
           dollyCalls++;
           return dollyInternal(...args);
         };
         orthoControls._zoomInternal = (...args: unknown[]) => {
           zoomCalls++;
           return zoomInternal(...args);
         };
         wheel(10, -30);
         expect(zoomCalls).to.equal(10);
         expect(dollyCalls).to.equal(0);

         (element as any).setCameraType('perspective');
         expect(element.getFieldOfView()).to.be.closeTo(initialFov, 1e-6);
         expect(cameraControls()).to.not.equal(orthoControls);
         expect(cameraControls()._ldHooksInstalled).to.equal(true);

         const radius = element.getCameraOrbit().radius;
         await setMinimumRadius(radius);
         dolly(20, -1);
         expect(element.getCameraOrbit().radius).to.be.closeTo(radius, 1e-5);
         expect(element.getFieldOfView()).to.be.lessThan(initialFov);
       });
});
