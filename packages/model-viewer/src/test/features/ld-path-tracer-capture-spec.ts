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
import {Vector2} from 'three';

import {$renderer} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {resolvePathTracerRenderScale} from '../../three-components/postprocessing/ld-path-tracer/path-tracer-scale.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath, rafPasses} from '../helpers.js';

const ASTRONAUT = assetPath('models/Astronaut.glb');

suite('path tracer render scale', () => {
  const base = {
    renderScale: 1,
    pixelRatio: 0,
    devicePixelRatio: 1,
    drawingBufferWidth: 100,
    drawingBufferHeight: 50,
    maxTextureSize: 8192,
  };

  test('keeps a screen-sized trace when pixel ratio is unused', () => {
    expect(resolvePathTracerRenderScale(base)).to.deep.equal({
      renderScale: 1,
      width: 100,
      height: 50,
    });
    expect(resolvePathTracerRenderScale({...base, renderScale: 0.5}))
        .to.deep.equal({
          renderScale: 0.5,
          width: 50,
          height: 25,
        });
    expect(resolvePathTracerRenderScale({...base, renderScale: 4}).renderScale)
        .to.equal(1);
  });

  test('traces at max(devicePixelRatio, pixelRatio) CSS pixels', () => {
    expect(resolvePathTracerRenderScale({
      ...base,
      pixelRatio: 2,
      devicePixelRatio: 1,
    })).to.deep.equal({
      renderScale: 2,
      width: 200,
      height: 100,
    });

    expect(resolvePathTracerRenderScale({
      ...base,
      pixelRatio: 2,
      devicePixelRatio: 2,
      drawingBufferWidth: 200,
      drawingBufferHeight: 100,
    })).to.deep.equal({
      renderScale: 1,
      width: 200,
      height: 100,
    });

    expect(resolvePathTracerRenderScale({
             ...base,
             pixelRatio: 3,
             devicePixelRatio: 1,
             renderScale: 0.5,
           }).renderScale)
        .to.equal(1.5);
  });

  test(
      'caps the requested pixel ratio at 4 and the target at maxTextureSize',
      () => {
        expect(resolvePathTracerRenderScale({
          ...base,
          pixelRatio: 8,
          devicePixelRatio: 1,
        })).to.deep.equal({
          renderScale: 4,
          width: 400,
          height: 200,
        });

        const capped = resolvePathTracerRenderScale({
          ...base,
          pixelRatio: 4,
          devicePixelRatio: 1,
          drawingBufferWidth: 100,
          drawingBufferHeight: 80,
          maxTextureSize: 128,
        });
        expect(capped.width).to.be.at.most(128);
        expect(capped.height).to.be.at.most(128);
        expect(capped.width).to.be.greaterThan(100);
      });
});

const waitUntil = async (predicate: () => boolean, message: string) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 40000) {
      throw new Error(message);
    }
    await rafPasses();
  }
};

const decodeDataUrl = async(src: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('failed to decode capture'));
    image.src = src;
  });
};

const averageChannelDiff = (left: ImageData, right: ImageData): number => {
  const count = Math.min(left.data.length, right.data.length);
  let total = 0;
  let samples = 0;
  for (let i = 0; i < count; i += 4) {
    total += Math.abs(left.data[i] - right.data[i]);
    total += Math.abs(left.data[i + 1] - right.data[i + 1]);
    total += Math.abs(left.data[i + 2] - right.data[i + 2]);
    samples++;
  }
  return samples === 0 ? 0 : total / (samples * 3);
};

const fittedImageData =
    (image: HTMLImageElement, width: number, height: number): ImageData => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context == null) {
        throw new Error('2d context unavailable');
      }
      context.drawImage(image, 0, 0, width, height);
      return context.getImageData(0, 0, width, height);
    };

suite('capturePathTracerFrame', () => {
  test(
      'rejects one-off resolution and capture before the tracer is ready',
      async () => {
        const element = new ModelViewerElement();
        document.body.appendChild(element);
        try {
          let separate = false;
          try {
            await element.capturePathTracerFrame({minPixelRatio: 2});
          } catch (error) {
            separate = /separate resolution/.test((error as Error).message);
          }
          expect(separate).to.equal(true);

          let notReady = false;
          try {
            await element.capturePathTracerFrame();
          } catch (error) {
            notReady = /not ready/.test((error as Error).message);
          }
          expect(notReady).to.equal(true);
        } finally {
          element.remove();
        }
      });
});

