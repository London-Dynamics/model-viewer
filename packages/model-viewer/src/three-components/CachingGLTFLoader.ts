/* @license
 * Copyright 2019 Google LLC. All Rights Reserved.
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

import {EventDispatcher, Material, Mesh, Object3D, Texture, WebGLRenderer} from 'three';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {DRACOLoader} from 'three/examples/jsm/loaders/DRACOLoader.js';
import {GLTF, GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {KTX2Loader} from 'three/examples/jsm/loaders/KTX2Loader.js';

import ModelViewerElementBase from '../model-viewer-base.js';
import {CacheEvictionPolicy} from '../utilities/cache-eviction-policy.js';

import GLTFMaterialsVariantsExtension from './gltf-instance/VariantMaterialLoaderPlugin.js';
import {GLTFInstance, GLTFInstanceConstructor} from './GLTFInstance.js';
import {collectLoadIssues, hasLoadErrors, ModelLoadError, toModelLoadError} from './load-issues.js';

export type ProgressCallback = (progress: number) => void;

/**
 * GLTFLoader that validates the raw file before parsing, so failures such as
 * an empty response are reported as structured issues instead of opaque
 * RangeErrors.
 */
export class DiagnosingGLTFLoader extends GLTFLoader {
  parse(
      data: ArrayBuffer|string, path: string, onLoad: (gltf: GLTF) => void,
      onError?: (error: any) => void) {
    const issues = collectLoadIssues({
      data,
      hasMeshoptDecoder: (this as any).meshoptDecoder != null,
    });
    if (hasLoadErrors(issues)) {
      const error = new ModelLoadError(issues);
      if (onError) {
        onError(error);
      } else {
        console.error(error);
      }
      return;
    }
    super.parse(data, path, onLoad, onError);
  }
}

(Texture as any).DEFAULT_ANISOTROPY = 4;

/**
 * A helper to Promise-ify a Three.js GLTFLoader
 */
export const loadWithLoader =
    (url: string,
     loader: GLTFLoader,
     progressCallback: ProgressCallback = () => {}) => {
      const onProgress = (event: ProgressEvent) => {
        const fraction = event.loaded / event.total;
        progressCallback!
            (Math.max(0, Math.min(1, isFinite(fraction) ? fraction : 1)));
      };
      return new Promise<GLTF>((resolve, reject) => {
        loader.load(url, resolve, onProgress, reject);
      });
    };

/** Helper to load a script tag. */
const fetchScript = (src: string): Promise<Event> => {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    document.body.appendChild(script);
    script.onload = resolve;
    script.onerror = reject;
    script.async = true;
    script.src = src;
  });
};

export type GLTFCacheBucket = 'model'|'environment';

/**
 * At most one released environment model stays decoded, so a viewer can
 * switch back to the previous set without fetching again. Copies that are
 * still in use are retained and are never evicted, and they do not consume
 * this slot. This limit is not modelCacheSize.
 */
const ENVIRONMENT_MODEL_CACHE_SIZE = 1;

function collectMaterials(root: Object3D): Material[] {
  const materials: Material[] = [];
  root.traverse((node: Object3D) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || mesh.material == null) {
      return;
    }
    if (Array.isArray(mesh.material)) {
      materials.push(...mesh.material);
    } else {
      materials.push(mesh.material);
    }
  });
  return materials;
}

/**
 * Clones own their materials. Geometries and textures stay with the cached
 * master so an unused cached set can be shown again, and so an in-use copy
 * is not freed early. material.dispose() does not dispose textures.
 */
function disposeUnsharedMaterials(
    root: Object3D, shared: ReadonlySet<Material>) {
  const disposed = new Set<Material>();
  for (const material of collectMaterials(root)) {
    if (shared.has(material) || disposed.has(material)) {
      continue;
    }
    disposed.add(material);
    material.dispose();
  }
}

interface CacheStores {
  entries: Map<string, Promise<GLTFInstance>>;
  preloaded: Map<string, boolean>;
}

const modelStores: CacheStores = {
  entries: new Map(),
  preloaded: new Map(),
};

const environmentStores: CacheStores = {
  entries: new Map(),
  preloaded: new Map(),
};

function storesFor(bucket: GLTFCacheBucket): CacheStores {
  return bucket === 'environment' ? environmentStores : modelStores;
}

