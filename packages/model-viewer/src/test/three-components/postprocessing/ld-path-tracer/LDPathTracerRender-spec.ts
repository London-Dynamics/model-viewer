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
    element.pathTracerSamples = 64;
    element.pathTracerSamplesThreshold = 32;
    await waitFrames(2);

    const composer = element.getPathTracerComposer() as any;
    const pathTracer = composer?.pathTracer;

    expect(element.pathTracerSamples).to.equal(64);
    expect(element.pathTracerSamplesThreshold).to.equal(32);
    expect(pathTracer?.minSamples).to.equal(32);
  });

  test('exposes accumulated sample count for debugging', async () => {
    await waitFrames(12);

    expect(element.pathTracerRenderedSamples)
        .to.be.greaterThan(0, 'Sample count should reflect accumulation');
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
