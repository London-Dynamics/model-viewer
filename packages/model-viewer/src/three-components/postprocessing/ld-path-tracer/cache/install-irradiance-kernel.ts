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

import {StorageBufferAttribute} from 'three/webgpu';

import {LDIrradianceCacheLogicKernel} from './LDIrradianceCacheLogicKernel.js';
import {LDIrradianceCacheMaterialKernel} from './LDIrradianceCacheMaterialKernel.js';
import {IRRADIANCE_PATH_RECORDS, IRRADIANCE_PATH_SLOTS, IRRADIANCE_SLOT_COUNT} from './path-tracer-irradiance-cache.js';

interface CacheKernel {
  bvhData: unknown;
  material: unknown;
  filterGlossy: number;
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
  peer?: {cacheWrite: number};
}

interface LogicKernelHandle {
  envInfo: unknown;
  backgroundInfo: unknown;
  lightsInfo: unknown;
  misEnabled: number;
  maxBounces: number;
  clampDirect: number;
  clampIndirect: number;
  transmissiveBackground: number;
  cacheWrite: number;
}

interface WavefrontBackend {
  materialKernel?: CacheKernel;
  logicKernel?: LogicKernelHandle;
  rebuild: () => void;
}

export interface IrradianceKernelTracer {
  useMegakernel: (enabled: boolean) => void;
  _pathTracer: WavefrontBackend;
  _renderer?: {
    getArrayBufferAsync?: (attribute: unknown) => Promise<ArrayBuffer>,
  };
  _ldIrradianceKernel?: CacheKernel|null;
  _ldStockMaterialKernel?: CacheKernel|null;
  _ldStockLogicKernel?: LogicKernelHandle|null;
}

export interface IrradianceKernelUpload {
  grid: Float32Array;
  origin: [number, number, number];
  cellSize: number;
  minSamples: number;
  read: boolean;
  write: boolean;
}

/**
 * The stock wavefront material kernel has no world-space cache. While the
 * irradiance cache is on, that one kernel is swapped for a copy that reads
 * the grid on diffuse primary hits and ends those paths. The rest of the
 * wavefront pipeline stays in place. The grid is not updated from here.
 */
export const installIrradianceKernel =
    (tracer: IrradianceKernelTracer): CacheKernel => {
      const installed = tracer._ldIrradianceKernel;
      if (installed != null &&
          tracer._pathTracer.materialKernel === installed) {
        return installed;
      }
      if (tracer._pathTracer.materialKernel == null) {
        tracer.useMegakernel(false);
      }
      const stock = tracer._pathTracer.materialKernel;
      if (stock == null) {
        throw new Error(
            'Path tracer irradiance cache needs the wavefront backend.');
      }
      const cacheAttribute =
          new StorageBufferAttribute(IRRADIANCE_SLOT_COUNT * 2, 4);
      const pathRecords = new StorageBufferAttribute(
          IRRADIANCE_PATH_SLOTS * IRRADIANCE_PATH_RECORDS, 4);
      const next = new LDIrradianceCacheMaterialKernel(
                       cacheAttribute, pathRecords) as CacheKernel;
      next.bvhData = stock.bvhData;
      next.material = stock.material;
      next.filterGlossy = stock.filterGlossy;
      next.maxBounces = stock.maxBounces;
      next.maxTransparentBounces = stock.maxTransparentBounces;
      next.maxSamples = stock.maxSamples;
      next.seed = stock.seed;
      const stockLogic = tracer._pathTracer.logicKernel;
      if (stockLogic != null) {
        const logic = new LDIrradianceCacheLogicKernel(
            cacheAttribute, pathRecords) as LogicKernelHandle;
        logic.envInfo = stockLogic.envInfo;
        logic.backgroundInfo = stockLogic.backgroundInfo;
        logic.lightsInfo = stockLogic.lightsInfo;
        logic.misEnabled = stockLogic.misEnabled;
        logic.maxBounces = stockLogic.maxBounces;
        logic.clampDirect = stockLogic.clampDirect;
        logic.clampIndirect = stockLogic.clampIndirect;
        logic.transmissiveBackground = stockLogic.transmissiveBackground;
        next.peer = logic;
        if (tracer._ldStockLogicKernel == null) {
          tracer._ldStockLogicKernel = stockLogic;
        }
        tracer._pathTracer.logicKernel = logic;
      }
      if (tracer._ldStockMaterialKernel == null ||
          tracer._ldStockMaterialKernel === installed) {
        tracer._ldStockMaterialKernel = stock;
      }
      tracer._pathTracer.materialKernel = next;
      tracer._pathTracer.rebuild();
      tracer._ldIrradianceKernel = next;
      return next;
    };

export const uninstallIrradianceKernel =
    (tracer: IrradianceKernelTracer): void => {
      if (tracer._ldIrradianceKernel == null) {
        return;
      }
      const stock = tracer._ldStockMaterialKernel;
      const stockLogic = tracer._ldStockLogicKernel;
      tracer._ldIrradianceKernel = null;
      tracer._ldStockMaterialKernel = null;
      tracer._ldStockLogicKernel = null;
      if (stock != null && tracer._pathTracer.materialKernel != null) {
        tracer._pathTracer.materialKernel = stock;
      }
      if (stockLogic != null && tracer._pathTracer.logicKernel != null) {
        tracer._pathTracer.logicKernel = stockLogic;
      }
      tracer._pathTracer.rebuild();
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
  if (kernel.peer != null) {
    kernel.peer.cacheWrite = kernel.cacheWrite;
  }
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
