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

import {Box3, BufferAttribute, BufferGeometry} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

const WORKER_FILE = 'path-tracer-bvh.worker.js';

export const pathTracerBvhWorkerScriptUrl = (): URL =>
    new URL(WORKER_FILE, import.meta.url);

export const isCrossOriginScript = (url: URL): boolean =>
    url.origin !== self.location.origin;

/**
 * Same-origin scripts are started directly. A classic Worker cannot load a
 * cross-origin script, so those are fetched (the host must send
 * Access-Control-Allow-Origin) and started from a blob URL.
 */
export const openPathTracerBvhWorker = async(
    url: URL = pathTracerBvhWorkerScriptUrl(),
    fetchImpl: typeof fetch = fetch,
    ): Promise<Worker> => {
  if (!isCrossOriginScript(url)) {
    return new Worker(url);
  }

  let response: Response;
  try {
    response = await fetchImpl(url.href, {mode: 'cors', credentials: 'omit'});
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
        `Path tracer BVH worker ${url.href} could not be fetched (${
            reason}). ` +
        'A cross-origin worker script needs Access-Control-Allow-Origin.');
  }
  if (!response.ok) {
    throw new Error(
        `Path tracer BVH worker ${url.href} responded with ${
            response.status}. ` +
        'A cross-origin worker script needs Access-Control-Allow-Origin.');
  }
  const source = await response.text();
  const blobUrl =
      URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
  return new Worker(blobUrl);
};

interface BVHWorkerResponse {
  error?: string|null;
  serialized?: {
    index?: ArrayLike<number>|null; roots: ArrayBuffer[];
    indirectBuffer?: ArrayBuffer | null;
  }|null;
  position?: ArrayBufferView|null;
  progress?: number;
}

export interface PathTracerBVHGenerator {
  generate(geometry: BufferGeometry, options?: object): Promise<MeshBVH>;
  dispose(): void;
}

/**
 * One GenerateMeshBVHWorker-compatible job runner. The worker script is the
 * bundled three-mesh-bvh builder emitted beside this module (lib) and beside
 * the rollup bundles (dist). A single worker avoids ParallelMeshBVHWorker,
 * which needs cross-origin isolation.
 */
export class PathTracerBVHWorker implements PathTracerBVHGenerator {
  private worker: Worker|null = null;
  private running = false;

  constructor(worker?: Worker) {
    if (worker != null) {
      this.worker = worker;
      return;
    }
    const url = pathTracerBvhWorkerScriptUrl();
    if (isCrossOriginScript(url)) {
      throw new Error(
          `Path tracer BVH worker ${url.href} is cross-origin. ` +
          'Fetch it before constructing a Worker.');
    }
    this.worker = new Worker(url);
  }

  static async open(): Promise<PathTracerBVHWorker> {
    const worker = await openPathTracerBvhWorker();
    return new PathTracerBVHWorker(worker);
  }

  generate(geometry: BufferGeometry, options: Record<string, unknown> = {}) {
    if (this.running) {
      return Promise.reject(
          new Error('Path tracer BVH worker is already running a job.'));
    }
    if (this.worker == null) {
      return Promise.reject(
          new Error('Path tracer BVH worker has been disposed.'));
    }

    this.running = true;
    const promise = this.runTask(this.worker, geometry, options);
    promise.finally(() => {
      this.running = false;
    });
    return promise;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
  }

  private runTask(
      worker: Worker, geometry: BufferGeometry,
      options: Record<string, unknown>): Promise<MeshBVH> {
    return new Promise((resolve, reject) => {
      const positionAttribute = geometry.getAttribute('position');
      if (positionAttribute == null) {
        reject(
            new Error('Path tracer BVH worker requires a position attribute.'));
        return;
      }
      if ((positionAttribute as {
            isInterleavedBufferAttribute?: boolean
          }).isInterleavedBufferAttribute ||
          (geometry.index != null && (geometry.index as {
                                       isInterleavedBufferAttribute?: boolean
                                     }).isInterleavedBufferAttribute)) {
        reject(new Error(
            'Path tracer BVH worker does not support interleaved attributes.'));
        return;
      }

      worker.onerror = (event) => {
        reject(new Error(
            `Path tracer BVH worker: ${event.message || 'unknown error'}`));
      };
      worker.onmessage = (event: MessageEvent<BVHWorkerResponse>) => {
        const data = event.data;
        if (data == null) {
          return;
        }
        if (data.error) {
          reject(new Error(data.error));
          worker.onmessage = null;
          return;
        }
        if (data.serialized) {
          const {serialized, position} = data;
          const bvh = MeshBVH.deserialize(
              serialized as never, geometry, {setIndex: false});
          const boundsOptions = {
            setBoundingBox: true,
            ...options,
          } as {setBoundingBox?: boolean};
          const positionAttribute =
              geometry.attributes.position as {array: ArrayBufferView};
          if (position != null) {
            positionAttribute.array = position;
          }
          if (serialized.index) {
            if (geometry.index) {
              (geometry.index as {array: ArrayLike<number>}).array =
                  serialized.index;
            } else {
              geometry.setIndex(new BufferAttribute(
                  serialized.index as unknown as
                      ConstructorParameters<typeof BufferAttribute>[0],
                  1,
                  false));
            }
          }
          if (boundsOptions.setBoundingBox !== false) {
            geometry.boundingBox = bvh.getBoundingBox(new Box3());
          }
          const onProgress = options.onProgress;
          if (typeof onProgress === 'function') {
            onProgress(data.progress);
          }
          resolve(bvh);
          worker.onmessage = null;
          return;
        }
        const onProgress = options.onProgress;
        if (typeof onProgress === 'function') {
          onProgress(data.progress);
        }
      };

      const index = geometry.index ? geometry.index.array : null;
      const position = geometry.attributes.position.array;
      const transferable = [position];
      if (index) {
        transferable.push(index);
      }
      worker.postMessage(
          {
            index,
            position,
            options: {
              ...options,
              onProgress: null,
              includedProgressCallback:
                  typeof options.onProgress === 'function',
              groups: [...geometry.groups],
            },
          },
          transferable.map((array) => array.buffer)
              .filter(
                  (buffer) => typeof SharedArrayBuffer === 'undefined' ||
                      !(buffer instanceof SharedArrayBuffer)));
    });
  }
}
