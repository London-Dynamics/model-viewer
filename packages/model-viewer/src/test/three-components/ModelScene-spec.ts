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
import {Matrix4, Mesh, OrthographicCamera, SphereGeometry, Vector3} from 'three';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {ModelScene} from '../../three-components/ModelScene.js';
import {assetPath} from '../helpers.js';

suite('ModelScene', () => {
  let element: ModelViewerElement;
  let scene: ModelScene;
  let dummyRadius: number;
  let dummyMesh: Mesh;

  setup(() => {
    // Set the radius of the sphere to 0.5 so that it's size is 1
    // for testing scaling.
    dummyRadius = 0.5;
    dummyMesh = new Mesh(new SphereGeometry(dummyRadius, 32, 32));
    element = new ModelViewerElement();
    scene = element[$scene];

    document.body.insertBefore(element, document.body.firstChild);
  });

  teardown(() => {
    document.body.removeChild(element);
  });

  suite('with a model', () => {
    setup(async () => {
      await scene.setSource(assetPath('models/Astronaut.glb'));
    });

    suite('setShadowIntensity', () => {
      test('can increase intensity and reset it to zero', () => {
        scene.setShadowIntensity(1);
        const shadow = scene.shadow!;
        expect(shadow).to.be.ok;
        expect(shadow.getIntensity()).to.be.equal(1);
        scene.setShadowIntensity(0);
        expect(shadow.getIntensity()).to.be.equal(0);
      });

      test('shadow is only created when intensity is greater than zero', () => {
        expect(scene.shadow).to.be.not.ok;
        scene.setShadowIntensity(1);
        expect(scene.shadow).to.be.ok;
      });
    });
  });

  suite('setSize', () => {
    test('updates visual and buffer size', () => {
      scene.setSize(500, 200);
      expect(scene.width).to.be.equal(500);
      expect(scene.height).to.be.equal(200);
    });

    test('model is not scaled', async () => {
      dummyMesh.geometry.applyMatrix4(new Matrix4().makeScale(1, 3, 10));
      await scene.setObject(dummyMesh);

      scene.setSize(1000, 500);
      expect(scene.scale).to.be.eql(new Vector3(1, 1, 1));
    });

    test('idealCameraDistance is set correctly', async () => {
      await scene.setObject(dummyMesh);

      scene.framedFoVDeg = 25;
      const halfFov = (scene.framedFoVDeg / 2) * Math.PI / 180;
      const expectedDistance = dummyRadius / Math.sin(halfFov);
      expect(scene.idealCameraDistance())
          .to.be.closeTo(expectedDistance, 0.0001);
    });

    test('idealAspect is set correctly', async () => {
      scene.framedFoVDeg = 25;
      await scene.setObject(dummyMesh);

      expect(scene.idealAspect).to.be.closeTo(1, 0.001);
    });

    test('cannot set the canvas smaller than 1x1', () => {
      scene.setSize(0, 0);
      expect(scene.width).to.be.equal(1);
      expect(scene.height).to.be.equal(1);
    });
  });

  suite('orthographic resize', () => {
    setup(async () => {
      scene.setSize(800, 600);
      await scene.setObject(dummyMesh);
      scene.camera.position.set(0, 0, 5);
      scene.setCameraType('orthographic');
    });

    test('setCameraType produces world-unit frustum, not pixel dimensions', () => {
      const camera = scene.camera as OrthographicCamera;
      expect(camera.top).to.be.lessThan(50);
      expect(camera.top).to.not.be.closeTo(scene.height / 2, 1);
    });

    test('resize preserves vertical extent and adjusts horizontal for aspect', () => {
      const camera = scene.camera as OrthographicCamera;
      const topBefore = camera.top;
      const bottomBefore = camera.bottom;

      scene.setSize(801, 600);

      expect(camera.top).to.be.closeTo(topBefore, 0.0001);
      expect(camera.bottom).to.be.closeTo(bottomBefore, 0.0001);
      expect(camera.right - camera.left)
          .to.be.closeTo((camera.top - camera.bottom) * scene.aspect, 0.0001);
    });

    test('updateOrthographicFrustum scales vertical extent by fovRatio', () => {
      const camera = scene.camera as OrthographicCamera;
      const halfHeightBefore = camera.top;
      const fovRatio = 1.25;

      scene.updateOrthographicFrustum(halfHeightBefore * fovRatio);

      expect(camera.top).to.be.closeTo(halfHeightBefore * fovRatio, 0.0001);
      expect(camera.bottom).to.be.closeTo(-halfHeightBefore * fovRatio, 0.0001);
      expect(camera.right - camera.left)
          .to.be.closeTo(2 * halfHeightBefore * fovRatio * scene.aspect, 0.0001);
    });
  });
});
