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

import {expect} from 'chai';
import {BufferGeometry, Material, Mesh, Object3D, Texture} from 'three';

import ModelViewerElementBase from '../../model-viewer-base.js';
import {$evictionPolicy, CachingGLTFLoader} from '../../three-components/CachingGLTFLoader.js';
import {ModelViewerGLTFInstance} from '../../three-components/gltf-instance/ModelViewerGLTFInstance.js';
import {ModelLoadError} from '../../three-components/load-issues.js';
import {assetPath} from '../helpers.js';

function watchDisposals(root: Object3D) {
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const textures: Texture[] = [];
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    if (mesh.geometry) {
      geometries.push(mesh.geometry);
    }
    const meshMaterials = mesh.material == null ? [] :
        Array.isArray(mesh.material)            ? mesh.material :
                                                  [mesh.material];
    for (const material of meshMaterials) {
      materials.push(material);
      for (const key in material) {
        const value = (material as unknown as Record<string, unknown>)[key];
        if (value instanceof Texture && textures.indexOf(value) === -1) {
          textures.push(value);
        }
      }
    }
  });

  const spy = <T extends {dispose(): void}>(items: T[]) => {
    const called = items.map(() => false);
    items.forEach((item, index) => {
      const original = item.dispose.bind(item);
      item.dispose = () => {
        called[index] = true;
        original();
      };
    });
    return () => items.length > 0 && called.every(Boolean);
  };

  return {
    textureCount: textures.length,
    geometryCount: geometries.length,
    materialCount: materials.length,
    geometriesDisposed: spy(geometries),
    materialsDisposed: spy(materials),
    texturesDisposed: spy(textures),
  };
}

async function flushDisposal() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const ModelViewerElement = class extends ModelViewerElementBase {
  static get is() {
    return 'model-viewer-loader';
  }
};

customElements.define('model-viewer-loader', ModelViewerElement);

const ASTRONAUT_GLB_PATH = assetPath('models/Astronaut.glb');
const CUBE_GLTF_PATH = assetPath('models/cube.gltf');
const SPHERE_GLTF_PATH = assetPath('models/reflective-sphere.gltf');
const TRIANGLE_GLTF_PATH = assetPath('models/Triangle.gltf');

