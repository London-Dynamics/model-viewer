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

import {expect} from 'chai';
import {BoxGeometry, Mesh, MeshStandardMaterial, Scene} from 'three';
import {MeshBVH} from 'three-mesh-bvh';

import {captureSceneBvh, decodeBvhRecords, encodeBvhRecords, hashMeshPositions, restoreSceneBvh} from '../../three-components/postprocessing/ld-path-tracer/cache/path-tracer-bvh-cache.js';
import {acceptCacheFingerprint, decodePathTracerCache, encodePathTracerCache, PathTracerCacheFingerprint} from '../../three-components/postprocessing/ld-path-tracer/cache/path-tracer-cache-format.js';
import {PathTracerCacheStore} from '../../three-components/postprocessing/ld-path-tracer/cache/path-tracer-cache-store.js';
import {cacheTypesClearedBy, classifyMaterialProperties, defaultPathTracerCacheFlags, PATH_TRACER_CACHE_DEPENDENCIES, PATH_TRACER_CACHE_INVALIDATIONS, typesToApply} from '../../three-components/postprocessing/ld-path-tracer/cache/path-tracer-cache-types.js';
import {accumulateIrradiance, createIrradianceGrid, decodeIrradiancePayload, encodeIrradiancePayload, irradianceFromRadiance, irradianceSlot, radianceFromIrradiance, readIrradiance} from '../../three-components/postprocessing/ld-path-tracer/cache/path-tracer-irradiance-cache.js';
import {collectMaterialRecords, decodeMaterialRecords, diffMaterialWatch, encodeMaterialRecords, sampleMaterialWatch} from '../../three-components/postprocessing/ld-path-tracer/cache/path-tracer-material-cache.js';

const liveFingerprint = (): PathTracerCacheFingerprint => ({
  glb: 'glb-a',
  environment: 'env-a',
  settings: 'settings-a',
});

const otherFingerprint = (): PathTracerCacheFingerprint => ({
  glb: 'glb-b',
  environment: 'env-b',
  settings: 'settings-b',
});

const fileWith = (
    fingerprint: PathTracerCacheFingerprint,
    types: Array<'bvh'|'irradiance'|'materials'> =
        [
          'bvh',
          'irradiance',
          'materials',
        ],
    ): Uint8Array =>
    encodePathTracerCache(
        fingerprint,
        types.map((type) => ({
                    type,
                    bytes: new TextEncoder().encode(type),
                    meta: {label: type},
                  })),
    );

suite('path tracer cache format', () => {
  test('round-trips a header and several cache types', () => {
    const fingerprint = liveFingerprint();
    const encoded = fileWith(fingerprint);
    const decoded = decodePathTracerCache(encoded);

    expect(decoded.header.format).to.equal(1);
    expect(decoded.header.fingerprint).to.deep.equal(fingerprint);
    expect(decoded.header.digest).to.be.a('string').and.not.equal('');
    expect(new TextDecoder().decode(decoded.payloads.bvh!)).to.equal('bvh');
    expect(new TextDecoder().decode(decoded.payloads.irradiance!))
        .to.equal('irradiance');
    expect(new TextDecoder().decode(decoded.payloads.materials!))
        .to.equal('materials');
    expect(decoded.header.entries.map((entry) => entry.type)).to.deep.equal([
      'bvh',
      'irradiance',
      'materials',
    ]);
  });

  test('rejects a file whose magic or version is wrong', () => {
    const encoded = fileWith(liveFingerprint());
    encoded[0] = 0;
    expect(() => decodePathTracerCache(encoded)).to.throw(/bad header/);

    const versioned = fileWith(liveFingerprint());
    versioned[4] = 9;
    expect(() => decodePathTracerCache(versioned)).to.throw(/not supported/);
  });

  test('fingerprint check is opt-in and off lets a mismatch through', () => {
    const live = liveFingerprint();
    const file = otherFingerprint();
    expect(acceptCacheFingerprint(file, live, false)).to.deep.equal({
      accept: true,
      matched: false,
      reason: 'verification-skipped',
    });
    expect(acceptCacheFingerprint(file, live, true)).to.deep.equal({
      accept: false,
      matched: false,
      reason: 'fingerprint-mismatch',
    });
    expect(acceptCacheFingerprint(live, live, true).reason).to.equal('matched');
    expect(acceptCacheFingerprint(live, live, false).reason)
        .to.equal('matched');
  });
});

