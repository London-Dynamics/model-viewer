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
import {Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture} from 'three';

import {MATERIAL_SWAP_ERROR_EVENT, MATERIAL_SWAP_EVENT, MaterialSwapError, MaterialSwapResult} from '../../features/ld-material-swap.js';
import {MaterialSwapCache} from '../../features/ld-material-swap/material-cache.js';
import {qualityFileUrl} from '../../features/ld-material-swap/quality-url.js';
import {syncOwnedMaterial} from '../../features/ld-material-swap/sync-material.js';
import {expandPrefixPattern, gltfMeshAssociation, groupPrimitivesByGltfMeshName, resolveMaterialSwapTargets} from '../../features/ld-material-swap/targets.js';
import {$primitivesList} from '../../features/scene-graph/model.js';
import {$renderer} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {CachingGLTFLoader} from '../../three-components/CachingGLTFLoader.js';
import {GLTFInstance} from '../../three-components/GLTFInstance.js';
import {waitForEvent} from '../../utilities.js';

suite('material swap targets', () => {
  const names = [
    'DoubleCAB_BodyPaint',
    'DoubleCAB_BodyPaint',
    'CabShell',
    'Trim',
    'OtherPaint',
  ];

  test('matches exact glTF mesh names once', () => {
    const resolved = resolveMaterialSwapTargets(
        names, ['DoubleCAB_BodyPaint', 'Missing', 'DoubleCAB_BodyPaint']);
    expect(resolved.meshes).to.deep.equal(['DoubleCAB_BodyPaint']);
    expect(resolved.missing).to.deep.equal(['Missing']);
  });

  test('expands prefix patterns and leaves a mid-string star as exact', () => {
    expect(expandPrefixPattern('Cab*', names)).to.deep.equal(['CabShell']);
    expect(expandPrefixPattern('DoubleCAB*', names)).to.deep.equal([
      'DoubleCAB_BodyPaint',
    ]);
    expect(expandPrefixPattern('*', names)).to.deep.equal([
      'DoubleCAB_BodyPaint',
      'CabShell',
      'Trim',
      'OtherPaint',
    ]);
    expect(expandPrefixPattern('Paint*', names)).to.deep.equal([]);
    expect(expandPrefixPattern('cab*', names)).to.deep.equal([]);
    expect(expandPrefixPattern('A*B', ['A*B', 'AXB'])).to.deep.equal(['A*B']);
    expect(expandPrefixPattern('A*B*', ['A*B', 'A*BExtra', 'AB']))
        .to.deep.equal([
          'A*B',
          'A*BExtra',
        ]);

    const resolved = resolveMaterialSwapTargets(
        names, ['Trim'], ['Cab*', 'Nope*', 'DoubleCAB*']);
    expect(resolved.meshes).to.deep.equal([
      'Trim',
      'CabShell',
      'DoubleCAB_BodyPaint',
    ]);
    expect(resolved.missing).to.deep.equal(['Nope*']);
  });

  test('reads the glTF mesh index from loader associations', () => {
    const mesh = new Mesh();
    expect(gltfMeshAssociation(mesh)).to.equal(null);
    mesh.userData.associations = {meshes: 4, primitives: 1};
    expect(gltfMeshAssociation(mesh)).to.equal(4);
  });
});

suite('material swap quality urls', () => {
  test('inserts @quality before the extension and keeps query and hash', () => {
    expect(qualityFileUrl('materials/paint.glb', 'mobile'))
        .to.equal('materials/paint@mobile.glb');
    expect(qualityFileUrl(
               'https://assets.example/a/paint.glb?token=1#view', 'mobile'))
        .to.equal('https://assets.example/a/paint@mobile.glb?token=1#view');
    expect(qualityFileUrl('materials/paint', 'mobile'))
        .to.equal('materials/paint@mobile');
  });
});

