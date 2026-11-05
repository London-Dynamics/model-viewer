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

/**
 * `path-tracer-render-scale` stays a 0.1–1 fraction of the drawing buffer.
 * Supersampling uses `path-tracer-pixel-ratio` so a 1x screen can trace at
 * 2x without the host dividing by devicePixelRatio, and so values at or
 * below the screen pixel ratio leave the existing buffer unchanged.
 */
export const MIN_PATH_TRACER_RENDER_SCALE = 0.1;
export const MAX_PATH_TRACER_RENDER_SCALE = 1;
export const MAX_PATH_TRACER_PIXEL_RATIO = 4;

export interface PathTracerScaleInput {
  renderScale: number;
  pixelRatio: number;
  devicePixelRatio: number;
  drawingBufferWidth: number;
  drawingBufferHeight: number;
  maxTextureSize: number;
}

export interface PathTracerScaleResult {
  renderScale: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));

/**
 * Traced size is `drawingBuffer * renderScale`, where `renderScale` is the
 * quality scale times `max(devicePixelRatio, pixelRatio) / devicePixelRatio`.
 * `pixelRatio <= 0` means "use the screen pixel ratio". The result is clamped
 * so neither edge exceeds `maxTextureSize`. Width and height use the same
 * `Math.floor(scale * buffer)` rule as three-gpu-pathtracer.
 */
export const resolvePathTracerRenderScale =
    (input: PathTracerScaleInput): PathTracerScaleResult => {
      const devicePixelRatio = Number.isFinite(input.devicePixelRatio) &&
              input.devicePixelRatio > 0 ?
          input.devicePixelRatio :
          1;
      const requestedPixelRatio =
          Number.isFinite(input.pixelRatio) && input.pixelRatio > 0 ?
          Math.min(MAX_PATH_TRACER_PIXEL_RATIO, input.pixelRatio) :
          0;
      const quality = clamp(
          Number.isFinite(input.renderScale) ? input.renderScale :
                                               MAX_PATH_TRACER_RENDER_SCALE,
          MIN_PATH_TRACER_RENDER_SCALE,
          MAX_PATH_TRACER_RENDER_SCALE);
      let scale = quality *
          (Math.max(devicePixelRatio, requestedPixelRatio) / devicePixelRatio);

      const drawingWidth = Number.isFinite(input.drawingBufferWidth) ?
          Math.max(0, input.drawingBufferWidth) :
          0;
      const drawingHeight = Number.isFinite(input.drawingBufferHeight) ?
          Math.max(0, input.drawingBufferHeight) :
          0;
      const maxTextureSize =
          Number.isFinite(input.maxTextureSize) && input.maxTextureSize > 0 ?
          input.maxTextureSize :
          Infinity;

      if (drawingWidth <= 0 || drawingHeight <= 0) {
        return {renderScale: scale, width: 0, height: 0};
      }

      let width = Math.floor(scale * drawingWidth);
      let height = Math.floor(scale * drawingHeight);
      if (width > maxTextureSize || height > maxTextureSize) {
        const fit = Math.min(maxTextureSize / width, maxTextureSize / height);
        scale *= fit;
        width = Math.floor(scale * drawingWidth);
        height = Math.floor(scale * drawingHeight);
      }

      return {renderScale: scale, width, height};
    };
