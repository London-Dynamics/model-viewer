/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {expect} from 'chai';

import {$renderer, $scene} from '../../../../model-viewer-base.js';
import {ModelViewerElement} from '../../../../model-viewer.js';
import {waitForEvent} from '../../../../utilities.js';

import {assetPath, rafPasses} from '../../../helpers.js';

const BAG_GLB =
    'https://assets.v2.londondynamics.com/019dfd85-606d-770c-9854-43a16af56055/puzzledefault/e14d1a56-44bb-dc4a-e1e8-87b0513324d8.glb';
const CB1_GLB =
    'https://assets.v2.londondynamics.com/c8bd376d-c1e0-4c8f-ad7f-e64e7d62a08a/puzzlesingle/12111feb-5397-b121-4dc9-d066f14f1a64.glb';
const CB1_HDR =
    'https://d1mepjfmhz5ui7.cloudfront.net/crateandbarrel/KO_Base_Hero_Studio_1k.hdr';

const waitFrames = async (count: number = 6) => {
  for (let i = 0; i < count; i++) {
    await rafPasses();
  }
};

const readPixels = (element: ModelViewerElement): Uint8Array => {
  const context = element[$renderer].threeRenderer.getContext();
  const width = context.drawingBufferWidth;
  const height = context.drawingBufferHeight;
  const pixels = new Uint8Array(width * height * 4);
  context.readPixels(
      0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
  return pixels;
};

const averageRgbDiff = (left: Uint8Array, right: Uint8Array): number => {
  expect(left.length).to.be.equal(right.length);

  let total = 0;
  for (let i = 0; i < left.length; i += 4) {
    total += Math.abs(left[i] - right[i]);
    total += Math.abs(left[i + 1] - right[i + 1]);
    total += Math.abs(left[i + 2] - right[i + 2]);
  }

  return total / ((left.length / 4) * 3);
};

const countTransparentPixels = (pixels: Uint8Array, threshold: number = 16) => {
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < threshold) {
      count++;
    }
  }
  return count;
};

const countOpaquePixels = (pixels: Uint8Array, threshold: number = 16) =>
    pixels.length / 4 - countTransparentPixels(pixels, threshold);

const LD_CAR_URL =
    'https://assets.v2.londondynamics.com/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000/LD_Car1.glb';

