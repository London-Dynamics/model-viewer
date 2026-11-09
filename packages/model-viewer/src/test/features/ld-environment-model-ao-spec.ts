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
import {BoxGeometry, Mesh, MeshBasicMaterial} from 'three';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath, rafPasses} from '../helpers.js';

const waitFrames = async (count = 4) => {
  for (let i = 0; i < count; i++) {
    await rafPasses();
  }
};

const aoPassOf = (element: ModelViewerElement): {
  includeEnvironmentModel?: boolean; modelDepthTarget: object | null;
  aoMaterial: {
    defines: {AO_OCCLUSION_MASK?: number}; uniforms: {radius: {value: number}};
  };
} => {
  const pipeline = element[$scene].effectRenderer as {
    rasterDelegate?: {aoPass?: object};
  };
  const pass = pipeline?.rasterDelegate?.aoPass;
  expect(pass, 'AO pass should exist').to.not.equal(undefined);
  return pass as ReturnType<typeof aoPassOf>;
};

suite('environment-model-ao', function() {
  this.timeout(20000);

  let element: ModelViewerElement;

  setup(async () => {
    element = new ModelViewerElement();
    element.style.width = '160px';
    element.style.height = '160px';
    element.ambientOcclusion = true;
    element.interactionPrompt = 'none';
    document.body.insertBefore(element, document.body.firstChild);
    element.src = assetPath('models/cube.gltf');
    await waitForEvent(element, 'load');
    await element.updateComplete;
  });

  teardown(() => {
    element.remove();
  });

  test(
      'defaults to excluding the environment and toggles the live AO pass',
      async () => {
        const ground = new Mesh(
            new BoxGeometry(8, 0.2, 8),
            new MeshBasicMaterial({color: 0x884422}));
        ground.position.set(0, -0.6, 0);
        element[$scene].setEnvironmentModel(ground);
        await waitFrames();

        const excluded = aoPassOf(element);
        const radius = excluded.aoMaterial.uniforms.radius.value;
        expect(excluded.includeEnvironmentModel).to.equal(false);
        expect(excluded.modelDepthTarget).to.not.equal(null);
        expect(excluded.aoMaterial.defines.AO_OCCLUSION_MASK).to.equal(1);
        expect(element[$scene].boundingSphere.radius).to.be.lessThan(5);

        element.setAttribute('environment-model-ao', '');
        await element.updateComplete;
        await waitFrames();

        const included = aoPassOf(element);
        expect(included.includeEnvironmentModel).to.equal(true);
        expect(included.aoMaterial.defines.AO_OCCLUSION_MASK).to.equal(0);
        expect(included.aoMaterial.uniforms.radius.value).to.equal(radius);
        expect(element[$scene].boundingSphere.radius).to.be.lessThan(5);

        element.setAttribute('environment-model-ao', 'false');
        await element.updateComplete;
        await waitFrames();

        const restored = aoPassOf(element);
        expect(restored.includeEnvironmentModel).to.equal(false);
        expect(restored.modelDepthTarget).to.not.equal(null);
        expect(restored.aoMaterial.defines.AO_OCCLUSION_MASK).to.equal(1);
        expect(restored.aoMaterial.uniforms.radius.value).to.equal(radius);
      });

  test('AO and bloom share the same runtime toggle', async () => {
    element.bloom = true;
    element.setAttribute('environment-model-ao', 'true');
    await element.updateComplete;
    const ground = new Mesh(
        new BoxGeometry(6, 0.2, 6), new MeshBasicMaterial({color: 0x335533}));
    element[$scene].setEnvironmentModel(ground);
    await waitFrames();

    const included = aoPassOf(element);
    expect(included.includeEnvironmentModel).to.equal(true);
    expect(included.modelDepthTarget).to.equal(null);
    expect(included.aoMaterial.defines.AO_OCCLUSION_MASK).to.equal(0);

    (element as {environmentModelAo?: boolean}).environmentModelAo = false;
    await element.updateComplete;
    await waitFrames();

    const excluded = aoPassOf(element);
    expect(excluded.includeEnvironmentModel).to.equal(false);
    expect(excluded.modelDepthTarget).to.not.equal(null);
    expect(excluded.aoMaterial.defines.AO_OCCLUSION_MASK).to.equal(1);
  });
});
