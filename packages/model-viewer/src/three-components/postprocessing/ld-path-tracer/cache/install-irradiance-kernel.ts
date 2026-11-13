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

import {LDIrradianceCacheMegaKernel} from './LDIrradianceCacheMegaKernel.js';

interface CacheKernel {
  envInfo: unknown;
  backgroundInfo: unknown;
  lightsInfo: unknown;
  bvhData: unknown;
  material: unknown;
  misEnabled: number;
  filterGlossy: number;
  clampDirect: number;
  clampIndirect: number;
  transmissiveBackground: number;
  textures: unknown;
  textureSampler: unknown;
  maxBounces: number;
  maxTransparentBounces: number;
  maxSamples: number;
  seed: number;
  cacheRead: number;
  cacheWrite: number;
  cacheOrigin: {set: (x: number, y: number, z: number) => void};
  cacheCellSize: number;
  cacheMinSamples: number;
  cacheAttribute: {array: Float32Array; needsUpdate: boolean;};
  dispose: () => void;
}

interface MegaKernelBackend {
  kernel: CacheKernel;
  rebuild: () => void;
}

export interface IrradianceKernelTracer {
  useMegakernel: (enabled: boolean) => void;
  _pathTracer: MegaKernelBackend;
  _renderer?: {
    getArrayBufferAsync?: (attribute: unknown) => Promise<ArrayBuffer>,
  };
  _ldIrradianceKernel?: CacheKernel|null;
}

export interface IrradianceKernelUpload {
  grid: Float32Array;
  origin: [number, number, number];
  cellSize: number;
  minSamples: number;
  read: boolean;
  write: boolean;
}

const isCacheKernel = (kernel: CacheKernel): boolean =>
    kernel.cacheAttribute != null && typeof kernel.cacheRead === 'number';

/**
 * The stock tracer's wavefront backend has no extension point for a
 * world-space cache. While the irradiance cache is on we switch to the
 * megakernel and replace that one kernel with the patched copy. Turning the
 * cache off restores the wavefront backend.
 */
export const installIrradianceKernel =
    (tracer: IrradianceKernelTracer): CacheKernel => {
      const current = tracer._pathTracer.kernel;
      if (tracer._ldIrradianceKernel != null &&
          tracer._pathTracer.kernel === tracer._ldIrradianceKernel) {
        return tracer._ldIrradianceKernel;
      }
      if (!isCacheKernel(current)) {
        tracer.useMegakernel(true);
      }
      const stock = tracer._pathTracer.kernel;
      const next = new LDIrradianceCacheMegaKernel() as CacheKernel;
      next.envInfo = stock.envInfo;
      next.backgroundInfo = stock.backgroundInfo;
      next.lightsInfo = stock.lightsInfo;
      next.bvhData = stock.bvhData;
      next.material = stock.material;
      next.misEnabled = stock.misEnabled;
      next.filterGlossy = stock.filterGlossy;
      next.clampDirect = stock.clampDirect;
      next.clampIndirect = stock.clampIndirect;
      next.transmissiveBackground = stock.transmissiveBackground;
      next.textures = stock.textures;
      next.textureSampler = stock.textureSampler;
      next.maxBounces = stock.maxBounces;
      next.maxTransparentBounces = stock.maxTransparentBounces;
      next.maxSamples = stock.maxSamples;
      next.seed = stock.seed;
      stock.dispose();
      tracer._pathTracer.kernel = next;
      tracer._pathTracer.rebuild();
      tracer._ldIrradianceKernel = next;
      return next;
    };

export const uninstallIrradianceKernel =
    (tracer: IrradianceKernelTracer): void => {
      if (tracer._ldIrradianceKernel == null) {
        return;
      }
      tracer._ldIrradianceKernel = null;
      tracer.useMegakernel(false);
    };

export const uploadIrradianceKernel = (
    kernel: CacheKernel,
    upload: IrradianceKernelUpload,
    ): void => {
  const array = kernel.cacheAttribute.array;
  const length = Math.min(array.length, upload.grid.length);
  array.fill(0);
  array.set(upload.grid.subarray(0, length));
  kernel.cacheAttribute.needsUpdate = true;
  kernel.cacheOrigin.set(upload.origin[0], upload.origin[1], upload.origin[2]);
  kernel.cacheCellSize = upload.cellSize;
  kernel.cacheMinSamples = upload.minSamples;
  kernel.cacheRead = upload.read ? 1 : 0;
  kernel.cacheWrite = upload.write ? 1 : 0;
};

export const downloadIrradianceKernel = async(
    tracer: IrradianceKernelTracer,
    kernel: CacheKernel,
    ): Promise<Float32Array|null> => {
  const read = tracer._renderer?.getArrayBufferAsync;
  if (read == null) {
    return new Float32Array(kernel.cacheAttribute.array);
  }
  const buffer = await read.call(tracer._renderer, kernel.cacheAttribute);
  return new Float32Array(buffer);
};
