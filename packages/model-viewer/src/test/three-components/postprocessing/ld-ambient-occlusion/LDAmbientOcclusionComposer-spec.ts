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
import {BoxGeometry, Group, Mesh, MeshBasicMaterial, NeutralToneMapping} from 'three';

import {AOPass} from '../../../../three-components/postprocessing/ld-ambient-occlusion/AOPass.js';
import {LDAmbientOcclusionComposer} from '../../../../three-components/postprocessing/ld-ambient-occlusion/LDAmbientOcclusionComposer.js';

suite('LDAmbientOcclusionComposer', () => {
  test('renders diffuse output via the direct renderer path', () => {
    const composer = new LDAmbientOcclusionComposer();

    let rendererRenderCalls = 0;
    let effectComposerRenderCalls = 0;

    const renderer = {
      autoClear: false,
      toneMapping: null,
      toneMappingExposure: 0,
      getViewport: () => ({x: 0, y: 0, z: 1, w: 1}),
      copyFramebufferToTexture: () => {},
      render: () => {
        rendererRenderCalls++;
      },
    };
    const scene = {
      toneMapping: NeutralToneMapping,
      exposure: 1,
      element: {
        environmentImage: null,
        skyboxImage: null,
      },
    };
    const camera = {name: 'camera'};
    const effectComposer = {
      render: () => {
        effectComposerRenderCalls++;
      },
    };

    (composer as any).renderer = renderer;
    (composer as any).scene = scene;
    (composer as any).camera = camera;
    (composer as any).composer = effectComposer;
    (composer as any).aoPass = {output: (AOPass as any).OUTPUT.Diffuse};

    composer.render();

    expect(rendererRenderCalls).to.be.equal(1);
    expect(effectComposerRenderCalls).to.be.equal(0);
    expect(renderer.autoClear).to.be.equal(true);
  });

  test('renders composite output through the effect composer path', () => {
    const composer = new LDAmbientOcclusionComposer();

    let effectComposerRenderCalls = 0;

    const renderer = {
      autoClear: false,
      toneMapping: null,
      toneMappingExposure: 0,
    };
    const scene = {
      toneMapping: NeutralToneMapping,
      exposure: 1,
      element: {
        environmentImage: null,
        skyboxImage: null,
      },
    };
    const camera = {name: 'camera'};
    const effectComposer = {
      render: () => {
        effectComposerRenderCalls++;
      },
    };
    (composer as any).renderer = renderer;
    (composer as any).scene = scene;
    (composer as any).camera = camera;
    (composer as any).composer = effectComposer;
    (composer as any).aoPass = {
      output: (AOPass as any).OUTPUT.Default,
    };

    composer.render();

    expect(effectComposerRenderCalls).to.be.equal(1);
  });

  test(
      'scales the sample radius from the src model sphere, not the environment',
      () => {
        const composer = new LDAmbientOcclusionComposer();
        const environment = new Group();
        environment.add(
            new Mesh(new BoxGeometry(220, 2, 220), new MeshBasicMaterial()));
        let scaledRadius = NaN;
        let scaledThickness = NaN;
        (composer as unknown as {
          scene: object;
          aoPass: object
        }).scene = {
          boundingSphere: {radius: 4},
          environmentRoot: environment,
        };
        (composer as unknown as {aoPass: object}).aoPass = {
          intensity: 0,
          output: 0,
          updateAoMaterial(params: {radius: number; thickness: number}) {
            scaledRadius = params.radius;
            scaledThickness = params.thickness;
          },
          updatePdMaterial() {},
        };

        composer.updateOptions({radius: 4, thickness: 10});

        // ao-radius 4 / max(src radius 4, 0.5) * 0.1
        expect(scaledRadius).to.be.closeTo(0.1, 1e-6);
        // thickness uses the same src-model scale
        expect(scaledThickness).to.be.closeTo(0.25, 1e-6);
      });

  test(
      'keeps the src-model radius when the environment is included in AO',
      () => {
        const composer = new LDAmbientOcclusionComposer();
        const environment = new Group();
        environment.add(
            new Mesh(new BoxGeometry(220, 2, 220), new MeshBasicMaterial()));
        let scaledRadius = NaN;
        const aoPass: {
          includeEnvironmentModel?: boolean; intensity: number; output: number;
          updateAoMaterial(params: {radius: number}): void;
          updatePdMaterial(): void;
        } = {
          intensity: 0,
          output: 0,
          updateAoMaterial(params: {radius: number}) {
            scaledRadius = params.radius;
          },
          updatePdMaterial() {},
        };
        (composer as unknown as {
          scene: object;
          aoPass: object
        }).scene = {
          boundingSphere: {radius: 4},
          environmentRoot: environment,
        };
        (composer as unknown as {aoPass: object}).aoPass = aoPass;

        composer.updateOptions({
          radius: 4,
          thickness: 10,
          includeEnvironmentModel: true,
        } as {
          radius: number;
          thickness: number
        });

        expect(scaledRadius).to.be.closeTo(0.1, 1e-6);
        expect(aoPass.includeEnvironmentModel).to.equal(true);
      });
});
