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

// Grow the subject enough for the denoiser and for light that spills past
// the geometric edge. The floor already carries contact shadows.
export const COVERAGE_MARGIN_FRACTION = 0.02;
export const COVERAGE_MIN_MARGIN_PIXELS = 48;
const COVERAGE_FULL_FRAME_RATIO = 0.92;
const COVERAGE_LIT_THRESHOLD = 16;

// OIDN's image edge has no tile overlap, so the first couple of rows come
// back dark. Trace this many pixels past the crop and leave them unshown.
export const DENOISE_EDGE_PIXELS = 8;

export interface TraceCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TraceCropInset {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TraceCoverageMeasure {
  // Null means the crop is the whole frame, so the tracer should not resize.
  crop: TraceCrop|null;
  maskPixels: number;
  tracedPixels: number;
  fullPixels: number;
}

export const coverageMarginPixels =
    (fullWidth: number, fullHeight: number): number => {
      const shortSide = Math.max(1, Math.min(fullWidth, fullHeight));
      return Math.max(
          COVERAGE_MIN_MARGIN_PIXELS,
          Math.round(shortSide * COVERAGE_MARGIN_FRACTION));
    };

/**
 * `rgba` is a WebGL readback: row 0 is the bottom of the image. The returned
 * crop is top-left, in the full-resolution pixel grid.
 */
export const measureTraceCoverage = (
    rgba: Uint8Array|Uint8ClampedArray,
    maskWidth: number,
    maskHeight: number,
    fullWidth: number,
    fullHeight: number,
    marginPixels: number,
    ): TraceCoverageMeasure => {
  const fullPixels = Math.max(0, fullWidth) * Math.max(0, fullHeight);
  const empty: TraceCoverageMeasure = {
    crop: null,
    maskPixels: 0,
    tracedPixels: fullPixels,
    fullPixels,
  };
  if (maskWidth < 1 || maskHeight < 1 || fullWidth < 1 || fullHeight < 1) {
    return empty;
  }

  const mask = new Uint8Array(maskWidth * maskHeight);
  let maskPixels = 0;
  for (let y = 0; y < maskHeight; y++) {
    const sourceRow = (maskHeight - 1 - y) * maskWidth;
    for (let x = 0; x < maskWidth; x++) {
      if (rgba[(sourceRow + x) * 4] > COVERAGE_LIT_THRESHOLD) {
        mask[y * maskWidth + x] = 1;
        maskPixels++;
      }
    }
  }
  if (maskPixels === 0) {
    return empty;
  }

  const radius =
      Math.max(0, Math.ceil(marginPixels * maskWidth / Math.max(1, fullWidth)));
  const dilated = dilate(mask, maskWidth, maskHeight, radius);
  let minX = maskWidth;
  let minY = maskHeight;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < maskHeight; y++) {
    for (let x = 0; x < maskWidth; x++) {
      if (dilated[y * maskWidth + x] === 0) {
        continue;
      }
      if (x < minX)
        minX = x;
      if (y < minY)
        minY = y;
      if (x > maxX)
        maxX = x;
      if (y > maxY)
        maxY = y;
    }
  }

  const scaleX = fullWidth / maskWidth;
  const scaleY = fullHeight / maskHeight;
  const x = clamp(Math.floor(minX * scaleX), 0, fullWidth - 1);
  const y = clamp(Math.floor(minY * scaleY), 0, fullHeight - 1);
  const right = clamp(Math.ceil((maxX + 1) * scaleX), x + 1, fullWidth);
  const bottom = clamp(Math.ceil((maxY + 1) * scaleY), y + 1, fullHeight);
  const crop = {x, y, width: right - x, height: bottom - y};
  const tracedPixels = crop.width * crop.height;
  if (tracedPixels >= fullPixels * COVERAGE_FULL_FRAME_RATIO) {
    return {crop: null, maskPixels, tracedPixels: fullPixels, fullPixels};
  }
  return {crop, maskPixels, tracedPixels, fullPixels};
};

/**
 * Grows `crop` by enough trace pixels for the denoiser fringe to fall
 * outside the visible rect. Sides already on the frame stay put.
 * `scaleX` and `scaleY` are trace pixels per full-frame pixel.
 */
export const expandCropForDenoiseEdge = (
    crop: TraceCrop,
    fullWidth: number,
    fullHeight: number,
    scaleX: number,
    scaleY: number,
    ): {traced: TraceCrop, inset: TraceCropInset} => {
  const padX = Math.ceil(DENOISE_EDGE_PIXELS / Math.max(scaleX, 1e-6));
  const padY = Math.ceil(DENOISE_EDGE_PIXELS / Math.max(scaleY, 1e-6));
  const x = clamp(crop.x - padX, 0, Math.max(0, fullWidth - 1));
  const y = clamp(crop.y - padY, 0, Math.max(0, fullHeight - 1));
  const right = clamp(crop.x + crop.width + padX, x + 1, fullWidth);
  const bottom = clamp(crop.y + crop.height + padY, y + 1, fullHeight);
  return {
    traced: {x, y, width: right - x, height: bottom - y},
    inset: {
      left: crop.x - x,
      top: crop.y - y,
      right: right - (crop.x + crop.width),
      bottom: bottom - (crop.y + crop.height),
    },
  };
};

const dilate = (
    mask: Uint8Array,
    width: number,
    height: number,
    radius: number,
    ): Uint8Array => {
  if (radius <= 0) {
    return mask;
  }
  const horizontal = new Uint8Array(mask.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const start = Math.max(0, x - radius);
      const end = Math.min(width - 1, x + radius);
      for (let i = start; i <= end; i++) {
        if (mask[row + i] !== 0) {
          horizontal[row + x] = 1;
          break;
        }
      }
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const start = Math.max(0, y - radius);
      const end = Math.min(height - 1, y + radius);
      for (let i = start; i <= end; i++) {
        if (horizontal[i * width + x] !== 0) {
          out[y * width + x] = 1;
          break;
        }
      }
    }
  }
  return out;
};

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));