async function deleteFromStores(stores: CacheStores, url: string) {
  if (!stores.entries.has(url)) {
    return;
  }

  const gltfLoads = stores.entries.get(url);
  stores.preloaded.delete(url);
  stores.entries.delete(url);

  try {
    const gltf = await gltfLoads;
    gltf!.dispose();
  } catch {
    // Failed loads have nothing to dispose.
  }
}

let dracoDecoderLocation: string;
const dracoLoader = new DRACOLoader();

let ktx2TranscoderLocation: string;
const ktx2Loader = new KTX2Loader();

let meshoptDecoderLocation: string;
let meshoptDecoder: Promise<typeof MeshoptDecoder>|undefined;

export const $loader = Symbol('loader');
export const $evictionPolicy = Symbol('evictionPolicy');
export const $environmentEvictionPolicy = Symbol('environmentEvictionPolicy');
const $GLTFInstance = Symbol('GLTFInstance');
const $materialLoadChain = Symbol('materialLoadChain');

export class CachingGLTFLoader<T extends GLTFInstanceConstructor =
                                             GLTFInstanceConstructor> extends
    EventDispatcher<
        {'preload': {element: ModelViewerElementBase, src: String}}> {
  static setDRACODecoderLocation(url: string) {
    dracoDecoderLocation = url;
    dracoLoader.setDecoderPath(url);
  }

  static getDRACODecoderLocation() {
    return dracoDecoderLocation;
  }

  static setKTX2TranscoderLocation(url: string) {
    ktx2TranscoderLocation = url;
    ktx2Loader.setTranscoderPath(url);
  }

  static getKTX2TranscoderLocation() {
    return ktx2TranscoderLocation;
  }

  static setMeshoptDecoderLocation(url: string) {
    if (meshoptDecoderLocation !== url) {
      meshoptDecoderLocation = url;
      meshoptDecoder = fetchScript(url)
                           .then(() => MeshoptDecoder.ready)
                           .then(() => MeshoptDecoder);
    }
  }

  static getMeshoptDecoderLocation() {
    return meshoptDecoderLocation;
  }

  static initializeKTX2Loader(renderer: WebGLRenderer) {
    ktx2Loader.detectSupport(renderer);
  }

  /**
   * Evicts unused product `src` models. modelCacheSize writes this threshold.
   * Environment models are tracked by $environmentEvictionPolicy instead, so
   * they do not consume these slots and are not evicted by src loads.
   */
  static[$evictionPolicy]: CacheEvictionPolicy = new CacheEvictionPolicy({
    delete(url: string) {
      void deleteFromStores(modelStores, url);
    },
  });

  static[$environmentEvictionPolicy]: CacheEvictionPolicy =
      new CacheEvictionPolicy(
          {
            delete(url: string) {
              void deleteFromStores(environmentStores, url);
            },
          },
          ENVIRONMENT_MODEL_CACHE_SIZE, {unusedOnly: true});

  /** Product src entries. Environment models live in a separate map. */
  static get cache() {
    return modelStores.entries;
  }

  /** @nocollapse */
  static clearCache() {
    const urls = [
      ...modelStores.entries.keys(),
      ...environmentStores.entries.keys(),
    ];
    for (const url of urls) {
      void this.delete(url);
    }
    this[$evictionPolicy].reset();
    this[$environmentEvictionPolicy].reset();
  }

  static has(url: string) {
    return modelStores.entries.has(url) || environmentStores.entries.has(url);
  }

  /** @nocollapse */
  static async delete(url: string) {
    // Start both removals before awaiting so one bucket cannot stay visible
    // to a load that begins on the next turn.
    await Promise.all([
      deleteFromStores(modelStores, url),
      deleteFromStores(environmentStores, url),
    ]);
  }

  /**
   * Returns true if the model that corresponds to the specified url is
   * available in our local cache.
   */
  static hasFinishedLoading(url: string) {
    return modelStores.preloaded.get(url) === true ||
        environmentStores.preloaded.get(url) === true;
  }

  constructor(GLTFInstance: T) {
    super();
    this[$GLTFInstance] = GLTFInstance;
    this[$loader].setDRACOLoader(dracoLoader);
    this[$loader].setKTX2Loader(ktx2Loader);
  }

  protected[$loader]: GLTFLoader = new DiagnosingGLTFLoader().register(
      parser => new GLTFMaterialsVariantsExtension(parser));
  protected[$GLTFInstance]: T;
  /**
   * Material GLBs are parsed on this loader (Draco, KTX2, meshopt) but are
   * not inserted into the src or environment caches. Loads are serialized so
   * withCredentials and the meshopt decoder stay consistent.
   */
  private[$materialLoadChain]: Promise<void> = Promise.resolve();

  protected get[$evictionPolicy](): CacheEvictionPolicy {
    return (this.constructor as typeof CachingGLTFLoader)[$evictionPolicy];
  }

  /**
   * Preloads a glTF, populating the cache. Returns a promise that resolves
   * when the cache is populated.
   */
  async preload(
      url: string, element: ModelViewerElementBase,
      progressCallback: ProgressCallback = () => {},
      bucket: GLTFCacheBucket = 'model') {
    const stores = storesFor(bucket);
    this[$loader].setWithCredentials(element.withCredentials);
    this.dispatchEvent({type: 'preload', element: element, src: url});
    if (!stores.entries.has(url)) {
      if (meshoptDecoder != null) {
        this[$loader].setMeshoptDecoder(await meshoptDecoder);
      }

      const rawGLTFLoads =
          loadWithLoader(url, this[$loader], (progress: number) => {
            progressCallback(progress * 0.8);
          });

      const GLTFInstance = this[$GLTFInstance];
      const gltfInstanceLoads =
          rawGLTFLoads
              .then((rawGLTF) => {
                return GLTFInstance.prepare(rawGLTF);
              })
              .then((preparedGLTF) => {
                progressCallback(0.9);
                return new GLTFInstance(preparedGLTF);
              })
              .catch((reason: unknown) => {
                const error = toModelLoadError(reason);
                console.error(error);
                if (stores.entries.get(url) === gltfInstanceLoads) {
                  stores.entries.delete(url);
                  stores.preloaded.delete(url);
                }
                throw error;
              });
      stores.entries.set(url, gltfInstanceLoads);
    }

    await stores.entries.get(url);

    stores.preloaded.set(url, true);

    if (progressCallback) {
      progressCallback(1.0);
    }
  }

  /**
   * Loads a glTF from the specified url and resolves a unique clone of the
   * glTF. If the glTF has already been loaded, makes a clone of the cached
   * copy.
   */
  async load(
      url: string, element: ModelViewerElementBase,
      progressCallback: ProgressCallback = () => {},
      bucket: GLTFCacheBucket = 'model'): Promise<InstanceType<T>> {
    await this.preload(url, element, progressCallback, bucket);

    const gltf = await storesFor(bucket).entries.get(url)!;
    const clone = await gltf.clone() as InstanceType<T>;
    const sharedMaterials = new Set(collectMaterials(gltf.scene));
    const policy = bucket === 'environment' ?
        (this.constructor as
         typeof CachingGLTFLoader)[$environmentEvictionPolicy] :
        this[$evictionPolicy];

    policy.retain(url);

    // Patch dispose so that we can properly account for instance use
    // in the caching layer. Environment retains do not share the src policy,
    // so modelCacheSize cannot evict an environment model that is in use.
    // The cached master is disposed, including geometries and textures, only
    // when eviction drops it. Clone materials are not shared with that master.
    clone.dispose = () => {
      disposeUnsharedMaterials(clone.scene, sharedMaterials);
      policy.release(url);
    };

    return clone;
  }

  /**
   * Parses a material GLB with the same loader as product models and returns
   * its first material. Puzzle uses that first material and ignores the rest.
   * The result is not cached here; the material-swap cache owns it. Files
   * with no scene are valid.
   */
  async loadMaterial(url: string, withCredentials: boolean):
      Promise<{material: Material; warnings: string[]}> {
    const run = this[$materialLoadChain].then(
        () => this.loadMaterialNow(url, withCredentials));
    this[$materialLoadChain] = run.then(() => undefined, () => undefined);
    return run;
  }

  private async loadMaterialNow(url: string, withCredentials: boolean):
      Promise<{material: Material; warnings: string[]}> {
    this[$loader].setWithCredentials(withCredentials);
    if (meshoptDecoder != null) {
      this[$loader].setMeshoptDecoder(await meshoptDecoder);
    }
    const gltf = await loadWithLoader(url, this[$loader]);
    const json = gltf.parser.json as {materials?: Array<{name?: string}>};
    const materials = json.materials ?? [];
    if (materials.length === 0) {
      throw new Error(`Material file has no materials: ${url}`);
    }
    const warnings: string[] = [];
    if (materials.length > 1) {
      warnings.push(`Material file ${url} has ${
          materials.length} materials; using the first.`);
    }
    const material = await gltf.parser.getDependency('material', 0) as Material;
    return {material, warnings};
  }
}