suite('syncOwnedMaterial', () => {
  test('updates colour without rebuilding the program', () => {
    const source = new MeshPhysicalMaterial({color: 0xff0000, roughness: 0.25});
    const owned = new MeshPhysicalMaterial({color: 0x00ff00, roughness: 0.25});
    owned.flatShading = true;
    owned.vertexColors = true;
    owned.normalScale.set(1, -1);
    owned.clearcoatNormalScale.set(1, -1);
    const version = owned.version;

    const definesChanged = syncOwnedMaterial(owned, source);

    expect(definesChanged).to.equal(false);
    expect(owned.version).to.equal(version);
    expect(owned.color.getHex()).to.equal(0xff0000);
    expect(owned.flatShading).to.equal(true);
    expect(owned.vertexColors).to.equal(true);
    expect(owned.normalScale.y).to.equal(-1);
    expect(owned.clearcoatNormalScale.y).to.equal(-1);
  });

  test('marks needsUpdate when a map appears', () => {
    const source = new MeshPhysicalMaterial({color: 0xff0000});
    const owned = source.clone();
    const texture = new Texture();
    source.map = texture;
    const version = owned.version;

    expect(syncOwnedMaterial(owned, source)).to.equal(true);
    expect(owned.map).to.equal(texture);
    expect(owned.version).to.be.greaterThan(version);
    texture.dispose();
    source.dispose();
    owned.dispose();
  });

  test('keeps a flipped normal scale when the source scale changes', () => {
    const source = new MeshPhysicalMaterial();
    const owned = source.clone();
    owned.normalScale.set(1, -1);
    source.normalScale.set(4, 5);
    const version = owned.version;

    expect(syncOwnedMaterial(owned, source)).to.equal(false);
    expect(owned.normalScale.x).to.equal(4);
    expect(owned.normalScale.y).to.equal(-5);
    expect(owned.version).to.equal(version);
    source.dispose();
    owned.dispose();
  });
});

suite('MaterialSwapCache', () => {
  test('falls back from @mobile and then reuses the cached file', async () => {
    const cache = new MaterialSwapCache(4);
    const calls: string[] = [];
    const load = async (url: string) => {
      calls.push(url);
      if (url.includes('@mobile')) {
        throw new Error('missing');
      }
      return {material: new MeshPhysicalMaterial({name: 'Paint'})};
    };
    const url = 'https://cdn.example/paint.glb?t=1';

    const first = await cache.acquire(url, 'mobile', load);
    expect(calls).to.deep.equal([
      'https://cdn.example/paint@mobile.glb?t=1',
      url,
    ]);
    expect(first.resolvedUrl).to.equal(url);
    expect(first.material.name).to.equal('Paint');

    calls.length = 0;
    const second = await cache.acquire(url, 'mobile', load);
    expect(calls).to.deep.equal([]);
    expect(second.material).to.equal(first.material);

    calls.length = 0;
    await cache.acquire('https://cdn.example/other.glb', 'desktop', load);
    expect(calls).to.deep.equal(['https://cdn.example/other.glb']);
    cache.clear();
  });

  test('does not cache a failed load', async () => {
    const cache = new MaterialSwapCache(2);
    let calls = 0;
    const load = async () => {
      calls++;
      throw new Error('no');
    };
    const url = 'https://cdn.example/bad.glb';
    for (let i = 0; i < 2; i++) {
      let failed = false;
      try {
        await cache.acquire(url, 'desktop', load);
      } catch (error) {
        failed = true;
        expect((error as Error).message).to.equal('no');
      }
      expect(failed).to.equal(true);
    }
    expect(calls).to.equal(2);
    expect(cache.has(url, 'desktop')).to.equal(false);
  });

  test(
      'evicts the least recently released file and disposes its textures',
      async () => {
        const cache = new MaterialSwapCache(1);
        const disposed: string[] = [];
        const make = (name: string) => {
          const material = new MeshPhysicalMaterial({name});
          const texture = new Texture();
          material.map = texture;
          const disposeMaterial = material.dispose.bind(material);
          material.dispose = () => {
            disposed.push(name + ':material');
            disposeMaterial();
          };
          const disposeTexture = texture.dispose.bind(texture);
          texture.dispose = () => {
            disposed.push(name + ':texture');
            disposeTexture();
          };
          return material;
        };
        const load = async (url: string) => ({material: make(url)});

        const first = await cache.acquire('a.glb', 'desktop', load);
        cache.retain(first.cacheKey);
        cache.release(first.cacheKey);
        const second = await cache.acquire('b.glb', 'desktop', load);
        cache.retain(second.cacheKey);
        cache.release(second.cacheKey);
        await settled();

        expect(disposed).to.deep.equal(['a.glb:texture', 'a.glb:material']);
        expect(cache.has('a.glb', 'desktop')).to.equal(false);
        expect(cache.has('b.glb', 'desktop')).to.equal(true);
        cache.clear();
      });

  test('does not evict a file a viewer still holds', async () => {
    const cache = new MaterialSwapCache(0);
    const disposed: string[] = [];
    const load = async (url: string) => {
      const material = new MeshPhysicalMaterial({name: url});
      const texture = new Texture();
      material.map = texture;
      const disposeMaterial = material.dispose.bind(material);
      material.dispose = () => {
        disposed.push(url + ':material');
        disposeMaterial();
      };
      const disposeTexture = texture.dispose.bind(texture);
      texture.dispose = () => {
        disposed.push(url + ':texture');
        disposeTexture();
      };
      return {material};
    };

    const held = await cache.acquire('held.glb', 'desktop', load);
    cache.retain(held.cacheKey);
    const dropped = await cache.acquire('dropped.glb', 'desktop', load);
    cache.retain(dropped.cacheKey);
    cache.release(dropped.cacheKey);
    await settled();

    expect(disposed.some((entry) => entry.startsWith('held.glb')))
        .to.equal(false);
    expect(disposed).to.deep.equal(
        ['dropped.glb:texture', 'dropped.glb:material']);
    expect(cache.retainerCount('held.glb', 'desktop')).to.equal(1);
    cache.release(held.cacheKey);
    cache.clear();
  });
});

