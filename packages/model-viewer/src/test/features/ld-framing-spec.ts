import {expect} from 'chai';
import {Vector3} from 'three';

import {$controls, MINIMUM_RADIUS_RATIO} from '../../features/controls.js';
import {modelTargetToWorldSpace} from '../../features/ld-camera-space.js';
import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {timePasses, waitForEvent} from '../../utilities.js';
import {assetPath} from '../helpers.js';

// cubes.gltf is off-centre: its bounding box spans x = -0.5 .. ~1.98.
suite('LD framing', () => {
  let element: ModelViewerElement;

  setup(async () => {
    element = new ModelViewerElement();
    element.style.width = '620px';
    element.style.height = '1024px';
    document.body.insertBefore(element, document.body.firstChild);
    element.src = assetPath('models/cubes.gltf');
    element.cameraControls = true;

    await waitForEvent(element, 'poster-dismissed');
    await timePasses();
  });

  teardown(() => {
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  function scene() {
    return (element as any)[$scene];
  }

  test('centres the framing sphere on the bounding box centre', () => {
    const {boundingSphere, boundingBox} = scene();
    const center = boundingBox.getCenter(new Vector3());

    expect(boundingSphere.center.distanceTo(center)).to.be.lessThan(1e-6);
    expect(center.x).to.be.greaterThan(0.5);
    expect(boundingSphere.radius).to.be.closeTo(1.4287, 1e-3);
  });

  test('derives initial and auto minimum radius from the framing sphere',
       () => {
         const {boundingSphere} = scene();
         const controls = (element as any)[$controls];

         expect(element.getCameraOrbit().radius)
             .to.be.closeTo(1.05 * scene().idealCameraDistance(), 1e-4);
         expect(controls.options.minimumRadius)
             .to.be.closeTo(MINIMUM_RADIUS_RATIO * boundingSphere.radius, 1e-6);
       });

  test('explicit camera-target moves the framing sphere centre', async () => {
    element.cameraTarget = '0m 0m 0m';
    await element.updateComplete;
    await element.updateFraming();

    const {boundingSphere} = scene();
    expect(boundingSphere.center.length()).to.be.lessThan(1e-6);
    expect(boundingSphere.radius).to.be.greaterThan(2);
  });

  test('orbits the look-at without translating the model', () => {
    const modelScene = scene();
    const cc = (element as any)[$controls].thirdPartyControls;
    const center = modelScene.boundingBox.getCenter(new Vector3());
    const expectedLookAt = modelTargetToWorldSpace(modelScene, center);

    expect(modelScene.target.position.length()).to.be.lessThan(1e-6);
    expect(cc.getTarget(new Vector3()).distanceTo(expectedLookAt))
        .to.be.lessThan(1e-4);
  });
});
