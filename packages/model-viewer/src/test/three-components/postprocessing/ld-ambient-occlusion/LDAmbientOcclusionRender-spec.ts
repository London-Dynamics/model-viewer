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

import {LDEffectsComposer} from '../../../../features/ld-effects-composer/index.js';
import {$renderer, $scene} from '../../../../model-viewer-base.js';
import {ModelViewerElement} from '../../../../model-viewer.js';
import {waitForEvent} from '../../../../utilities.js';

import {assetPath, rafPasses} from '../../../helpers.js';

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

suite('LDAmbientOcclusion render integration', () => {
  let element: ModelViewerElement;

  setup(async () => {
    element = new ModelViewerElement();
    element.style.width = '160px';
    element.style.height = '160px';
    element.ambientOcclusion = true;
    element.aoRadius = 4;
    element.aoOutput = 'default';
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
    expect(element.ambientOcclusion).to.equal(true);
    expect(element[$scene].effectRenderer).to.be.instanceOf(LDEffectsComposer);
  });

  test('matches diffuse output when AO intensity is zero', async () => {
    element.aoOutput = 'diffuse';
    element.aoIntensity = 1;
    await waitFrames();
    const diffusePixels = readPixels(element);

    element.aoOutput = 'default';
    element.aoIntensity = 0;
    await waitFrames();
    const compositePixels = readPixels(element);

    expect(averageRgbDiff(diffusePixels, compositePixels))
        .to.be.lessThan(
            1,
            'Composite output should collapse to diffuse when intensity is zero');
  });

  test('changes when AO intensity changes', async () => {
    element.aoOutput = 'default';
    element.aoRadius = 4;
    element.aoIntensity = 0;
    await waitFrames();
    const noAoPixels = readPixels(element);

    element.aoIntensity = 1;
    await waitFrames();
    const aoPixels = readPixels(element);

    expect(averageRgbDiff(noAoPixels, aoPixels))
        .to.be.greaterThan(
            0.5,
            'Composite output should visibly respond to ao-intensity');
  });

  test('does not collapse low AO intensity to the full composite result', async () => {
    element.aoOutput = 'default';
    element.aoRadius = 4;
    element.aoIntensity = 0;
    await waitFrames();
    const noAoPixels = readPixels(element);

    element.aoIntensity = 0.05;
    await waitFrames();
    const lowAoPixels = readPixels(element);

    element.aoIntensity = 1;
    await waitFrames();
    const fullAoPixels = readPixels(element);

    const lowDiff = averageRgbDiff(noAoPixels, lowAoPixels);
    const fullDiff = averageRgbDiff(noAoPixels, fullAoPixels);

    expect(fullDiff)
        .to.be.greaterThan(
            0.5,
            'Full AO should still visibly change the composite output');
    expect(lowDiff)
        .to.be.lessThan(
            fullDiff * 0.9,
            'A very small AO intensity should stay meaningfully weaker than full AO');
  });

  test('preserves transparent background in composite output', async () => {
    element.aoOutput = 'diffuse';
    element.aoIntensity = 1;
    await waitFrames();
    const diffusePixels = readPixels(element);

    element.aoOutput = 'default';
    element.aoIntensity = 1;
    await waitFrames();
    const compositePixels = readPixels(element);

    const diffuseTransparentPixels = countTransparentPixels(diffusePixels);
    const compositeTransparentPixels = countTransparentPixels(compositePixels);

    expect(diffuseTransparentPixels)
        .to.be.greaterThan(0, 'Diffuse output should preserve transparency');
    expect(compositeTransparentPixels)
        .to.be.closeTo(
            diffuseTransparentPixels,
            Math.max(32, Math.floor(diffuseTransparentPixels * 0.05)),
            'Composite output should preserve the same transparent background');
  });
});
