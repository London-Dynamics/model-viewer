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

import {property} from 'lit/decorators.js';

import ModelViewerElementBase from '../model-viewer-base.js';
import {
  $container,
  $needsRender,
  $onResize,
  $scene,
  $updateSize,
} from '../model-viewer-base.js';
import {Constructor} from '../utilities.js';

export type PathTracerDenoiseMode = 'off'|'gpu'|'server-ai';

export interface ServerAIDenoiseOptions {
  endpoint?: string;
  image?: string;
  model?: string;
  options?: Record<string, unknown>;
  sceneDescription?: string;
  signal?: AbortSignal;
  width?: number;
  height?: number;
}

export interface PathTracerServerAIDenoiseOptions extends
    ServerAIDenoiseOptions {
  samples?: number;
}

export declare interface LDServerAIDenoiseInterface {
  pathTracerDenoiseMode: PathTracerDenoiseMode;
  serverAIDenoiseAspectRatio: string;
  readonly serverAIDenoiseResolvedAspectRatio: string;
  serverAIDenoise(options?: ServerAIDenoiseOptions): Promise<string>;
  pathTracerServerAIDenoise(
      options?: PathTracerServerAIDenoiseOptions): Promise<string>;
}

const DEFAULT_ENDPOINT =
    'https://ld-server-ai-denoise.fly.dev/api/server-ai-denoise';
const SUPPORTED_ASPECT_RATIOS = [
  ['1 / 1', 1],
  ['2 / 3', 2 / 3],
  ['3 / 2', 3 / 2],
  ['3 / 4', 3 / 4],
  ['4 / 3', 4 / 3],
  ['4 / 5', 4 / 5],
  ['5 / 4', 5 / 4],
  ['9 / 16', 9 / 16],
  ['16 / 9', 16 / 9],
  ['21 / 9', 21 / 9],
] as const;

const blobToDataURL = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

const parseAspectRatio = (value: string): number|null => {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(?:\/|:)\s*(\d+(?:\.\d+)?)$/);
  if (match == null) {
    return null;
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return null;
  }

  return width / height;
};

const closestSupportedAspectRatio = (width: number, height: number):
    typeof SUPPORTED_ASPECT_RATIOS[number] => {
  const ratio = Math.max(1, width) / Math.max(1, height);
  return SUPPORTED_ASPECT_RATIOS.reduce((best, candidate) => {
    return Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ?
      candidate :
      best;
  });
};

const supportedAspectRatio = (value: string):
    typeof SUPPORTED_ASPECT_RATIOS[number]|null => {
  const ratio = parseAspectRatio(value);
  if (ratio == null) {
    return null;
  }

  return SUPPORTED_ASPECT_RATIOS.find(
             (candidate) => Math.abs(candidate[1] - ratio) < 1e-6) ??
      null;
};

const constrainedSizeForAspectRatio = (
    width: number, height: number, aspectRatio: number) => {
  if (width / height > aspectRatio) {
    const constrainedWidth = Math.round(height * aspectRatio);
    return {
      width: constrainedWidth,
      height,
      offsetX: Math.round((width - constrainedWidth) / 2),
      offsetY: 0,
    };
  }

  const constrainedHeight = Math.round(width / aspectRatio);
  return {
    width,
    height: constrainedHeight,
    offsetX: 0,
    offsetY: Math.round((height - constrainedHeight) / 2),
  };
};

const waitFrame = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }

      requestAnimationFrame(() => {
        if (signal?.aborted) {
          reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          return;
        }
        resolve();
      });
    });

