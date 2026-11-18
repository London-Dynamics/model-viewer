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

import {expandCropForDenoiseEdge, measureTraceCoverage} from '../../../../three-components/postprocessing/ld-path-tracer/trace-coverage.js';

const fill = (width: number, height: number, x: number, yFromTop: number) => {
  const rgba = new Uint8Array(width * height * 4);
  const bufferRow = height - 1 - yFromTop;
  const index = (bufferRow * width + x) * 4;
  rgba[index] = 255;
  return rgba;
};

suite('trace coverage', () => {
  test('maps a top-left WebGL pixel to the top of the crop', () => {
    const measured = measureTraceCoverage(fill(4, 4, 0, 0), 4, 4, 4, 4, 0);
    expect(measured.maskPixels).to.equal(1);
    expect(measured.crop).to.deep.equal({x: 0, y: 0, width: 1, height: 1});
    expect(measured.tracedPixels).to.equal(1);
  });

  test('maps a bottom row pixel to the bottom of the crop', () => {
    const measured = measureTraceCoverage(fill(4, 4, 3, 3), 4, 4, 4, 4, 0);
    expect(measured.crop).to.deep.equal({x: 3, y: 3, width: 1, height: 1});
  });

  test('grows the crop by the margin and scales it to the full grid', () => {
    const bare = measureTraceCoverage(fill(4, 4, 1, 1), 4, 4, 40, 40, 0);
    const grown = measureTraceCoverage(fill(4, 4, 1, 1), 4, 4, 40, 40, 8);
    expect(bare.crop).to.deep.equal({x: 10, y: 10, width: 10, height: 10});
    expect(grown.crop).to.not.equal(null);
    expect(grown.crop!.width).to.be.greaterThan(bare.crop!.width);
    expect(grown.crop!.x).to.be.lessThan(bare.crop!.x);
    expect(grown.tracedPixels).to.be.lessThan(grown.fullPixels);
  });

  test('keeps the full frame when the subject already fills it', () => {
    const rgba = new Uint8Array(4 * 4 * 4);
    rgba.fill(255);
    const measured = measureTraceCoverage(rgba, 4, 4, 4, 4, 0);
    expect(measured.crop).to.equal(null);
    expect(measured.tracedPixels).to.equal(16);
    expect(measured.maskPixels).to.equal(16);
  });

  test('pads an inset crop and keeps a frame edge put', () => {
    const padded = expandCropForDenoiseEdge(
        {x: 100, y: 80, width: 40, height: 50}, 400, 300, 1, 1);
    expect(padded.traced).to.deep.equal({x: 92, y: 72, width: 56, height: 66});
    expect(padded.inset).to.deep.equal({left: 8, top: 8, right: 8, bottom: 8});

    const onEdge = expandCropForDenoiseEdge(
        {x: 0, y: 40, width: 20, height: 20}, 100, 100, 1, 1);
    expect(onEdge.inset.left).to.equal(0);
    expect(onEdge.inset.top).to.equal(8);
    expect(onEdge.traced.x).to.equal(0);
    expect(onEdge.traced.y).to.equal(32);
  });

  test('keeps the full frame when the mask is empty', () => {
    const measured =
        measureTraceCoverage(new Uint8Array(4 * 4 * 4), 4, 4, 4, 4, 8);
    expect(measured.crop).to.equal(null);
    expect(measured.maskPixels).to.equal(0);
    expect(measured.tracedPixels).to.equal(16);
  });
});
