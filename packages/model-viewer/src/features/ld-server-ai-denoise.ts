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

import ModelViewerElementBase from '../model-viewer-base.js';
import {$scene} from '../model-viewer-base.js';
import {Constructor} from '../utilities.js';

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
  serverAIDenoise(options?: ServerAIDenoiseOptions): Promise<string>;
  pathTracerServerAIDenoise(options?: PathTracerServerAIDenoiseOptions):
      Promise<string>;
}

const DEFAULT_ENDPOINT =
    'https://ld-server-ai-denoise.fly.dev/api/server-ai-denoise';

const blobToDataURL = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
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

export const LDServerAIDenoiseMixin =
    <T extends Constructor<ModelViewerElementBase>>(ModelViewerElement: T) => {
      class LDServerAIDenoiseModelViewerElement extends ModelViewerElement {
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
            throw new Error(
                `Server AI denoise failed with status ${response.status}`);
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

        async pathTracerServerAIDenoise(
            {samples, signal, ...serverOptions}:
                PathTracerServerAIDenoiseOptions = {}): Promise<string> {
          const targetSamples = Math.max(
              1,
              Math.floor(
                  samples ??
                  Number(
                      (this as unknown as {pathTracerSamples?: number})
                          .pathTracerSamples ??
                      1)));
          const pathTracerHost =
              this as unknown as {pathTracerSamples?: number};
          if (Number(pathTracerHost.pathTracerSamples ?? 0) < targetSamples) {
            pathTracerHost.pathTracerSamples = targetSamples;
          }
          while (Number(
                     (this as unknown as {
                       pathTracerRenderedSamples?: number
                     }).pathTracerRenderedSamples ??
                     0) < targetSamples) {
            await waitFrame(signal);
          }

          return this.serverAIDenoise({
            ...serverOptions,
            signal,
          });
        }

        private async captureServerAIDenoiseImage({
          width,
          height,
        }: {width?: number, height?: number}): Promise<string> {
          const host = this as unknown as {
            pathTracer?: boolean,
            isPathTracerReady?: boolean,
            capturePathTracerFrame?: (options?: {fileType?: string}) =>
                                      Promise<{dataUrl: string}>,
            captureImage?: (options?: {
                          width?: number,
                          height?: number,
                          fileType?: string,
                        }) => Promise<string>,
          };
          // The server denoise needs the traced frame, not an offscreen raster.
          // Width and height are only used for the raster fallback.
          if (host.pathTracer === true && host.isPathTracerReady === true &&
              typeof host.capturePathTracerFrame === 'function') {
            const frame =
                await host.capturePathTracerFrame({fileType: 'image/png'});
            return frame.dataUrl;
          }

          const captureImage = host.captureImage;
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
      }

      return LDServerAIDenoiseModelViewerElement as
          Constructor<LDServerAIDenoiseInterface>&
          T;
    };