export const LDServerAIDenoiseMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
) => {
  class LDServerAIDenoiseModelViewerElement extends ModelViewerElement {
    @property({type: String, attribute: 'path-tracer-denoise-mode'})
    pathTracerDenoiseMode: PathTracerDenoiseMode = 'gpu';

    @property({type: String, attribute: 'server-ai-denoise-aspect-ratio'})
    serverAIDenoiseAspectRatio = '';

    get serverAIDenoiseResolvedAspectRatio() {
      return this.resolveServerAIDenoiseAspectRatio()[0];
    }

    async serverAIDenoise({
      endpoint = DEFAULT_ENDPOINT,
      image,
      model,
      options = {},
      sceneDescription,
      signal,
      width,
      height,
    }: ServerAIDenoiseOptions = {}): Promise<string> {
      const denoiseImage = image ?? await this.captureServerAIDenoiseImage({
        width,
        height,
      });
      const body: {
        image: string;
        model?: string;
        options?: Record<string, unknown>;
        sceneDescription?: string;
      } = {
        image: denoiseImage,
        options,
      };
      if (model != null) {
        body.model = model;
      }
      if (sceneDescription != null) {
        body.sceneDescription = sceneDescription;
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        throw new Error(`Server AI denoise failed with status ${response.status}`);
      }

      const result = await response.json();
      if (typeof result.imageUrl === 'string') {
        return result.imageUrl;
      }
      if (typeof result.imageBase64 === 'string') {
        return result.imageBase64;
      }

      throw new Error('Server AI denoise did not return an image');
    }

    async pathTracerServerAIDenoise({
      samples,
      signal,
      ...serverOptions
    }: PathTracerServerAIDenoiseOptions = {}): Promise<string> {
      const targetSamples = Math.max(
          1,
          Math.floor(samples ??
              Number((this as unknown as {pathTracerSamples?: number})
                         .pathTracerSamples ?? 1)));
      const pathTracerHost =
          this as unknown as {pathTracerSamples?: number};
      if (Number(pathTracerHost.pathTracerSamples ?? 0) < targetSamples) {
        pathTracerHost.pathTracerSamples = targetSamples;
      }
      while (Number((this as unknown as {pathTracerRenderedSamples?: number})
                        .pathTracerRenderedSamples ?? 0) < targetSamples) {
        await waitFrame(signal);
      }

      return this.serverAIDenoise({
        ...serverOptions,
        signal,
      });
    }

    override updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);

      if (changedProperties.has('pathTracerDenoiseMode')) {
        (this as unknown as {pathTracerDenoise?: boolean}).pathTracerDenoise =
            this.pathTracerDenoiseMode === 'gpu';
      }

      if (changedProperties.has('pathTracerDenoiseMode') ||
          changedProperties.has('serverAIDenoiseAspectRatio')) {
        this[$updateSize](this.getBoundingClientRect());
        (this as any)[$needsRender]();
      }
    }

    override[$updateSize]({width, height}: {width: number, height: number}) {
      if (width === 0 || height === 0) {
        return;
      }

      const active = this.pathTracerDenoiseMode === 'server-ai';
      const [, aspectRatio] = this.resolveServerAIDenoiseAspectRatio(width, height);
      const size = active ?
        constrainedSizeForAspectRatio(width, height, aspectRatio) :
        {width, height, offsetX: 0, offsetY: 0};

      this[$container].style.width = `${size.width}px`;
      this[$container].style.height = `${size.height}px`;
      this[$container].style.left = active ? `${size.offsetX}px` : '';
      this[$container].style.top = active ? `${size.offsetY}px` : '';

      this[$onResize]({width: size.width, height: size.height});
    }

    private async captureServerAIDenoiseImage({
      width,
      height,
    }: {width?: number, height?: number}): Promise<string> {
      const captureImage =
          (this as unknown as {
            captureImage?: (options?: {
              width?: number,
              height?: number,
              fileType?: string,
            }) => Promise<string>
          }).captureImage;
      if (typeof captureImage === 'function') {
        const dpr = window.devicePixelRatio || 1;
        return captureImage.call(this, {
          width: width ?? Math.round(this[$scene].width * dpr),
          height: height ?? Math.round(this[$scene].height * dpr),
          fileType: 'image/png',
        });
      }

      const blob = await this.toBlob({mimeType: 'image/png'});
      return blobToDataURL(blob);
    }

    private resolveServerAIDenoiseAspectRatio(width = this[$scene].width,
                                              height = this[$scene].height) {
      if (this.serverAIDenoiseAspectRatio.trim() !== '') {
        const supported = supportedAspectRatio(this.serverAIDenoiseAspectRatio);
        if (supported != null) {
          return supported;
        }
      }

      return closestSupportedAspectRatio(width, height);
    }
  }

  return LDServerAIDenoiseModelViewerElement as Constructor<
      LDServerAIDenoiseInterface> &
      T;
};
