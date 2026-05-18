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
import {NeutralToneMapping} from 'three';

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

});