suite('path tracer cache flags', () => {
  test('defaults leave verification off and every type loadable', () => {
    const flags = defaultPathTracerCacheFlags();
    expect(flags.verifyFingerprint).to.equal(false);
    expect(flags.enabled).to.deep.equal({
      bvh: false,
      irradiance: false,
      materials: false,
    });
    expect(flags.load).to.deep.equal({
      bvh: true,
      irradiance: true,
      materials: true,
    });
  });

  test('a disabled type is not applied', () => {
    const flags = defaultPathTracerCacheFlags();
    flags.enabled = {bvh: true, irradiance: false, materials: true};
    expect(typesToApply(['bvh', 'irradiance', 'materials'], flags))
        .to.deep.equal([
          'bvh',
          'materials',
        ]);
  });

  test('automatic loads honour per-type load flags', () => {
    const flags = defaultPathTracerCacheFlags();
    flags.enabled = {bvh: true, irradiance: true, materials: true};
    flags.load = {bvh: true, irradiance: false, materials: true};
    expect(typesToApply(['bvh', 'irradiance', 'materials'], flags, {
      respectLoadFlags: true
    })).to.deep.equal(['bvh', 'materials']);
    expect(typesToApply(['bvh', 'irradiance', 'materials'], flags, {
      respectLoadFlags: false,
    })).to.deep.equal(['bvh', 'irradiance', 'materials']);
  });

  test('store load skips a mismatch only when verification is on', () => {
    const checked = new PathTracerCacheStore();
    checked.setFlags({
      verifyFingerprint: true,
      enabled: {bvh: true, irradiance: true, materials: true},
    });
    const rejected =
        checked.loadBytes(fileWith(otherFingerprint()), liveFingerprint());
    expect(rejected.accepted).to.equal(false);
    expect(rejected.reason).to.equal('fingerprint-mismatch');
    expect(rejected.applied).to.deep.equal([]);
    expect(checked.has('bvh')).to.equal(false);

    const open = new PathTracerCacheStore();
    open.setFlags({
      verifyFingerprint: false,
      enabled: {bvh: true, irradiance: true, materials: false},
    });
    const accepted = open.loadBytes(
        fileWith(otherFingerprint()),
        liveFingerprint(),
        {respectLoadFlags: true});
    expect(accepted.accepted).to.equal(true);
    expect(accepted.reason).to.equal('verification-skipped');
    expect(accepted.matched).to.equal(false);
    expect(accepted.applied).to.deep.equal(['bvh', 'irradiance']);
    expect(accepted.skipped).to.deep.equal(['materials']);
    expect(open.has('materials')).to.equal(false);
    expect(new TextDecoder().decode(open.get('bvh')!.bytes)).to.equal('bvh');
  });

  test('clear removes one type or every type', () => {
    const store = new PathTracerCacheStore();
    store.setFlags({enabled: {bvh: true, irradiance: true, materials: true}});
    store.loadBytes(fileWith(liveFingerprint()), liveFingerprint());
    store.clear('bvh');
    expect(store.has('bvh')).to.equal(false);
    expect(store.has('irradiance')).to.equal(true);
    store.clear();
    expect(store.has('irradiance')).to.equal(false);
    expect(store.has('materials')).to.equal(false);
  });
});

suite('path tracer cache invalidation', () => {
  test(
      'follows the dependency matrix and never clears on camera motion', () => {
        expect(cacheTypesClearedBy('geometry')).to.deep.equal([
          'bvh',
          'irradiance',
        ]);
        expect(cacheTypesClearedBy('material-swap')).to.deep.equal([
          'irradiance',
          'materials',
        ]);
        expect(cacheTypesClearedBy('material-adjust')).to.deep.equal([
          'materials'
        ]);
        expect(cacheTypesClearedBy('environment')).to.deep.equal([
          'irradiance'
        ]);
        for (const reason of PATH_TRACER_CACHE_INVALIDATIONS) {
          expect(reason).to.not.equal('camera');
        }
        expect(PATH_TRACER_CACHE_DEPENDENCIES.bvh.geometry).to.equal(true);
        expect(PATH_TRACER_CACHE_DEPENDENCIES.bvh['material-swap'])
            .to.equal(false);
        expect(PATH_TRACER_CACHE_DEPENDENCIES.irradiance['material-adjust'])
            .to.equal(false);
        expect(PATH_TRACER_CACHE_DEPENDENCIES.irradiance.environment)
            .to.equal(true);
        expect(PATH_TRACER_CACHE_DEPENDENCIES.materials.geometry)
            .to.equal(false);
        expect(PATH_TRACER_CACHE_DEPENDENCIES.materials.environment)
            .to.equal(false);
      });

  test('store drops only the caches the reason names', () => {
    const store = new PathTracerCacheStore();
    store.setFlags({enabled: {bvh: true, irradiance: true, materials: true}});
    store.loadBytes(fileWith(liveFingerprint()), liveFingerprint());
    expect(store.invalidate('material-adjust')).to.deep.equal(['materials']);
    expect(store.has('bvh')).to.equal(true);
    expect(store.has('irradiance')).to.equal(true);
    expect(store.has('materials')).to.equal(false);

    store.loadBytes(fileWith(liveFingerprint()), liveFingerprint());
    store.invalidate('geometry');
    expect(store.has('bvh')).to.equal(false);
    expect(store.has('irradiance')).to.equal(false);
    expect(store.has('materials')).to.equal(true);

    store.invalidate('environment');
    expect(store.has('materials')).to.equal(true);
  });

  test('classifies colour edits separately from material replacement', () => {
    expect(classifyMaterialProperties({
      baseColorFactor: [1, 0, 0, 1]
    })).to.equal('material-adjust');
    expect(
        classifyMaterialProperties({color: '#fff', emissiveFactor: [0, 0, 0]}))
        .to.equal('material-adjust');
    expect(classifyMaterialProperties({
      roughnessFactor: 0.2
    })).to.equal('material-swap');
    expect(classifyMaterialProperties({
      baseColorFactor: [1, 0, 0, 1],
      metallicFactor: 1,
    })).to.equal('material-swap');
  });

  test(
      'a mesh material identity change is a swap and a colour change is an adjust',
      () => {
        const scene = new Scene();
        const mesh = new Mesh(
            new BoxGeometry(1, 1, 1),
            new MeshStandardMaterial({color: 0xff0000, roughness: 0.4}));
        mesh.name = 'body';
        scene.add(mesh);
        const before = sampleMaterialWatch(scene);
        mesh.material.color.set(0x00ff00);
        expect(diffMaterialWatch(before, sampleMaterialWatch(scene)))
            .to.equal('material-adjust');
        mesh.material =
            new MeshStandardMaterial({roughness: 0.9, metalness: 1});
        expect(diffMaterialWatch(before, sampleMaterialWatch(scene)))
            .to.equal('material-swap');
      });
});