suite('loadMaterial', () => {
  const loader = new CachingGLTFLoader(GLTFInstance);

  test(
      'parses a scene-less clearcoat material outside the model caches',
      async () => {
        const before = CachingGLTFLoader.cache.size;
        const url = jsonUrl({
          asset: {version: '2.0'},
          materials: [{
            name: 'Paint',
            pbrMetallicRoughness: {
              baseColorFactor: [1, 0, 0, 1],
              metallicFactor: 0.4,
              roughnessFactor: 0.25,
            },
            extensions: {
              KHR_materials_clearcoat: {
                clearcoatFactor: 0.9,
                clearcoatRoughnessFactor: 0.005,
              },
            },
          }],
          extensionsUsed: ['KHR_materials_clearcoat'],
        });
        try {
          const loaded = await loader.loadMaterial(url, false);
          const material = loaded.material as MeshPhysicalMaterial;
          expect(material.isMeshPhysicalMaterial).to.equal(true);
          expect(material.name).to.equal('Paint');
          expect(material.clearcoat).to.be.closeTo(0.9, 1e-6);
          expect(loaded.warnings).to.deep.equal([]);
          expect(CachingGLTFLoader.cache.has(url)).to.equal(false);
          expect(CachingGLTFLoader.has(url)).to.equal(false);
          expect(CachingGLTFLoader.cache.size).to.equal(before);
          material.dispose();
        } finally {
          URL.revokeObjectURL(url);
        }
      });

  test('uses the first material when the file has several', async () => {
    const url = jsonUrl({
      asset: {version: '2.0'},
      materials: [
        {name: 'First', pbrMetallicRoughness: {baseColorFactor: [0, 0, 1, 1]}},
        {name: 'Second', pbrMetallicRoughness: {baseColorFactor: [0, 1, 0, 1]}},
      ],
    });
    try {
      const loaded = await loader.loadMaterial(url, false);
      expect(loaded.material.name).to.equal('First');
      expect(loaded.warnings).to.have.length(1);
      loaded.material.dispose();
    } finally {
      URL.revokeObjectURL(url);
    }
  });
});

