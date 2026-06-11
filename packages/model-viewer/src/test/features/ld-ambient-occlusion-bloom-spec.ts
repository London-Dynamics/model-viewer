/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';

import {$renderer, $scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {timePasses, waitForEvent} from '../../utilities.js';
import {assetPath, rafPasses} from '../helpers.js';

type PipelineInternals = {
  hasAmbientOcclusion(): boolean;
  hasBloom(): boolean;
};

const getPipeline = (element: ModelViewerElement): PipelineInternals =>
    element[$scene].effectRenderer as unknown as PipelineInternals;

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
  expect(left.length).to.equal(right.length);

  let total = 0;
  for (let i = 0; i < left.length; i += 4) {
    total += Math.abs(left[i] - right[i]);
    total += Math.abs(left[i + 1] - right[i + 1]);
    total += Math.abs(left[i + 2] - right[i + 2]);
  }

  return total / ((left.length / 4) * 3);
};

const averageLuminance = (pixels: Uint8Array): number => {
  let total = 0;
  let count = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) {
      continue;
    }
    total += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 +
        pixels[i + 2] * 0.0722;
    count++;
  }
  return count === 0 ? 0 : total / count;
};

suite('LD Ambient Occlusion with Bloom', () => {
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
    document.body.appendChild(element);
  });

  teardown(() => {
    element.remove();
  });

  test('keeps AO and bloom enabled with one effect renderer', async () => {
    element.ambientOcclusion = true;
    element.bloom = true;
    await timePasses();

    expect(element.ambientOcclusion).to.equal(true);
    expect(element.bloom).to.equal(true);
    expect(element[$scene].effectRenderer).to.not.equal(null);
    expect(getPipeline(element).hasAmbientOcclusion()).to.equal(true);
    expect(getPipeline(element).hasBloom()).to.equal(true);
  });

  test('does not disable either feature when the other changes', async () => {
    element.ambientOcclusion = true;
    element.bloom = true;
    await timePasses();

    element.aoRadius = 2;
    element.bloomStrength = 0.9;
    await timePasses();

    expect(element.ambientOcclusion).to.equal(true);
    expect(element.bloom).to.equal(true);
    expect(getPipeline(element).hasAmbientOcclusion()).to.equal(true);
    expect(getPipeline(element).hasBloom()).to.equal(true);
  });

  test('zero-strength bloom does not darken the AO-rendered model', async () => {
    element.style.width = '160px';
    element.style.height = '160px';
    element.ambientOcclusion = true;
    element.aoIntensity = 1;
    element.bloom = false;

    const loaded = waitForEvent(element, 'load');
    const posterDismissed = waitForEvent(element, 'poster-dismissed');
    element.src = assetPath('models/Astronaut.glb');

    await loaded;
    await posterDismissed;
    await waitFrames();
    const aoOnlyPixels = readPixels(element);

    element.bloom = true;
    element.bloomStrength = 0;
    await waitFrames();
    const aoBloomPixels = readPixels(element);

    expect(averageRgbDiff(aoOnlyPixels, aoBloomPixels))
        .to.be.lessThan(3, 'Zero-strength bloom should be visually neutral');
    expect(averageLuminance(aoBloomPixels))
        .to.be.greaterThan(
            averageLuminance(aoOnlyPixels) - 1,
            'Enabling zero-strength bloom should not darken the AO base render');
  });
});