suite('path tracer cache payloads', () => {
  test('restores a serialized BVH without rebuilding it', () => {
    const geometry = new BoxGeometry(1, 2, 3);
    const mesh = new Mesh(geometry, new MeshStandardMaterial());
    mesh.name = 'crate';
    geometry.boundsTree = new MeshBVH(geometry);
    const scene = new Scene();
    scene.add(mesh);
    const records = captureSceneBvh(scene);
    const encoded = encodeBvhRecords(records);
    const decoded = decodeBvhRecords(encoded);

    const copy = new Mesh(geometry.clone(), new MeshStandardMaterial());
    copy.name = 'crate';
    const restored = new Scene();
    restored.add(copy);
    const result = restoreSceneBvh(restored, decoded);
    expect(result.restored).to.equal(1);
    expect(result.missed).to.equal(0);
    expect(copy.geometry.boundsTree).to.not.equal(undefined);
    expect(encoded.byteLength).to.be.greaterThan(32);
  });

  test(
      'irradiance is stored without albedo so a colour change reshades it',
      () => {
        const albedo: [number, number, number] = [0.2, 0.4, 0.8];
        const irradiance: [number, number, number] = [1.5, 2, 0.5];
        const radiance = radianceFromIrradiance(irradiance, albedo);
        expect(irradianceFromRadiance(radiance, albedo)[0])
            .to.be.closeTo(1.5, 1e-6);

        const meta = {
          slots: 65536,
          origin: [0, 0, 0] as [number, number, number],
          cellSize: 1,
          minSamples: 1,
        };
        const grid = createIrradianceGrid();
        const position: [number, number, number] = [1.2, 0.4, 0.2];
        const normal: [number, number, number] = [0, 1, 0];
        accumulateIrradiance(grid, meta, position, normal, radiance, albedo);
        const read = readIrradiance(grid, meta, position, normal);
        expect(read).to.not.equal(null);
        expect(read![0]).to.be.closeTo(1.5, 1e-5);
        const repaint = radianceFromIrradiance(read!, [1, 0, 0]);
        expect(repaint[0]).to.be.closeTo(1.5, 1e-5);
        expect(repaint[1]).to.equal(0);

        const opposite = readIrradiance(grid, meta, position, [0, -1, 0]);
        expect(opposite).to.equal(null);
        expect(irradianceSlot(1, 2, 3, 0, 1, 0))
            .to.equal(irradianceSlot(1, 2, 3, 0.2, 0.9, 0.1));

        const payload = encodeIrradiancePayload(grid, meta);
        const decoded = decodeIrradiancePayload(payload.bytes, payload.meta);
        expect(decoded.grid[0]).to.equal(grid[0]);
        expect(payload.bytes.byteLength).to.equal(65536 * 8 * 4);
      });

  test('material records round-trip the factors the scene table uses', () => {
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial({
                            color: 0x336699,
                            roughness: 0.25,
                            metalness: 0.5,
                            name: 'paint',
                          }));
    mesh.name = 'panel';
    scene.add(mesh);
    const records = collectMaterialRecords(scene);
    const decoded = decodeMaterialRecords(encodeMaterialRecords(records));
    expect(decoded).to.deep.equal(records);
    expect(decoded[0].meshName).to.equal('panel');
    expect(decoded[0].roughness).to.be.closeTo(0.25, 1e-6);
    expect(hashMeshPositions(scene))
        .to.not.equal(hashMeshPositions(new Scene()));
  });
});