suite('applyMaterialSwaps', () => {
  const previousCacheSize = ModelViewerElement.materialSwapCacheSize;

  teardown(() => {
    ModelViewerElement.materialSwapCacheSize = previousCacheSize;
    ModelViewerElement.clearMaterialSwapCache();
  });

  test('materialSwapCacheSize is independent of the src cache', () => {
    expect(ModelViewerElement.materialSwapCacheSize).to.equal(8);
    ModelViewerElement.materialSwapCacheSize = 2;
    expect(ModelViewerElement.materialSwapCacheSize).to.equal(2);
  });

  test('rejects when no model is loaded', async () => {
    const element = new ModelViewerElement();
    document.body.appendChild(element);
    try {
      let detail: unknown = null;
      element.addEventListener(MATERIAL_SWAP_ERROR_EVENT, (event) => {
        detail = (event as CustomEvent).detail;
      });
      let caught: unknown = null;
      try {
        await element.applyMaterialSwaps(
            [{url: 'https://example.test/paint.glb', targets: ['Trim']}],
            {quality: 'desktop'});
      } catch (error) {
        caught = error;
      }
      expect(caught).to.be.instanceOf(MaterialSwapError);
      expect((caught as MaterialSwapError).detail.reason).to.equal('no-model');
      expect(detail).to.deep.equal((caught as MaterialSwapError).detail);
    } finally {
      element.remove();
    }
  });

  test(
      'swaps every primitive of a glTF mesh name, including prefix matches, and leaves a shared material on other meshes',
      async () => {
        await withViewer(async ({element, track}) => {
          const modelUrl = track(sceneFile());
          const blueUrl = track(paintFile('BluePaint', [0, 0, 1, 1]));
          element.src = modelUrl;
          await waitForEvent(element, 'load');

          const groups = meshGroups(element);
          const bodyNames = groups.get('DoubleCAB_BodyPaint')!.map(
              (primitive) => primitive.mesh.name);
          expect(groups.get('DoubleCAB_BodyPaint')).to.have.length(2);
          expect(bodyNames).to.not.include('DoubleCAB_BodyPaint');
          expect(groups.get('CabShell')).to.have.length(2);

          const trim = groups.get('Trim')![0];
          const other = groups.get('OtherPaint')![0];
          const shared = trim.mesh.material;
          expect(other.mesh.material).to.equal(shared);
          for (const primitive of groups.get('DoubleCAB_BodyPaint')!) {
            expect(primitive.mesh.material).to.equal(shared);
          }
          const cab = groups.get('CabShell')![0];
          const cabInitial = cab.initialMaterialIdx;
          for (const primitive of element.model![$primitivesList]) {
            primitive.mesh.name = 'decoy';
          }

          let marks = 0;
          const restore = spyMarkSceneDirty(element, () => {
            marks++;
          });
          try {
            const result = await element.applyMaterialSwaps(
                [{
                  url: blueUrl,
                  targets: ['DoubleCAB_BodyPaint'],
                  targetPatterns: ['Cab*'],
                }],
                {quality: 'desktop'});
            expect(result.missingTargets).to.deep.equal([]);
            expect(result.applied).to.have.length(1);
            expect(result.applied[0].meshes).to.have.members([
              'DoubleCAB_BodyPaint',
              'CabShell',
            ]);
            expect(result.applied[0].materialName).to.equal('BluePaint');
            expect(marks).to.equal(1);

            expect(trim.mesh.material).to.equal(shared);
            expect(other.mesh.material).to.equal(shared);
            expect(colorOf(trim.mesh).r).to.be.closeTo(1, 1e-3);
            for (const primitive of groups.get('DoubleCAB_BodyPaint')!) {
              expect(primitive.mesh.name).to.equal('decoy');
              expect(primitive.mesh.material).to.not.equal(shared);
              expect(colorOf(primitive.mesh).b).to.be.greaterThan(0.5);
            }
            for (const primitive of groups.get('CabShell')!) {
              expect(primitive.mesh.material).to.not.equal(shared);
            }
            expect(cab.initialMaterialIdx).to.equal(cabInitial);
            await cab.enableVariant(null);
            expect(cab.getActiveMaterial().index).to.equal(cabInitial);
            expect(colorOf(cab.mesh).r).to.be.greaterThan(colorOf(cab.mesh).b);

            const registered = element.model!.getMaterialByName('BluePaint');
            expect(registered).to.not.equal(null);
            expect(CachingGLTFLoader.cache.has(blueUrl)).to.equal(false);
            expect(CachingGLTFLoader.has(blueUrl)).to.equal(false);
            expect(CachingGLTFLoader.cache.has(modelUrl)).to.equal(true);
          } finally {
            restore();
          }
        });
      });

  test(
      'reuses one owned material across swaps and does not revert when a mesh is omitted',
      async () => {
        await withViewer(async ({element, track}) => {
          element.src = track(sceneFile());
          await waitForEvent(element, 'load');
          const blueUrl = track(paintFile('BluePaint', [0, 0, 1, 1]));
          const greenUrl = track(paintFile('GreenPaint', [0, 1, 0, 1]));
          const groups = meshGroups(element);
          const trim = groups.get('Trim')![0].mesh;
          const other = groups.get('OtherPaint')![0].mesh;
          const shared = trim.material;

          const renamed = await element.applyMaterialSwaps(
              [{url: blueUrl, targets: ['Trim'], key: 'paint'}],
              {quality: 'desktop'});
          expect(renamed.applied[0].materialName).to.equal('BluePaint');
          const meshVersion = (trim.material as MeshPhysicalMaterial).version;
          await element.applyMaterialSwaps(
              [{url: greenUrl, targets: ['Trim'], key: 'paint'}],
              {quality: 'desktop'});
          expect(element.model!.getMaterialByName('GreenPaint'))
              .to.equal(element.model!.materials.find(
                  (material) => material.name === 'GreenPaint'));
          expect(element.model!.getMaterialByName('BluePaint')).to.equal(null);
          expect((trim.material as MeshPhysicalMaterial).version)
              .to.equal(meshVersion);
          expect(colorOf(trim).g).to.be.greaterThan(colorOf(trim).b);

          const blue = await element.applyMaterialSwaps(
              [{url: blueUrl, targets: ['OtherPaint', 'Trim']}],
              {quality: 'desktop'});
          const blueMaterial = element.model!.getMaterialByName('BluePaint')!;
          const ownedUuid = (other.material as MeshStandardMaterial).uuid;
          const ownedVersion = (other.material as MeshPhysicalMaterial).version;
          blueMaterial.pbrMetallicRoughness.setBaseColorFactor([0, 0, 0.15, 1]);
          expect(colorOf(other).b).to.be.lessThan(0.5);

          const again = await element.applyMaterialSwaps(
              [{url: blueUrl, targets: ['OtherPaint']}], {quality: 'desktop'});
          expect(again.applied[0].key).to.equal(blueUrl);
          expect(element.model!.getMaterialByName('BluePaint'))
              .to.equal(blueMaterial);
          expect((other.material as MeshStandardMaterial).uuid)
              .to.equal(ownedUuid);
          expect((other.material as MeshPhysicalMaterial).version)
              .to.equal(ownedVersion);
          expect(colorOf(other).b).to.be.greaterThan(0.5);
          expect(trim.material).to.not.equal(shared);

          await element.applyMaterialSwaps([], {quality: 'desktop'});
          expect((other.material as MeshStandardMaterial).uuid)
              .to.equal(ownedUuid);
          expect(blue.applied[0].materialName).to.equal('BluePaint');

          const leftOut = groups.get('DoubleCAB_BodyPaint')![0].mesh;
          expect(leftOut.material).to.equal(shared);
        });
      });

  test(
      'last request wins, missing names are reported, and a load error leaves the scene',
      async () => {
        await withViewer(async ({element, track}) => {
          element.src = track(sceneFile());
          await waitForEvent(element, 'load');
          const blueUrl = track(paintFile('BluePaint', [0, 0, 1, 1]));
          const greenUrl = track(paintFile('GreenPaint', [0, 1, 0, 1]));
          const groups = meshGroups(element);
          const trim = groups.get('Trim')![0].mesh;
          const other = groups.get('OtherPaint')![0].mesh;

          let completed: MaterialSwapResult|null = null;
          element.addEventListener(MATERIAL_SWAP_EVENT, (event) => {
            completed = (event as CustomEvent<MaterialSwapResult>).detail;
          });
          const result = await element.applyMaterialSwaps(
              [
                {
                  url: blueUrl,
                  targets: ['Trim', 'OtherPaint', 'MissingMesh'],
                },
                {url: greenUrl, targets: ['Trim'], targetPatterns: ['Nope*']},
              ],
              {quality: 'desktop'});
          expect(result.missingTargets).to.deep.equal(['MissingMesh', 'Nope*']);
          expect(completed).to.equal(result);
          expect(colorOf(trim).g).to.be.greaterThan(colorOf(trim).b);
          expect(colorOf(other).b).to.be.greaterThan(colorOf(other).g);
          const trimMaterial = trim.material;
          const otherMaterial = other.material;

          const controller = new AbortController();
          controller.abort();
          let aborted: unknown = null;
          try {
            await element.applyMaterialSwaps(
                [{url: blueUrl, targets: ['Trim']}],
                {signal: controller.signal, quality: 'desktop'});
          } catch (error) {
            aborted = error;
          }
          expect(aborted).to.be.instanceOf(MaterialSwapError);
          expect((aborted as MaterialSwapError).detail.reason)
              .to.equal('aborted');
          expect(trim.material).to.equal(trimMaterial);

          let errorDetail: unknown = null;
          element.addEventListener(MATERIAL_SWAP_ERROR_EVENT, (event) => {
            errorDetail = (event as CustomEvent).detail;
          });
          let loadError: unknown = null;
          try {
            await element.applyMaterialSwaps(
                [{
                  url: track({asset: {version: '2.0'}, materials: []}),
                  targets: ['Trim'],
                }],
                {quality: 'desktop'});
          } catch (error) {
            loadError = error;
          }
          expect(loadError).to.be.instanceOf(MaterialSwapError);
          expect((loadError as MaterialSwapError).detail.reason)
              .to.equal('load');
          expect((errorDetail as {reason?: string}).reason).to.equal('load');
          expect(trim.material).to.equal(trimMaterial);
          expect(other.material).to.equal(otherMaterial);
        });
      });

  test(
      'mobile quality falls back to the base file and then hits the cache',
      async () => {
        await withViewer(async ({element, track}) => {
          element.src = track(sceneFile());
          await waitForEvent(element, 'load');
          const blueUrl = track(paintFile('BluePaint', [0, 0, 1, 1]));
          const trim = meshGroups(element).get('Trim')![0].mesh;
          const loader = element[$renderer].loader;
          const original = loader.loadMaterial.bind(loader);
          const urls: string[] = [];
          loader.loadMaterial = (url: string, withCredentials: boolean) => {
            urls.push(url);
            return original(url, withCredentials);
          };
          try {
            const first = await element.applyMaterialSwaps(
                [{url: blueUrl, targets: ['Trim']}], {quality: 'mobile'});
            expect(urls.some((url) => url.includes('@mobile'))).to.equal(true);
            expect(urls).to.include(blueUrl);
            expect(first.applied[0].resolvedUrl).to.equal(blueUrl);
            expect(colorOf(trim).b).to.be.greaterThan(0.5);
            const calls = urls.length;
            const uuid = (trim.material as MeshStandardMaterial).uuid;
            const second = await element.applyMaterialSwaps(
                [{url: blueUrl, targets: ['Trim']}], {quality: 'mobile'});
            expect(urls.length).to.equal(calls);
            expect(second.applied[0].resolvedUrl).to.equal(blueUrl);
            expect((trim.material as MeshStandardMaterial).uuid).to.equal(uuid);
          } finally {
            loader.loadMaterial = original;
          }
        });
      });

  test(
      'a later src replaces swaps and does not evict the material file or the environment cache',
      async () => {
        await withViewer(async ({element, track}) => {
          const firstUrl = track(sceneFile());
          const secondUrl = track(sceneFile());
          const blueUrl = track(paintFile('BluePaint', [0, 0, 1, 1]));
          element.src = firstUrl;
          await waitForEvent(element, 'load');
          const loader = element[$renderer].loader;
          const original = loader.loadMaterial.bind(loader);
          let calls = 0;
          loader.loadMaterial = (url: string, withCredentials: boolean) => {
            calls++;
            return original(url, withCredentials);
          };
          try {
            await element.applyMaterialSwaps(
                [{url: blueUrl, targets: ['Trim']}], {quality: 'desktop'});
            expect(calls).to.equal(1);
            expect(element.model!.getMaterialByName('BluePaint'))
                .to.not.equal(null);

            const environmentBefore = element[$renderer].loader;
            element.src = secondUrl;
            await waitForEvent(element, 'load');
            expect(element.model!.getMaterialByName('BluePaint'))
                .to.equal(null);
            expect(meshGroups(element).get('Trim')![0].mesh.material)
                .to.not.equal(undefined);
            await element.applyMaterialSwaps(
                [{url: blueUrl, targets: ['Trim']}], {quality: 'desktop'});
            expect(calls).to.equal(1);
            expect(element[$renderer].loader).to.equal(environmentBefore);
            expect(CachingGLTFLoader.cache.has(blueUrl)).to.equal(false);
            expect(CachingGLTFLoader.has(blueUrl)).to.equal(false);
            expect(colorOf(meshGroups(element).get('Trim')![0].mesh).b)
                .to.be.greaterThan(0.5);
          } finally {
            loader.loadMaterial = original;
          }
        });
      });
});