suite('LDPathTracer render integration', function() {
  this.timeout(20000);

  let element: ModelViewerElement;

  setup(async () => {
    element = new ModelViewerElement();
    element.style.width = '160px';
    element.style.height = '160px';
    element.pathTracer = true;
    element.pathTracerDisplay = 'progressive';
    element.pathTracerSamples = 4;
    element.pathTracerSamplesThreshold = 1;
    element.pathTracerBounces = 3;
    document.body.insertBefore(element, document.body.firstChild);

    const posterDismissed = waitForEvent(element, 'poster-dismissed');
    const loaded = waitForEvent(element, 'load');
    element.src = assetPath('models/Astronaut.glb');

    await loaded;
    await posterDismissed;
    await waitFrames();
  });

  teardown(() => {
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
  });

  test('registers an effect composer when initially enabled', async () => {
    expect(element.pathTracer).to.equal(true);
    expect(element[$scene].effectRenderer).to.not.equal(null);
  });

  test('uses separate target samples and display threshold', async () => {
    element.pathTracerDisplay = 'progressive';
    element.pathTracerSamples = 64;
    element.pathTracerSamplesThreshold = 32;
    element.pathTracerFade = 0.3;
    await waitFrames(2);

    const composer = element.getPathTracerComposer() as any;
    const pathTracer = composer?.pathTracer;

    expect(element.pathTracerSamples).to.equal(64);
    expect(element.pathTracerSamplesThreshold).to.equal(32);
    expect(pathTracer?.minSamples).to.equal(32);
    expect(pathTracer?.fadeDuration).to.equal(300);
  });

  test('holds the path trace off until denoise when that display is selected', async () => {
    element.pathTracerDisplay = 'after-denoise';
    element.pathTracerFade = 0.3;
    element.pathTracerSamples = 64;
    element.pathTracerSamplesThreshold = 1;
    await waitFrames(2);

    const composer = element.getPathTracerComposer() as any;
    const pathTracer = composer?.pathTracer;

    expect(pathTracer?.minSamples).to.equal(Number.MAX_SAFE_INTEGER);
    expect(pathTracer?._quad?.material?.opacity).to.equal(0);
    expect(pathTracer?.fadeDuration).to.equal(300);
  });

  test('applies the floor material from path tracer properties', async () => {
    element.pathTracerFloor = 'shadow';
    element.pathTracerFloorColor = '#ff0000';
    element.pathTracerFloorRoughness = 0.35;
    element.pathTracerFloorMetalness = 0.5;
    element.pathTracerFloorOpacity = 0.8;
    await waitFrames(4);

    let floor: any = null;
    let preview: any = null;
    element[$scene].traverse((object) => {
      if (object.name === 'PathTracerShadowCatcher') {
        floor = object;
      }
      if (object.name === 'PathTracerFloorPreview') {
        preview = object;
      }
    });

    expect(floor).to.not.equal(null);
    expect(floor.visible).to.equal(true);
    expect(floor.layers.test(0)).to.equal(false);
    expect(floor.layers.test(1)).to.equal(true);
    expect(floor.material.matte).to.equal(true);
    const material = floor!.material;
    expect(material.color.getHexString()).to.equal('ff0000');
    expect(material.roughness).to.be.closeTo(0.35, 1e-4);
    expect(material.metalness).to.be.closeTo(0.5, 1e-4);
    // The holdout stays opaque to rays. floorOpacity scales the effect.
    expect(material.opacity).to.equal(1);
    expect(material.transparent).to.equal(false);
    expect(preview).to.not.equal(null);
    expect(preview.layers.test(0)).to.equal(true);
  });

  test('paints missed rays with the page background color', async () => {
    const previous = document.body.style.backgroundColor;
    document.body.style.backgroundColor = '#ff0000';
    try {
      element[$scene].queueRender();
      await waitFrames(4);

      const composer = element.getPathTracerComposer() as any;
      const material = composer.pathTracer._pathTracer.material;
      expect(material.backgroundAlpha).to.equal(1);
      expect(material.backgroundMap.topColor.getHexString()).to.equal('ff0000');
      expect(material.backgroundMap.bottomColor.getHexString()).to.equal('ff0000');

      document.body.style.backgroundColor = '#ffffff';
      element[$scene].queueRender();
      await waitFrames(4);
      expect(material.backgroundMap.topColor.getHexString()).to.equal('ffffff');
      expect(material.backgroundMap.bottomColor.getHexString()).to.equal('ffffff');
      expect(element[$scene].background).to.equal(null);
    } finally {
      document.body.style.backgroundColor = previous;
    }
  });

  test('exposes accumulated sample count for debugging', async () => {
    element.interactionPrompt = 'none';
    await waitFrames(12);
    for (let frame = 0; frame < 40 && element.pathTracerRenderedSamples === 0;
         frame++) {
      await rafPasses();
    }

    expect(element.pathTracerRenderedSamples)
        .to.be.greaterThan(0, 'Sample count should reflect accumulation');
  });

  test('does not path trace while the camera is moving', async () => {
    element.interactionPrompt = 'none';
    await waitFrames(12);
    for (let frame = 0; frame < 40 && element.pathTracerRenderedSamples === 0;
         frame++) {
      await rafPasses();
    }
    expect(element.pathTracerRenderedSamples).to.be.greaterThan(0);

    const composer = element.getPathTracerComposer() as any;
    const gpuTracer = composer.pathTracer._pathTracer;
    let traceCalls = 0;
    const originalUpdate = gpuTracer.update.bind(gpuTracer);
    gpuTracer.update = (...args: unknown[]) => {
      traceCalls++;
      return originalUpdate(...args);
    };

    try {
      const camera = element[$scene].getCamera();
      camera.position.x += 1;
      camera.updateMatrixWorld(true);

      composer.beforeRender(performance.now(), 16);
      composer.render(16);
      expect(traceCalls).to.equal(
          0, 'A camera move should draw the real-time view without a sample');
      expect(composer.getSamples()).to.equal(0);

      composer.beforeRender(performance.now(), 16);
      composer.render(16);
      expect(traceCalls).to.equal(
          0, 'Path tracing waits after the camera stops moving');

      await new Promise((resolve) => setTimeout(resolve, 350));
      composer.beforeRender(performance.now(), 16);
      composer.render(16);
      expect(traceCalls).to.be.greaterThan(
          0, 'Path tracing starts once the camera has settled');
      expect(composer.getSamples()).to.be.greaterThan(0);
    } finally {
      gpuTracer.update = originalUpdate;
    }
  });

  test('does not path trace while the pointer is held still', async () => {
    element.interactionPrompt = 'none';
    await waitFrames(12);
    for (let frame = 0; frame < 40 && element.pathTracerRenderedSamples === 0;
         frame++) {
      await rafPasses();
    }
    expect(element.pathTracerRenderedSamples).to.be.greaterThan(0);

    const composer = element.getPathTracerComposer() as any;
    const gpuTracer = composer.pathTracer._pathTracer;
    let traceCalls = 0;
    const originalUpdate = gpuTracer.update.bind(gpuTracer);
    gpuTracer.update = (...args: unknown[]) => {
      traceCalls++;
      return originalUpdate(...args);
    };

    try {
      element.dispatchEvent(new PointerEvent('pointerdown', {
        pointerId: 1,
        button: 0,
        bubbles: true,
      }));
      composer.beforeRender(performance.now(), 16);
      composer.render(16);
      expect(traceCalls).to.equal(
          0, 'A held pointer should stay on the real-time view');
      expect(composer.getSamples()).to.equal(0);
    } finally {
      gpuTracer.update = originalUpdate;
      element.dispatchEvent(new PointerEvent('pointerup', {
        pointerId: 1,
        button: 0,
        bubbles: true,
      }));
    }
  });

  test('accumulates samples with AO and bloom enabled', async () => {
    element.ambientOcclusion = true;
    element.bloom = true;
    element.bloomStrength = 0.69;
    await waitFrames(24);

    expect(element.pathTracer).to.equal(true);
    expect(element.ambientOcclusion).to.equal(true);
    expect(element.bloom).to.equal(true);
    expect(element.pathTracerRenderedSamples)
        .to.be.greaterThan(
            0, 'Path tracer should run behind the AO+bloom preview');
  });

  test('accumulates samples when AO, bloom, and path tracer start from markup',
      async () => {
        element.remove();

        element = new ModelViewerElement();
        element.style.width = '160px';
        element.style.height = '160px';
        element.setAttribute('ambient-occlusion', '');
        element.setAttribute('bloom', '');
        element.setAttribute('bloom-strength', '0.69');
        element.setAttribute('path-tracer', '');
        element.setAttribute('path-tracer-samples', '32');
        element.setAttribute('path-tracer-samples-threshold', '6');
        element.setAttribute('path-tracer-bounces', '5');
        document.body.insertBefore(element, document.body.firstChild);

        const posterDismissed = waitForEvent(element, 'poster-dismissed');
        const loaded = waitForEvent(element, 'load');
        element.src = assetPath('models/Astronaut.glb');

        await loaded;
        await posterDismissed;
        await waitFrames(48);

        expect(element.pathTracer).to.equal(true);
        expect(element.ambientOcclusion).to.equal(true);
        expect(element.bloom).to.equal(true);
        expect(element.pathTracerRenderedSamples)
            .to.be.greaterThan(
                0, 'Path tracer should run from initial combined attributes');
      });

  test('accumulates samples for the combined verification car', async () => {
    element.remove();

    element = new ModelViewerElement();
    element.style.width = '160px';
    element.style.height = '160px';
    element.setAttribute('ambient-occlusion', '');
    element.setAttribute('bloom', '');
    element.setAttribute('bloom-strength', '0.69');
    element.setAttribute('path-tracer', '');
    element.setAttribute('path-tracer-samples', '32');
    element.setAttribute('path-tracer-samples-threshold', '6');
    element.setAttribute('field-of-view', '30deg');
    document.body.insertBefore(element, document.body.firstChild);

    const posterDismissed = waitForEvent(element, 'poster-dismissed');
    const loaded = waitForEvent(element, 'load');
    element.src = LD_CAR_URL;

    await loaded;
    await posterDismissed;
    element.setBloomTargets([
      {
        material: 'Polestar_RenderMaterial_RedLight',
        color: '#ff0000',
        intensity: 0.69,
      },
      {
        material: 'Polestar_RenderMaterial_WhiteLight',
        color: '#ffffff',
        intensity: 0.69,
      },
    ]);
    await waitFrames(96);

    expect(element.pathTracerRenderedSamples)
        .to.be.greaterThan(
            0, 'Path tracer should run for the combined verification car');
  });

  test('changes the rendered output when toggled on', async () => {
    element.pathTracer = false;
    await waitFrames(6);
    const normalPixels = readPixels(element);

    element.pathTracer = true;
    await waitFrames(24);
    const pathTracedPixels = readPixels(element);

    expect(averageRgbDiff(normalPixels, pathTracedPixels))
        .to.be.greaterThan(
            0.1, 'Path tracing should visibly change the rendered output');
  });

  test('renders visible output after increasing sample count', async () => {
    element.pathTracerSamples = 8;
    await waitFrames(48);
    const pixels = readPixels(element);

    expect(countOpaquePixels(pixels))
        .to.be.greaterThan(
            0, 'Path traced output should remain visible after samples change');
  });

  test('preserves accumulated samples for display-only option changes', async () => {
    await waitFrames(12);
    const samplesBeforeTargetChange = element.pathTracerRenderedSamples;

    element.pathTracerSamples = 64;
    await waitFrames(2);

    expect(element.pathTracerRenderedSamples)
        .to.be.at.least(
            samplesBeforeTargetChange,
            'Changing the target sample count should not reset accumulation');

    const samplesBeforeDenoiseChange = element.pathTracerRenderedSamples;
    element.pathTracerDenoise = false;
    await waitFrames(2);

    expect(element.pathTracerRenderedSamples)
        .to.be.at.least(
            samplesBeforeDenoiseChange,
            'Changing denoise display mode should not reset accumulation');
  });

  test('keeps the path tracer registered when bounces changes', async () => {
    const composer = element[$scene].effectRenderer;
    element.pathTracerBounces = 1;
    await waitFrames(8);

    element.pathTracerBounces = 4;
    await waitFrames(8);

    expect(element[$scene].effectRenderer).to.equal(composer);
    expect(countOpaquePixels(readPixels(element)))
        .to.be.greaterThan(
            0, 'Path traced output should remain visible after bounces change');
  });

  test('applies depth of field camera settings to the path tracer', async () => {
    element.pathTracerDepthOfField = true;
    element.pathTracerFocalLength = 85;
    element.pathTracerFStop = 1.8;
    element.pathTracerFocusDistance = 2.5;
    element.pathTracerApertureBlades = 7;
    element.pathTracerApertureRotation = 0.5;
    element.pathTracerAnamorphicRatio = 1.25;
    await waitFrames(8);

    const composer = element.getPathTracerComposer() as any;
    const camera = composer?.pathTracer?.camera;
    const physicalCamera = composer?.pathTracer?._pathTracer?.material
                               ?.physicalCamera;

    expect(camera?.isPerspectiveCamera).to.equal(true);
    expect(camera?.constructor?.name).to.equal('PhysicalCamera');
    expect(camera?.getFocalLength()).to.be.closeTo(85, 0.01);
    expect(camera?.fStop).to.equal(1.8);
    expect(camera?.focusDistance).to.equal(2.5);
    expect(camera?.apertureBlades).to.equal(7);
    expect(camera?.apertureRotation).to.equal(0.5);
    expect(camera?.anamorphicRatio).to.equal(1.25);
    expect(physicalCamera?.bokehSize)
        .to.be.greaterThan(0, 'Physical camera should enable DOF in shader');
  });

  test('preserves transparent background in composite output', async () => {
    await waitFrames(12);
    const pixels = readPixels(element);

    expect(countTransparentPixels(pixels))
        .to.be.greaterThan(
            0, 'Path traced output should preserve transparent background');
  });

  test('Bag', async () => {
    const loaded = waitForEvent(element, 'load');
    element.src = BAG_GLB;

    await loaded;
    await waitFrames(48);

    expect(element.pathTracer).to.equal(true);
    expect(element[$scene].effectRenderer).to.not.equal(null);
    expect(countOpaquePixels(readPixels(element)))
        .to.be.greaterThan(
            0, 'Bag should render visible pixels with path tracing enabled');
  });

  test('CB1', async () => {
    const loaded = waitForEvent(element, 'load');
    const environmentChanged = waitForEvent(element, 'environment-change');
    element.environmentImage = CB1_HDR;
    element.src = CB1_GLB;

    await Promise.all([loaded, environmentChanged]);
    await waitFrames(48);

    expect(element.pathTracer).to.equal(true);
    expect(element.environmentImage).to.equal(CB1_HDR);
    expect(element[$scene].effectRenderer).to.not.equal(null);
    expect(countOpaquePixels(readPixels(element)))
        .to.be.greaterThan(
            0, 'CB1 should render visible pixels with path tracing enabled');
  });
});
