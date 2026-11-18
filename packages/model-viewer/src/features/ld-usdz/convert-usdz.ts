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

import type {Group, Material, Mesh, Object3D} from 'three';

import type {GLTFExporter} from 'three/examples/jsm/exporters/GLTFExporter.js';
import type {USDLoader} from 'three/examples/jsm/loaders/USDLoader.js';

/**
 * Stage up axis. `Z` is rotated onto three.js Y-up. Scan apps usually write
 * `Y` or `Z` together with meters.
 */
export type UsdzUpAxis = 'Y'|'Z';

export interface ConvertUsdzToGlbOptions {
  /**
   * Meters per USD unit. When omitted, the stage value is kept, and a stage
   * that does not set `metersPerUnit` is treated as meters (1). When set,
   * this replaces the stage scale on the root.
   */
  metersPerUnit?: number;
  /**
   * Replaces the stage up-axis correction. When omitted, the file's `upAxis`
   * is used (Z-up becomes Y-up).
   */
  upAxis?: UsdzUpAxis;
}

interface UsdRuntime {
  USDLoader: typeof USDLoader;
  GLTFExporter: typeof GLTFExporter;
}

const GLB_MIME = 'model/gltf-binary';
const GLB_MAGIC = 0x46546c67;
const Z_UP_ROTATION_X = -Math.PI / 2;

const looksLikeUsd = (bytes: ArrayBuffer): boolean => {
  const view = new Uint8Array(bytes);
  if (view.length >= 2 && view[0] === 0x50 && view[1] === 0x4b) {
    return true;
  }
  if (view.length >= 8 &&
      String.fromCharCode(
          view[0],
          view[1],
          view[2],
          view[3],
          view[4],
          view[5],
          view[6],
          view[7]) === 'PXR-USDC') {
    return true;
  }
  const sample =
      new TextDecoder().decode(view.subarray(0, Math.min(view.length, 512)));
  return sample.includes('#usda') || /\bdef\s/.test(sample);
};

/**
 * USDLoader and GLTFExporter are imported on first use so the main
 * model-viewer graph does not include the USD parsers. This function is the
 * worker seam: it takes bytes and returns a GLB blob and does not touch
 * `<model-viewer>`. It runs on the caller thread. Texture decode uses
 * `Image`, which today means a window (or a worker that can decode images).
 * A later worker can import this module and call `convertUsdzToGlb` once
 * that decode path exists; there is no second implementation to keep in sync.
 */
let runtimePromise: Promise<UsdRuntime>|null = null;

const loadRuntime = (): Promise<UsdRuntime> => {
  if (runtimePromise == null) {
    runtimePromise =
        Promise
            .all([
              import('three/examples/jsm/loaders/USDLoader.js'),
              import('three/examples/jsm/exporters/GLTFExporter.js'),
            ])
            .then(([usd, gltf]) => ({
                    USDLoader: usd.USDLoader,
                    GLTFExporter: gltf.GLTFExporter,
                  }))
            .catch((error: unknown) => {
              runtimePromise = null;
              throw error;
            });
  }
  return runtimePromise;
};

const assertOptions = (options: ConvertUsdzToGlbOptions) => {
  const {metersPerUnit, upAxis} = options;
  if (metersPerUnit != null &&
      (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0)) {
    throw new Error(
        'metersPerUnit must be a positive number of meters per USD unit');
  }
  if (upAxis != null && upAxis !== 'Y' && upAxis !== 'Z') {
    throw new Error(`upAxis must be Y or Z, got "${String(upAxis)}"`);
  }
};

const toArrayBuffer = async(input: Blob|ArrayBuffer): Promise<ArrayBuffer> => {
  const buffer =
      input instanceof ArrayBuffer ? input.slice(0) : await input.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error('USDZ file is empty');
  }
  return buffer;
};

const parseUsd = (loader: USDLoader, data: ArrayBuffer): Promise<Group> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const finish = (group: Group) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(group);
      };
      const fail = (error: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      try {
        loader.parse(data, '', finish, fail);
      } catch (error) {
        fail(error);
      }
    });

/**
 * The loader writes the up-axis fix only as the root X rotation, and the
 * unit scale only as the root scale. Overrides replace those, they do not
 * multiply an extra node.
 */
const applyUsdzOptions = (group: Group, options: ConvertUsdzToGlbOptions) => {
  if (options.metersPerUnit != null) {
    group.scale.setScalar(options.metersPerUnit);
  }
  if (options.upAxis === 'Y') {
    group.rotation.x = 0;
  } else if (options.upAxis === 'Z') {
    group.rotation.x = Z_UP_ROTATION_X;
  }
};

const disposeUsdRoot = (root: Object3D) => {
  const materials = new Set<Material>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      for (const entry of material) {
        materials.add(entry);
      }
    } else if (material != null) {
      materials.add(material);
    }
  });
  for (const material of materials) {
    material.dispose();
  }
};

/**
 * Convert a USDZ package (or a bare USDA/USDC buffer) to a binary glTF blob.
 * Runs on the caller thread. See the module comment for the worker seam.
 */
export const convertUsdzToGlb = async(
    input: Blob|ArrayBuffer,
    options: ConvertUsdzToGlbOptions = {}): Promise<Blob> => {
  assertOptions(options);
  const bytes = await toArrayBuffer(input);
  if (!looksLikeUsd(bytes)) {
    throw new Error('Not a USDZ, USDA, or USDC file');
  }
  const {USDLoader, GLTFExporter} = await loadRuntime();
  const loader = new USDLoader();
  const group = await parseUsd(loader, bytes);
  try {
    applyUsdzOptions(group, options);
    const exporter = new GLTFExporter();
    const exported = await exporter.parseAsync(group, {
      binary: true,
      onlyVisible: true,
      animations: group.animations,
    });
    if (!(exported instanceof ArrayBuffer) || exported.byteLength < 12 ||
        new DataView(exported).getUint32(0, true) !== GLB_MAGIC) {
      throw new Error('GLB export did not return a binary glTF');
    }
    return new Blob([exported], {type: GLB_MIME});
  } finally {
    disposeUsdRoot(group);
  }
};