function colorOf(mesh: Mesh) {
  return (mesh.material as MeshStandardMaterial).color;
}

function meshGroups(element: ModelViewerElement) {
  return groupPrimitivesByGltfMeshName(
      element.model![$primitivesList], element.originalGltfJson?.meshes);
}

function spyMarkSceneDirty(element: ModelViewerElement, mark: () => void): () =>
    void {
  const proto = Object.getPrototypeOf(element);
  let host: object = proto;
  while (host != null &&
         !Object.prototype.hasOwnProperty.call(host, 'getPathTracerComposer')) {
    host = Object.getPrototypeOf(host);
  }
  const original =
      Object.getOwnPropertyDescriptor(host, 'getPathTracerComposer');
  Object.defineProperty(host, 'getPathTracerComposer', {
    configurable: true,
    value() {
      return {markSceneDirty: mark};
    },
  });
  return () => {
    if (original) {
      Object.defineProperty(host, 'getPathTracerComposer', original);
    }
  };
}

interface ViewContext {
  element: ModelViewerElement;
  track(json: object): string;
}

async function withViewer(run: (context: ViewContext) => Promise<void>) {
  const urls: string[] = [];
  const element = new ModelViewerElement();
  document.body.appendChild(element);
  try {
    await run({
      element,
      track(json: object) {
        const url = jsonUrl(json);
        urls.push(url);
        return url;
      },
    });
  } finally {
    element.remove();
    for (const url of urls) {
      URL.revokeObjectURL(url);
    }
    ModelViewerElement.clearMaterialSwapCache();
  }
}