suite('path tracer native capture', function() {
  this.timeout(90000);

  let element: ModelViewerElement;
  let readyDetail: {samples?: number, width?: number, height?: number}|null =
      null;

  setup(async () => {
    readyDetail = null;
    element = new ModelViewerElement();
    element.style.width = '80px';
    element.style.height = '60px';
    element.interactionPrompt = 'none';
    element.pathTracerSamples = 2;
    element.pathTracerSamplesThreshold = 1;
    element.pathTracerTiles = '1 1';
    element.pathTracerDenoise = true;
    element.addEventListener('path-tracer-ready', (event) => {
      readyDetail =
          (event as
           CustomEvent<{samples: number, width: number, height: number}>)
              .detail;
    });
    document.body.insertBefore(element, document.body.firstChild);

    const loaded = waitForEvent(element, 'load');
    element.src = ASTRONAUT;
    await loaded;
    element.pathTracer = true;
    await waitUntil(
        () => element.isPathTracerReady === true &&
            element.pathTracerRenderedSamples >= 1,
        'path tracer did not accumulate a sample');
  });

  teardown(() => {
    element?.remove();
  });

  test(
      'reads the tracer target without resizing, and traces above the screen pixel ratio',
      async () => {
        const renderer = element[$renderer].threeRenderer;
        const drawing = new Vector2();
        renderer.getDrawingBufferSize(drawing);
        expect(drawing.x).to.be.greaterThan(0);

        const layout = element.getBoundingClientRect();
        const samplesBefore = element.pathTracerRenderedSamples;
        const frame = await element.capturePathTracerFrame();
        const decoded = await decodeDataUrl(frame.dataUrl);

        expect(frame.samples).to.be.at.least(1);
        expect(element.pathTracerRenderedSamples).to.equal(samplesBefore);
        expect(element.getBoundingClientRect().width).to.equal(layout.width);
        expect(element.getBoundingClientRect().height).to.equal(layout.height);
        expect(decoded.width).to.equal(frame.width);
        expect(decoded.height).to.equal(frame.height);
        expect(readyDetail?.width).to.equal(frame.width);
        expect(readyDetail?.height).to.equal(frame.height);
        const traced = element.getPathTracerComposer()!.getTracedSize();
        expect(traced).to.not.equal(null);
        expect(frame.width).to.equal(traced!.width);
        expect(frame.height).to.equal(traced!.height);
        expect(frame.width).to.equal(drawing.x);
        expect(frame.height).to.equal(drawing.y);

        const rasterUrl = await element.captureImage({
          width: frame.width,
          height: frame.height,
          fileType: 'image/png',
        });
        const raster = await decodeDataUrl(rasterUrl);
        const tracedSmall = fittedImageData(decoded, 32, 24);
        let luminance = 0;
        for (let i = 0; i < tracedSmall.data.length; i += 4) {
          luminance += tracedSmall.data[i] + tracedSmall.data[i + 1] +
              tracedSmall.data[i + 2];
        }
        luminance /= (tracedSmall.data.length / 4) * 3;
        expect(luminance).to.be.greaterThan(
            1, 'path-traced capture should contain rendered pixels');
        const diff =
            averageChannelDiff(tracedSmall, fittedImageData(raster, 32, 24));
        expect(diff).to.be.greaterThan(
            1,
            `path-traced capture should differ from captureImage (diff ${
                diff.toFixed(2)})`);

        const supersampled: {
          tracedWidth?: number,
          tracedHeight?: number,
          reason?: string,
        }[] = [];
        const onScale = (event: Event) => {
          supersampled.push((event as CustomEvent).detail);
        };
        element.addEventListener('render-scale', onScale);
        element.pathTracerPixelRatio =
            Math.max(2, (window.devicePixelRatio || 1) + 1);
        await waitUntil(() => {
          const target = element.getPathTracerComposer()?.getTracedSize();
          return target != null && target.width > drawing.x &&
              element.pathTracerRenderedSamples >= 1;
        }, 'path tracer did not grow past the drawing buffer');

        const grownSize = element.getPathTracerComposer()!.getTracedSize();
        expect(grownSize).to.not.equal(null);
        const grown = await element.capturePathTracerFrame();
        expect(grown.width).to.equal(grownSize!.width);
        expect(grown.height).to.equal(grownSize!.height);
        expect(grown.width).to.be.greaterThan(drawing.x);
        expect(grown.height).to.be.greaterThan(drawing.y);
        expect(element.getBoundingClientRect().width).to.equal(layout.width);
        const reported =
            supersampled.filter((detail) => detail.tracedWidth === grown.width);
        expect(reported.length).to.be.greaterThan(0);
        expect(reported[0].tracedHeight).to.equal(grown.height);
        expect(reported[0].reason).to.equal('path-tracer-pixel-ratio');
        element.removeEventListener('render-scale', onScale);

        const grownImage = await decodeDataUrl(grown.dataUrl);
        expect(grownImage.width).to.equal(grown.width);
        expect(grownImage.height).to.equal(grown.height);
      });
});