suite('CachingGLTFLoader', () => {
  suite('when loading a glTF', () => {
    let loader: CachingGLTFLoader;
    let element: ModelViewerElementBase;

    setup(() => {
      loader = new CachingGLTFLoader(ModelViewerGLTFInstance);
      element = new ModelViewerElement();
    });

    teardown(() => {
      CachingGLTFLoader.clearCache();
    });

    suite('before glTF is loaded', () => {
      test('reports that it has not finished loading', async () => {
        const fileLoads = loader.load(ASTRONAUT_GLB_PATH, element);
        try {
          expect(CachingGLTFLoader.hasFinishedLoading(ASTRONAUT_GLB_PATH))
              .to.be.false;
        } finally {
          await fileLoads;
        }
      });
    });

    suite('after glTF is loaded', () => {
      test('reports that it has finished loading', async () => {
        await loader.load(ASTRONAUT_GLB_PATH, element);
        expect(CachingGLTFLoader.hasFinishedLoading(ASTRONAUT_GLB_PATH))
            .to.be.true;
      });
    });

    test('synchronously populates the cache', async () => {
      const fileLoads = loader.load(ASTRONAUT_GLB_PATH, element);
      try {
        expect(CachingGLTFLoader.has(ASTRONAUT_GLB_PATH)).to.be.true;
      } finally {
        await fileLoads;
      }
    });

    test('yields a promise that resolves a group', async () => {
      const {scene} = await loader.load(ASTRONAUT_GLB_PATH, element);
      expect(scene).to.be.ok;
      expect(scene!.type).to.be.equal('Group');
    });

    suite('when the file is invalid', () => {
      const blobUrls: string[] = [];
      const blobUrlFor = (parts: BlobPart[]) => {
        const url = URL.createObjectURL(new Blob(parts));
        blobUrls.push(url);
        return url;
      };

      teardown(() => {
        blobUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
      });

      const loadError = async (url: string) => {
        try {
          await loader.load(url, element);
        } catch (error) {
          return error;
        }
        throw new Error('Expected load to fail');
      };

      test('rejects an empty file with an empty-response issue', async () => {
        const url = blobUrlFor([]);
        const error = await loadError(url);
        expect(error).to.be.instanceOf(ModelLoadError);
        expect((error as ModelLoadError).issues.map((issue) => issue.code))
            .to.deep.equal(['empty-response']);
      });

      test(
          'rejects a non-GLB file with an invalid-glb-header issue',
          async () => {
            const url = blobUrlFor(['this is not a glb file']);
            const error = await loadError(url) as ModelLoadError;
            expect(error.issues.map((issue) => issue.code)).to.deep.equal([
              'invalid-glb-header'
            ]);
          });

      test('does not keep failed loads in the cache', async () => {
        const url = blobUrlFor([]);
        await loadError(url);
        expect(CachingGLTFLoader.has(url)).to.be.false;
        expect(CachingGLTFLoader.hasFinishedLoading(url)).to.be.false;
      });
    });

    suite('with items outside of the eviction threshold', () => {
      let naturalEvictionThreshold: number;

      setup(() => {
        naturalEvictionThreshold = loader[$evictionPolicy].evictionThreshold;
        loader[$evictionPolicy].evictionThreshold = 0;
      });

      teardown(() => {
        loader[$evictionPolicy].evictionThreshold = naturalEvictionThreshold;
      });

      test('deletes them when they are fully released', async () => {
        const gltf = await loader.load(ASTRONAUT_GLB_PATH, element);

        expect(CachingGLTFLoader.has(ASTRONAUT_GLB_PATH)).to.be.true;
        gltf.dispose();
        expect(CachingGLTFLoader.has(ASTRONAUT_GLB_PATH)).to.be.false;
      });
    });

    test(
        'does not let an environment model consume a src cache slot',
        async () => {
          const previous = loader[$evictionPolicy].evictionThreshold;
          loader[$evictionPolicy].evictionThreshold = 1;
          try {
            const src = await loader.load(ASTRONAUT_GLB_PATH, element);
            src.dispose();
            expect(CachingGLTFLoader.has(ASTRONAUT_GLB_PATH)).to.be.true;

            const environment = await loader.load(
                SPHERE_GLTF_PATH, element, () => {}, 'environment');
            expect(CachingGLTFLoader.has(ASTRONAUT_GLB_PATH)).to.be.true;
            expect(CachingGLTFLoader.has(SPHERE_GLTF_PATH)).to.be.true;
            expect(CachingGLTFLoader.cache.has(SPHERE_GLTF_PATH)).to.be.false;
            environment.dispose();
          } finally {
            loader[$evictionPolicy].evictionThreshold = previous;
          }
        });

    test(
        'keeps environment models cached when modelCacheSize is 0',
        async () => {
          const previous = loader[$evictionPolicy].evictionThreshold;
          loader[$evictionPolicy].evictionThreshold = 0;
          try {
            const src = await loader.load(ASTRONAUT_GLB_PATH, element);
            src.dispose();
            expect(CachingGLTFLoader.has(ASTRONAUT_GLB_PATH)).to.be.false;

            const day = await loader.load(
                SPHERE_GLTF_PATH, element, () => {}, 'environment');
            const night = await loader.load(
                TRIANGLE_GLTF_PATH, element, () => {}, 'environment');
            day.dispose();

            const nextSrc = await loader.load(CUBE_GLTF_PATH, element);
            expect(CachingGLTFLoader.has(SPHERE_GLTF_PATH)).to.be.true;
            expect(CachingGLTFLoader.has(TRIANGLE_GLTF_PATH)).to.be.true;
            expect(CachingGLTFLoader.cache.has(SPHERE_GLTF_PATH)).to.be.false;
            expect(CachingGLTFLoader.cache.has(TRIANGLE_GLTF_PATH)).to.be.false;

            nextSrc.dispose();
            expect(CachingGLTFLoader.has(CUBE_GLTF_PATH)).to.be.false;
            expect(CachingGLTFLoader.has(SPHERE_GLTF_PATH)).to.be.true;
            expect(CachingGLTFLoader.has(TRIANGLE_GLTF_PATH)).to.be.true;
            night.dispose();
          } finally {
            loader[$evictionPolicy].evictionThreshold = previous;
          }
        });

    test(
        'keeps one unused environment model and disposes evicted ones',
        async () => {
          const srcThreshold = loader[$evictionPolicy].evictionThreshold;
          const astronaut = await loader.load(
              ASTRONAUT_GLB_PATH, element, () => {}, 'environment');
          const triangle = await loader.load(
              TRIANGLE_GLTF_PATH, element, () => {}, 'environment');
          const cube = await loader.load(
              CUBE_GLTF_PATH, element, () => {}, 'environment');
          const evicted = watchDisposals(astronaut.scene);
          const spare = watchDisposals(triangle.scene);
          const inUse = watchDisposals(cube.scene);
          expect(evicted.geometryCount).to.be.greaterThan(0);
          expect(evicted.materialCount).to.be.greaterThan(0);
          expect(evicted.textureCount).to.be.greaterThan(0);

          expect(CachingGLTFLoader.has(ASTRONAUT_GLB_PATH)).to.equal(true);
          expect(CachingGLTFLoader.has(TRIANGLE_GLTF_PATH)).to.equal(true);
          expect(CachingGLTFLoader.has(CUBE_GLTF_PATH)).to.equal(true);

          astronaut.dispose();
          await flushDisposal();
          expect(CachingGLTFLoader.has(ASTRONAUT_GLB_PATH)).to.equal(true);
          expect(evicted.geometriesDisposed()).to.equal(false);
          expect(evicted.texturesDisposed()).to.equal(false);

          triangle.dispose();
          await flushDisposal();

          expect(CachingGLTFLoader.has(ASTRONAUT_GLB_PATH)).to.equal(false);
          expect(CachingGLTFLoader.has(TRIANGLE_GLTF_PATH)).to.equal(true);
          expect(CachingGLTFLoader.has(CUBE_GLTF_PATH)).to.equal(true);
          expect(evicted.geometriesDisposed()).to.equal(true);
          expect(evicted.materialsDisposed()).to.equal(true);
          expect(evicted.texturesDisposed()).to.equal(true);
          expect(spare.geometriesDisposed()).to.equal(false);
          expect(spare.texturesDisposed()).to.equal(false);
          expect(inUse.geometriesDisposed()).to.equal(false);
          expect(inUse.materialsDisposed()).to.equal(false);
          expect(inUse.texturesDisposed()).to.equal(false);
          expect(loader[$evictionPolicy].evictionThreshold)
              .to.equal(srcThreshold);

          loader[$evictionPolicy].evictionThreshold = 0;
          try {
            const src = await loader.load(ASTRONAUT_GLB_PATH, element);
            src.dispose();
            expect(CachingGLTFLoader.cache.has(ASTRONAUT_GLB_PATH))
                .to.equal(false);
            expect(CachingGLTFLoader.has(CUBE_GLTF_PATH)).to.equal(true);
            expect(inUse.geometriesDisposed()).to.equal(false);
          } finally {
            loader[$evictionPolicy].evictionThreshold = srcThreshold;
          }
          cube.dispose();
        });

    test(
        'does not evict an in-use environment model that is least recently used',
        async () => {
          const held = await loader.load(
              ASTRONAUT_GLB_PATH, element, () => {}, 'environment');
          const middle = await loader.load(
              TRIANGLE_GLTF_PATH, element, () => {}, 'environment');
          const newest = await loader.load(
              CUBE_GLTF_PATH, element, () => {}, 'environment');
          const heldResources = watchDisposals(held.scene);

          newest.dispose();
          middle.dispose();
          await flushDisposal();

          expect(CachingGLTFLoader.has(ASTRONAUT_GLB_PATH)).to.equal(true);
          expect(heldResources.geometriesDisposed()).to.equal(false);
          expect(heldResources.texturesDisposed()).to.equal(false);
          expect(CachingGLTFLoader.has(TRIANGLE_GLTF_PATH)).to.equal(false);
          expect(CachingGLTFLoader.has(CUBE_GLTF_PATH)).to.equal(true);
          held.dispose();
        });
  });
});