function jsonUrl(json: object): string {
  const blob = new Blob([JSON.stringify(json)], {type: 'model/gltf+json'});
  return URL.createObjectURL(blob);
}

function paintFile(name: string, color: number[]): object {
  return {
    asset: {version: '2.0'},
    materials: [{
      name,
      pbrMetallicRoughness: {
        baseColorFactor: [...color],
        metallicFactor: 0.1,
        roughnessFactor: 0.4,
      },
    }],
  };
}

function sceneFile(): object {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const indices = new Uint16Array([0, 1, 2]);
  const bytes = new Uint8Array(positions.byteLength + indices.byteLength);
  bytes.set(new Uint8Array(positions.buffer), 0);
  bytes.set(new Uint8Array(indices.buffer), positions.byteLength);
  const specs = [
    {name: 'DoubleCAB_BodyPaint', primitives: 1},
    {name: 'DoubleCAB_BodyPaint', primitives: 1},
    {name: 'CabShell', primitives: 2},
    {name: 'Trim', primitives: 1},
    {name: 'OtherPaint', primitives: 1},
  ];
  const meshes =
      specs.map((spec) => ({
                  name: spec.name,
                  primitives: Array.from(
                      {length: spec.primitives}, () => ({
                                                   attributes: {POSITION: 0},
                                                   indices: 1,
                                                   material: 0,
                                                 })),
                }));
  return {
    asset: {version: '2.0'},
    scene: 0,
    scenes: [{nodes: specs.map((_, index) => index)}],
    nodes: specs.map((_, index) => ({mesh: index, name: 'node-' + index})),
    meshes,
    materials: [{
      name: 'Shared',
      pbrMetallicRoughness: {baseColorFactor: [1, 0, 0, 1]},
    }],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 0],
      },
      {
        bufferView: 1,
        componentType: 5123,
        count: 3,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: 0,
        byteLength: positions.byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: indices.byteLength,
        target: 34963,
      },
    ],
    buffers: [{
      uri: 'data:application/octet-stream;base64,' + encodeBytes(bytes),
      byteLength: bytes.byteLength,
    }],
  };
}

function settled(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
