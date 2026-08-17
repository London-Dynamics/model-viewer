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
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3
} from 'three';
import {USDZExporter} from 'three/examples/jsm/exporters/USDZExporter.js';

import {IS_ANDROID, IS_IOS} from '../../constants.js';
import {$openIOSARQuickLook, $openSceneViewer} from '../../features/ar.js';
import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath, rafPasses, spy} from '../helpers.js';

suite('AR', () => {
  let element: ModelViewerElement;
  let intentUrls: Array<string>;
  let restoreAnchorClick: () => void;

  setup(() => {
    element = new ModelViewerElement();
    document.body.insertBefore(element, document.body.firstChild);
    intentUrls = [];
    restoreAnchorClick = spy(HTMLAnchorElement.prototype, 'click', {
      value: function() {
        intentUrls.push((this as HTMLAnchorElement).href);
      }
    });
  });

  teardown(() => {
    if (element.parentNode != null) {
      element.parentNode.removeChild(element);
    }
    restoreAnchorClick();
  });

  suite('openSceneViewer', () => {
    test('preserves query parameters in model URLs', () => {
      element.src = 'https://example.com/model.gltf?token=foo';
      element.alt = 'Example model';
      (element as any)[$openSceneViewer]();

      expect(intentUrls.length).to.be.equal(1);

      const search = new URLSearchParams(new URL(intentUrls[0]).search);

      expect(search.get('token')).to.equal('foo');
    });

    test('keeps title and link when supplied', () => {
      element.src =
          'https://example.com/model.gltf?link=http://linkme.com&title=bar';
      element.alt = 'alt';
      (element as any)[$openSceneViewer]();

      expect(intentUrls.length).to.be.equal(1);

      const search = new URLSearchParams(new URL(intentUrls[0]).search);

      expect(search.get('title')).to.equal('bar');
      expect(search.get('link')).to.equal('http://linkme.com/');
    });

    test('sets sound and link to absolute URLs', () => {
      element.src =
          'https://example.com/model.gltf?link=foo.html&sound=bar.ogg';
      element.alt = 'alt';
      (element as any)[$openSceneViewer]();

      expect(intentUrls.length).to.be.equal(1);

      const search = new URLSearchParams(new URL(intentUrls[0]).search);

      // Tests run in different locations
      expect(search.get('sound')).to.contain('http://');
      expect(search.get('sound')).to.contain('/bar.ogg');
      expect(search.get('link')).to.contain('http://');
      expect(search.get('link')).to.contain('/foo.html');
    });

    test('strips hash params from SceneViewer model src', () => {
      element.src =
          'https://example.com/model.gltf#applePayButtonType=plain&checkoutTitle=TitleText';
      element.alt = 'alt';
      (element as any)[$openSceneViewer]();

      expect(intentUrls.length).to.be.equal(1);

      const search = new URLSearchParams(new URL(intentUrls[0]).search);
      const file = new URL(search.get('file') as any);

      expect(file.hash).to.equal('');
    });

    test('strips hash params but preserves query params', () => {
      element.src =
          'https://example.com/model.gltf?link=http://linkme.com&title=bar#applePayButtonType=plain&checkoutTitle=TitleText';
      element.alt = 'alt';
      (element as any)[$openSceneViewer]();

      expect(intentUrls.length).to.be.equal(1);

      const search = new URLSearchParams(new URL(intentUrls[0]).search);
      const file = new URL(search.get('file') as any);

      expect(file.hash).to.equal('');
      expect(search.get('title')).to.equal('bar');
      expect(search.get('link')).to.equal('http://linkme.com/');
    });

    test('uses ar-src for Scene Viewer file when set', () => {
      element.src = 'https://example.com/room.glb';
      element.arSrc = 'https://example.com/arrangement.glb';
      element.alt = 'alt';
      (element as any)[$openSceneViewer]();

      expect(intentUrls.length).to.be.equal(1);

      const search = new URLSearchParams(new URL(intentUrls[0]).search);
      const file = new URL(search.get('file') as any);

      expect(file.href).to.equal('https://example.com/arrangement.glb');
    });

    test('falls back to src when ar-src is unset', () => {
      element.src = 'https://example.com/room.glb';
      element.arSrc = null;
      element.alt = 'alt';
      (element as any)[$openSceneViewer]();

      expect(intentUrls.length).to.be.equal(1);

      const search = new URLSearchParams(new URL(intentUrls[0]).search);
      const file = new URL(search.get('file') as any);

      expect(file.href).to.equal('https://example.com/room.glb');
    });
  });

  suite('openQuickLook', () => {
    test('sets hash for fixed scale', () => {
      element.src = 'https://example.com/model.gltf';
      element.iosSrc = 'https://example.com/model.usdz';
      element.arScale = 'fixed';
      (element as any)[$openIOSARQuickLook]();

      expect(intentUrls.length).to.be.equal(1);

      const url = new URL(intentUrls[0]);

      expect(url.pathname).equal('/model.usdz');
      expect(url.hash).to.equal('#allowsContentScaling=0');
    });

    test('keeps original hash too', () => {
      element.src = 'https://example.com/model.gltf';
      element.iosSrc =
          'https://example.com/model.usdz#custom=path-to-banner.html';
      element.arScale = 'fixed';
      (element as any)[$openIOSARQuickLook]();

      expect(intentUrls.length).to.be.equal(1);

      const url = new URL(intentUrls[0]);

      expect(url.pathname).equal('/model.usdz');
      expect(url.hash).to.equal(
          '#custom=path-to-banner.html&allowsContentScaling=0');
    });

    test('replicate src hash to usdz blob url', async () => {
      element.src =
          assetPath('models/cube.gltf') + '#custom=path-to-banner.html';
      element.arModes = 'webxr scene-viewer quick-look';

      await (element as any)[$openIOSARQuickLook]();

      expect(intentUrls.length).to.be.equal(1);

      const url = new URL(intentUrls[0]);

      expect(url.protocol).to.equal('blob:');

      expect(url.hash).to.equal('#custom=path-to-banner.html');
    });

    test(
        'replicate src hash to usdz blob and set hash for fixed scale',
        async () => {
          element.src =
              assetPath('models/cube.gltf') + '#custom=path-to-banner.html';
          element.arModes = 'webxr scene-viewer quick-look';
          element.arScale = 'fixed';

          await (element as any)[$openIOSARQuickLook]();

          expect(intentUrls.length).to.be.equal(1);

          const url = new URL(intentUrls[0]);

          expect(url.protocol).to.equal('blob:');

          expect(url.hash).to.equal(
              '#custom=path-to-banner.html&allowsContentScaling=0');
        });
  });

  suite('prepareUSDZ', () => {
    test(
        'configures the USDZ exporter to decompress compressed textures',
        async () => {
          element.src = assetPath('models/cube.gltf');
          await waitForEvent(element, 'poster-dismissed');

          let textureUtils: {decompress?: Function}|undefined;
          const restoreSetTextureUtils =
              spy(USDZExporter.prototype, 'setTextureUtils', {
                value: function(utils: {decompress?: Function}) {
                  textureUtils = utils;
                  (this as any).textureUtils = utils;
                }
              });

          try {
            const url = await (element as any).prepareUSDZ();
            URL.revokeObjectURL(url);
          } finally {
            restoreSetTextureUtils();
          }

          expect(textureUtils).to.not.be.undefined;
          expect(textureUtils!.decompress).to.be.a('function');
        });

    test('hides and restores the environment model', async () => {
      element.src = assetPath('models/cube.gltf');
      await waitForEvent(element, 'poster-dismissed');

      const scene = element[$scene];
      scene.setEnvironmentModel(
          new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));

      const visibility: boolean[] = [];
      const original = scene.setEnvironmentModelVisible.bind(scene);
      scene.setEnvironmentModelVisible = (visible: boolean) => {
        visibility.push(visible);
        original(visible);
      };

      const url = await (element as any).prepareUSDZ();
      URL.revokeObjectURL(url);

      expect(visibility).to.deep.equal([false, true]);
      expect(scene.environmentRoot.visible).to.equal(true);
    });

    test(
        'hides the room and restores it when src-is-room', async () => {
          element.src = assetPath('models/cube.gltf');
          element.srcIsRoom = true;
          await waitForEvent(element, 'poster-dismissed');

          const scene = element[$scene];
          scene.target.add(
              new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial()));

          const visibility: boolean[] = [];
          const original = scene.setBaseModelVisible.bind(scene);
          scene.setBaseModelVisible = (visible: boolean) => {
            visibility.push(visible);
            original(visible);
          };

          const url = await (element as any).prepareUSDZ();
          URL.revokeObjectURL(url);

          expect(visibility).to.deep.equal([false, true]);
          expect(scene.model!.visible).to.equal(true);
          expect(scene.model!.parent).to.equal(scene.target);
        });

    test(
        'exports src-is-room placed children with distinct world transforms',
        async () => {
          element.src = assetPath('models/cube.gltf');
          element.srcIsRoom = true;
          await waitForEvent(element, 'poster-dismissed');

          const scene = element[$scene];
          const placements = [
            {name: 'bike', position: [0, 0, -3.168], scale: [1, 1, 1]},
            {name: 'runner', position: [2.739, 0, -3.055], scale: [1, 1, 1]},
            {
              name: 'elliptical',
              position: [-2.377, 0, -2.832],
              scale: [1.25, 1.25, 1.25]
            },
            {
              name: 'cycle',
              position: [1.209, 0, -2.734],
              scale: [0.75, 0.75, 0.75]
            },
          ];

          for (const placement of placements) {
            const mesh = new Mesh(
                new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial());
            mesh.name = placement.name;
            mesh.position.fromArray(placement.position);
            mesh.scale.fromArray(placement.scale);
            scene.target.add(mesh);
          }

          let exportedObjectIsTarget = false;
          let exportedChildNames: string[] = [];
          const exportedTransforms = new Map<
              string, {position: number[], scale: number[]}>();
          const restoreParseAsync =
              spy(USDZExporter.prototype, 'parseAsync', {
                value: async function(object: Object3D) {
                  exportedObjectIsTarget = object === scene.target;
                  exportedChildNames = object.children.map(child => child.name);

                  for (const child of object.children) {
                    const worldPosition = new Vector3();
                    const worldScale = new Vector3();
                    child.matrixWorld.decompose(
                        worldPosition, new Quaternion(), worldScale);
                    exportedTransforms.set(child.name, {
                      position: worldPosition.toArray(),
                      scale: worldScale.toArray()
                    });
                  }

                  return new ArrayBuffer(0);
                }
              });

          try {
            const url = await (element as any).prepareUSDZ();
            URL.revokeObjectURL(url);
          } finally {
            restoreParseAsync();
          }

          expect(exportedObjectIsTarget).to.equal(true);
          expect(exportedChildNames)
              .to.have.members(placements.map(placement => placement.name));

          for (const placement of placements) {
            const transform = exportedTransforms.get(placement.name)!;

            expect(transform.position).to.deep.equal(placement.position);
            expect(transform.scale).to.deep.equal(placement.scale);
          }
        });
  });

  suite('shows the AR button', () => {
    setup(async () => {
      element.ar = true;
      element.src = assetPath('models/Astronaut.glb');

      await waitForEvent(element, 'poster-dismissed');
    });

    test('on Android', () => {
      expect(element.canActivateAR).to.be.equal(IS_ANDROID);
    });

    // This only works on a physical iOS device, not an emulated one.
    test.skip('with an ios-src on iOS', async () => {
      element.iosSrc = assetPath('models/Astronaut.usdz');
      await rafPasses();
      expect(element.canActivateAR).to.be.equal(IS_ANDROID || IS_IOS);
    });
  });
});
