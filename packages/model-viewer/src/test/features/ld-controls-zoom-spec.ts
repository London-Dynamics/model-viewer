import {expect} from 'chai';

import {$controls} from '../../features/controls.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {timePasses, waitForEvent} from '../../utilities.js';
import {assetPath} from '../helpers.js';

suite('LD controls zoom', () => {
  let element: ModelViewerElement;

  setup(async () => {
    element = new ModelViewerElement();
    document.body.insertBefore(element, document.body.firstChild);
    element.src = assetPath('models/cube.gltf');
    element.cameraControls = true;

    await waitForEvent(element, 'poster-dismissed');
    await timePasses();
  });

  teardown(() => {
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  async function clampAtMinimumRadius() {
    const orbit = element.getCameraOrbit();
    element.minCameraOrbit = `auto auto ${orbit.radius}m`;
    element.minFieldOfView = '10deg';
    await element.updateComplete;
    await timePasses();
    return orbit.radius;
  }

  test('narrows FOV for CameraControls dolly at minimum radius', async () => {
    const radius = await clampAtMinimumRadius();
    const controls = (element as any)[$controls];
    const cc = controls.thirdPartyControls as any;

    for (let i = 0; i < 200; i++) {
      cc._dollyInternal(1, 0, 0);
    }
    cc.update(0);

    expect(element.getCameraOrbit().radius).to.be.closeTo(radius, 0.00001);
    expect(element.getFieldOfView()).to.be.closeTo(10, 0.00001);
  });

  test('narrows FOV for adjustOrbit zoom at minimum radius', async () => {
    const radius = await clampAtMinimumRadius();
    const controls = (element as any)[$controls];

    for (let i = 0; i < 200; i++) {
      controls.adjustOrbit(0, 0, 1);
    }

    expect(element.getCameraOrbit().radius).to.be.closeTo(radius, 0.00001);
    expect(element.getFieldOfView()).to.be.closeTo(10, 0.00001);
  });
});
