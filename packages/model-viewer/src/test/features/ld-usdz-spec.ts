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
import {Box3, Vector3} from 'three';
import {strToU8, zipSync} from 'three/examples/jsm/libs/fflate.module.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';

import {convertUsdzToGlb} from '../../features/ld-usdz/convert-usdz.js';
import {isUsdzContentType, urlExtension} from '../../features/ld-usdz/detect-usdz.js';
import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath, until} from '../helpers.js';

const GLB_MAGIC = 0x46546c67;

const TRIANGLE_Z_UP = `#usda 1.0
(
    upAxis = "Z"
)
def Xform "Root"
{
    def Material "Mat"
    {
        token outputs:surface.connect = </Root/Mat/Shader.outputs:surface>
        def Shader "Shader"
        {
            uniform token info:id = "UsdPreviewSurface"
            float inputs:opacity = 0.4
            color3f inputs:diffuseColor = (0.2, 0.4, 0.8)
        }
    }
    def Mesh "Tri"
    {
        int[] faceVertexCounts = [3]
        int[] faceVertexIndices = [0, 1, 2]
        point3f[] points = [(0, 0, 0), (1, 0, 0), (0, 0, 1)]
        rel material:binding = </Root/Mat>
    }
}
`;

const TRIANGLE_CM = `#usda 1.0
(
    metersPerUnit = 0.01
    upAxis = "Y"
)
def Mesh "Tri"
{
    int[] faceVertexCounts = [3]
    int[] faceVertexIndices = [0, 1, 2]
    point3f[] points = [(0, 0, 0), (0, 100, 0), (100, 0, 0)]
}
`;

const TRIANGLE_NO_UNITS = `#usda 1.0
(
    defaultPrim = "Root"
)
def Mesh "Tri"
{
    int[] faceVertexCounts = [3]
    int[] faceVertexIndices = [0, 1, 2]
    point3f[] points = [(0, 0, 0), (0, 2, 0), (0, 0, 0)]
}
`;

const usdzBlob = (usda: string): Blob => {
  const zipped = zipSync({'model.usda': strToU8(usda)}, {level: 0});
  return new Blob([zipped], {type: 'model/vnd.usdz+zip'});
};

const gltfLoader = new GLTFLoader();

const parseGlb = (blob: Blob) => blob.arrayBuffer().then(
    (buffer) =>
        new Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>(
            (resolve, reject) => {
              gltfLoader.parse(buffer, '', resolve, reject);
            }));

const worldSize = (root: import('three').Object3D): Vector3 => {
  const size = new Vector3();
  new Box3().setFromObject(root).getSize(size);
  return size;
};

const survey = (root: import('three').Object3D) => {
  let meshes = 0;
  let textured = 0;
  const materials = new Set<import('three').Material>();
  root.traverse((object) => {
    const mesh = object as import('three').Mesh;
    if (mesh.isMesh !== true) {
      return;
    }
    meshes++;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of list) {
      if (material == null) {
        continue;
      }
      materials.add(material);
      if ((material as {map?: unknown}).map != null) {
        textured++;
      }
    }
  });
  return {meshes, materials: materials.size, textured};
};

suite('USDZ to GLB', function() {
  this.timeout(60000);

  suite('convertUsdzToGlb', () => {
    test('url helpers recognise USDZ locations', () => {
      expect(urlExtension('https://example.com/room.usdz?token=1'))
          .to.equal('usdz');
      expect(urlExtension('/models/cube.glb')).to.equal('glb');
      expect(isUsdzContentType('model/vnd.usdz+zip; charset=binary'))
          .to.be.true;
      expect(isUsdzContentType('model/gltf-binary')).to.be.false;
    });

    test(
        'converts text USDA, keeping opacity and rotating Z-up onto Y',
        async () => {
          const started = performance.now();
          const glb = await convertUsdzToGlb(usdzBlob(TRIANGLE_Z_UP));
          const elapsed = performance.now() - started;
          expect(glb.type).to.equal('model/gltf-binary');
          const bytes = await glb.arrayBuffer();
          expect(new DataView(bytes).getUint32(0, true)).to.equal(GLB_MAGIC);

          const {scene} = await parseGlb(glb);
          const counts = survey(scene);
          expect(counts.meshes).to.equal(1);
          expect(counts.materials).to.equal(1);
          const size = worldSize(scene);
          expect(size.y).to.be.closeTo(1, 1e-3);
          expect(size.z).to.be.closeTo(0, 1e-3);
          let opacity = 1;
          scene.traverse((object) => {
            const mesh = object as import('three').Mesh;
            if (mesh.isMesh === true && !Array.isArray(mesh.material)) {
              opacity = mesh.material.opacity;
            }
          });
          expect(opacity).to.be.closeTo(0.4, 1e-3);
          console.log(`triangle USDA convert ${elapsed.toFixed(1)} ms`);
        });

    test('scales a stage metersPerUnit and can override it', async () => {
      const file = usdzBlob(TRIANGLE_CM);
      const staged =
          worldSize((await parseGlb(await convertUsdzToGlb(file))).scene);
      expect(staged.x).to.be.closeTo(1, 1e-3);
      expect(staged.y).to.be.closeTo(1, 1e-3);

      const overridden = worldSize(
          (await parseGlb(await convertUsdzToGlb(file, {metersPerUnit: 1})))
              .scene);
      expect(overridden.y).to.be.closeTo(100, 1e-2);
    });

    test('treats a missing metersPerUnit as meters', async () => {
      const size = worldSize(
          (await parseGlb(await convertUsdzToGlb(usdzBlob(TRIANGLE_NO_UNITS))))
              .scene);
      expect(size.y).to.be.closeTo(2, 1e-3);
    });

    test('upAxis option replaces the stage correction', async () => {
      const size = worldSize((await parseGlb(await convertUsdzToGlb(
                                  usdzBlob(TRIANGLE_Z_UP), {upAxis: 'Y'})))
                                 .scene);
      expect(size.z).to.be.closeTo(1, 1e-3);
      expect(size.y).to.be.closeTo(0, 1e-3);
    });

    test(
        'converts three.js text USDZ sample (saeukkang) with a texture',
        async () => {
          const response = await fetch(assetPath('models/saeukkang.usdz'));
          const started = performance.now();
          const glb = await convertUsdzToGlb(await response.arrayBuffer());
          const elapsed = performance.now() - started;
          const {scene} = await parseGlb(glb);
          const counts = survey(scene);
          expect(counts.meshes).to.be.greaterThan(0);
          expect(counts.materials).to.be.greaterThan(0);
          expect(counts.textured).to.be.greaterThan(0);
          console.log(
              `saeukkang ${
                  response.headers.get('content-length')} bytes -> glb ${
                  glb.size} bytes in ${elapsed.toFixed(1)} ms`,
              counts);
        });

    test(
        'converts binary USDC (Astronaut.usdz) with a texture and meters',
        async () => {
          const response = await fetch(assetPath('models/Astronaut.usdz'));
          const bytes = await response.arrayBuffer();
          const started = performance.now();
          const glb = await convertUsdzToGlb(bytes);
          const elapsed = performance.now() - started;
          const {scene} = await parseGlb(glb);
          const counts = survey(scene);
          const size = worldSize(scene);
          const longest = Math.max(size.x, size.y, size.z);
          expect(counts.meshes).to.be.greaterThan(0);
          expect(counts.materials).to.be.greaterThan(0);
          expect(counts.textured).to.be.greaterThan(0);
          // This crate does not publish metersPerUnit, so file units stay
          // (about 192). metersPerUnit replaces that scale.
          expect(longest).to.be.greaterThan(100);
          const scaled =
              worldSize((await parseGlb(await convertUsdzToGlb(bytes, {
                          metersPerUnit: 0.01
                        }))).scene);
          expect(Math.max(scaled.x, scaled.y, scaled.z))
              .to.be.closeTo(longest * 0.01, 0.05);
          console.log(
              `astronaut usdc -> glb ${glb.size} bytes in ${
                  elapsed.toFixed(1)} ms`,
              counts,
              size.toArray());
        });
  });

  suite('model-viewer src', () => {
    let element: ModelViewerElement;

    setup(() => {
      element = new ModelViewerElement();
      element.loading = 'eager';
      element.style.width = '200px';
      element.style.height = '200px';
      document.body.appendChild(element);
    });

    teardown(() => {
      element.remove();
    });

    test('loads a .usdz src through the GLB pipeline', async () => {
      const loaded = waitForEvent(element, 'load');
      element.src = assetPath('models/triangle-z-up.usdz');
      const event = await loaded;
      expect((event as CustomEvent).detail.url).to.equal(element.src);
      expect(element[$scene].url).to.equal(element.src);
      const model = element[$scene].model!;
      const counts = survey(model);
      expect(counts.meshes).to.equal(1);
      const size = worldSize(model);
      expect(size.y).to.be.closeTo(1, 1e-2);
    });

    test('loads a USDZ blob URL from its content type', async () => {
      const url = URL.createObjectURL(usdzBlob(TRIANGLE_NO_UNITS));
      try {
        const loaded = waitForEvent(element, 'load');
        element.src = url;
        await loaded;
        expect(element[$scene].url).to.equal(url);
        const size = worldSize(element[$scene].model!);
        expect(size.y).to.be.closeTo(2, 1e-2);
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    test('usdz-meters-per-unit overrides the stage scale', async () => {
      const url = URL.createObjectURL(usdzBlob(TRIANGLE_CM));
      try {
        element.usdzMetersPerUnit = 1;
        const loaded = waitForEvent(element, 'load');
        element.src = url;
        await loaded;
        const size = worldSize(element[$scene].model!);
        expect(size.y).to.be.closeTo(100, 1e-1);
      } finally {
        URL.revokeObjectURL(url);
      }
    });

    test('a failed USDZ dispatches a usdzconversion error', async () => {
      const errored = waitForEvent<CustomEvent>(element, 'error');
      element.src = assetPath('models/invalid.usdz');
      const event = await errored;
      expect(event.detail.type).to.equal('usdzconversion');
      expect(event.detail.issues[0].code).to.equal('usdz-conversion');
      expect(String(event.detail.issues[0].message)).to.match(/USDZ/i);
      expect(element[$scene].url).to.equal(element.src);
    });

    test('ios-src USDZ is not converted or used as the model', async () => {
      const loaded = waitForEvent(element, 'load');
      element.iosSrc = assetPath('models/Astronaut.usdz');
      element.src = assetPath('models/cube.gltf');
      await loaded;
      expect(element[$scene].url).to.equal(assetPath('models/cube.gltf'));
      await until(() => element.loaded);
      expect(element.iosSrc).to.equal(assetPath('models/Astronaut.usdz'));
    });

    test('a glb src is unchanged', async () => {
      const loaded = waitForEvent(element, 'load');
      const src = assetPath('models/cube.gltf');
      element.src = src;
      await loaded;
      expect(element[$scene].url).to.equal(src);
    });
  });
});
