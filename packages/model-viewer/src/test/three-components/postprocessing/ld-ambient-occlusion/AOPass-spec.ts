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
import {BoxGeometry, Color, DepthTexture, Group, Mesh, MeshBasicMaterial, NoToneMapping, Object3D, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, WebGLRenderTarget,} from 'three';

import {AOPass} from '../../../../three-components/postprocessing/ld-ambient-occlusion/AOPass.js';
import {AOShader} from '../../../../three-components/postprocessing/ld-ambient-occlusion/AOShader.js';

const WIDTH = 160;
const HEIGHT = 160;

const canvas = document.createElement('canvas');
canvas.width = WIDTH;
canvas.height = HEIGHT;

/**
 * Two walls that open toward +Z, so the inner corner self-occludes.
 * Returns a point on the back wall next to the side wall.
 */
const addCorner =
    (parent: Object3D, origin: Vector3, material: MeshBasicMaterial): void => {
      const back = new Mesh(new BoxGeometry(1.4, 1.4, 0.16), material);
      back.position.copy(origin);
      const side = new Mesh(new BoxGeometry(0.16, 1.4, 1.4), material);
      side.position.set(origin.x - 0.7, origin.y, origin.z + 0.62);
      parent.add(back, side);
    };

const readTarget =
    (renderer: WebGLRenderer, target: WebGLRenderTarget): Uint8Array => {
      const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
      renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);
      return pixels;
    };

const maxChannelDrop =
    (before: Uint8Array,
     after: Uint8Array,
     channel: number,
     minBefore: number): number => {
      let maxDrop = 0;
      let hits = 0;
      for (let i = 0; i < before.length; i += 4) {
        if (before[i + channel] < minBefore) {
          continue;
        }
        // Ignore pixels that are not dominated by this channel, so the red
        // environment and green model can be measured separately.
        const other = channel === 0 ? before[i + 1] : before[i];
        if (other > 40) {
          continue;
        }
        hits++;
        maxDrop = Math.max(maxDrop, before[i + channel] - after[i + channel]);
      }
      expect(hits).to.be.greaterThan(20, 'expected geometry to cover the view');
      return maxDrop;
    };

suite('AOPass src-model isolation', function() {
  this.timeout(20000);

  let renderer: WebGLRenderer;
  const disposables: Array<{dispose(): void}> = [];

  suiteSetup(() => {
    renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
    });
    renderer.setSize(WIDTH, HEIGHT, false);
    renderer.setPixelRatio(1);
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setClearColor(new Color(0x000000), 1);
    renderer.debug.checkShaderErrors = true;
  });

  suiteTeardown(() => {
    renderer.dispose();
  });

  teardown(() => {
    for (const item of disposables) {
      item.dispose();
    }
    disposables.length = 0;
  });

  const track = <T extends {dispose(): void}>(item: T): T => {
    disposables.push(item);
    return item;
  };

  const renderComposite = (scene: Scene, includeEnvironmentModel = false): {
    beauty: Uint8Array,
    composite: Uint8Array,
    sceneRenders: number,
    usedModelDepthPass: boolean,
    occlusionMask: number,
    samplesSceneDepth: boolean,
  } => {
    const camera = new PerspectiveCamera(50, 1, 0.1, 50);
    camera.position.set(0, 0.15, 5.2);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    const depthTexture = track(new DepthTexture(WIDTH, HEIGHT));
    const beautyTarget = track(new WebGLRenderTarget(WIDTH, HEIGHT, {
      depthTexture,
      samples: 0,
    }));
    const outputTarget =
        track(new WebGLRenderTarget(WIDTH, HEIGHT, {samples: 0}));

    renderer.setRenderTarget(beautyTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    const beauty = readTarget(renderer, beautyTarget);

    const pass =
        new AOPass(
            scene, camera, WIDTH, HEIGHT, undefined, undefined, undefined) as
            AOPass &
    {
      output: number;
      intensity: number;
      includeEnvironmentModel: boolean;
      modelDepthTarget: WebGLRenderTarget|null;
      depthTexture: DepthTexture;
      aoMaterial: {defines: {AO_OCCLUSION_MASK?: number}};
      setGBuffer(depthTexture: DepthTexture, normalTexture: undefined): void;
      updateAoMaterial(parameters: object): void;
      render(
          renderer: WebGLRenderer,
          writeBuffer: WebGLRenderTarget,
          readBuffer: WebGLRenderTarget): void;
    };
    pass.setGBuffer(depthTexture, undefined);
    pass.includeEnvironmentModel = includeEnvironmentModel;
    pass.output =
        (AOPass as unknown as {OUTPUT: {Default: number}}).OUTPUT.Default;
    pass.intensity = 1;
    pass.updateAoMaterial({
      algorithm: AOShader.ALGORITHM.SAO,
      radius: 1.25,
      distanceExponent: 1,
      thickness: 8,
      distanceFallOff: 0.25,
      bias: 0.005,
      scale: 1,
      samples: 16,
      nvAlignedSamples: 1,
      screenSpaceRadius: 0,
    });
    const originalRender = renderer.render.bind(renderer);
    let sceneRenders = 0;
    renderer.render =
        ((...args: unknown[]) => {
          if (args[0] === scene) {
            sceneRenders++;
          }
          return (originalRender as (...renderArgs: unknown[]) => void)(
              ...args);
        }) as typeof renderer.render;
    try {
      pass.render(renderer, outputTarget, beautyTarget);
    } finally {
      renderer.render = originalRender;
    }
    const composite = readTarget(renderer, outputTarget);
    const result = {
      beauty,
      composite,
      sceneRenders,
      usedModelDepthPass: pass.modelDepthTarget != null,
      occlusionMask: pass.aoMaterial.defines.AO_OCCLUSION_MASK ?? 0,
      samplesSceneDepth: pass.depthTexture === depthTexture,
    };
    pass.dispose();
    return result;
  };

  test(
      'darkens a src-model corner when no environment model is present', () => {
        const scene = new Scene();
        const model = new Group();
        addCorner(
            model,
            new Vector3(0, 0, 0),
            track(new MeshBasicMaterial({color: 0x00ff00})));
        scene.add(model);

        const {beauty, composite} = renderComposite(scene);
        const drop = maxChannelDrop(beauty, composite, 1, 200);
        expect(drop).to.be.greaterThan(
            12, 'src-model crevice should darken without an environment model');
      });

  test(
      'does not darken the environment model and still darkens the src model',
      () => {
        const scene = new Scene();
        const model = new Group();
        addCorner(
            model,
            new Vector3(1.35, 0, 0),
            track(new MeshBasicMaterial({color: 0x00ff00})));
        const environment = new Group();
        environment.name = 'EnvironmentRoot';
        addCorner(
            environment,
            new Vector3(-1.55, 0, 0.2),
            track(new MeshBasicMaterial({color: 0xff0000})));
        (scene as Scene & {environmentRoot: Group}).environmentRoot =
            environment;
        scene.add(model);
        scene.add(environment);

        const {beauty, composite} = renderComposite(scene);
        const environmentDrop = maxChannelDrop(beauty, composite, 0, 200);
        const modelDrop = maxChannelDrop(beauty, composite, 1, 200);

        expect(environmentDrop)
            .to.be.lessThan(
                8,
                `environment model should not receive AO (drop ${
                    environmentDrop})`);
        expect(modelDrop).to.be.greaterThan(
            12, `src model should still receive AO (drop ${modelDrop})`);
      });

  test('keeps an environment surface in front of the src model undarkened', () => {
    const scene = new Scene();
    const model = new Group();
    addCorner(
        model,
        new Vector3(0, 0, 0),
        track(new MeshBasicMaterial({color: 0x00ff00})));

    const environment = new Group();
    environment.name = 'EnvironmentRoot';
    const wallMaterial = track(new MeshBasicMaterial({color: 0xff0000}));
    const wall = new Mesh(new BoxGeometry(3.2, 2.2, 0.08), wallMaterial);
    // Sits between the camera and the model and covers the crevice.
    wall.position.set(0, 0, 1.6);
    environment.add(wall);
    (scene as Scene & {environmentRoot: Group}).environmentRoot = environment;
    scene.add(model);
    scene.add(environment);

    const {beauty, composite} = renderComposite(scene);
    const environmentDrop = maxChannelDrop(beauty, composite, 0, 200);
    expect(environmentDrop)
        .to.be.lessThan(
            8,
            `environment in front of the model should hide it without AO (drop ${
                environmentDrop})`);
  });

  test(
      'includes the environment in AO when asked, and skips the extra depth pass',
      () => {
        const scene = new Scene();
        const model = new Group();
        const green = track(new MeshBasicMaterial({color: 0x00ff00}));
        const back = new Mesh(new BoxGeometry(1.4, 1.4, 0.16), green);
        model.add(back);
        const environment = new Group();
        environment.name = 'EnvironmentRoot';
        const red = track(new MeshBasicMaterial({color: 0xff0000}));
        const side = new Mesh(new BoxGeometry(0.16, 1.4, 1.4), red);
        // Side wall meets the src wall, so it can occlude that corner.
        side.position.set(-0.7, 0, 0.62);
        environment.add(side);
        (scene as Scene & {environmentRoot: Group}).environmentRoot =
            environment;
        scene.add(model);
        scene.add(environment);

        const excluded = renderComposite(scene, false);
        const included = renderComposite(scene, true);
        const excludedEnv =
            maxChannelDrop(excluded.beauty, excluded.composite, 0, 200);
        const includedEnv =
            maxChannelDrop(included.beauty, included.composite, 0, 200);
        const excludedModel =
            maxChannelDrop(excluded.beauty, excluded.composite, 1, 200);
        const includedModel =
            maxChannelDrop(included.beauty, included.composite, 1, 200);

        expect(excluded.sceneRenders)
            .to.equal(1, 'excluded AO renders a second depth of the src model');
        expect(excluded.usedModelDepthPass).to.equal(true);
        expect(excluded.occlusionMask).to.equal(1);
        expect(excluded.samplesSceneDepth).to.equal(false);
        expect(excludedEnv)
            .to.be.lessThan(
                8,
                `environment stays undarkened by default (drop ${
                    excludedEnv})`);

        expect(included.sceneRenders)
            .to.equal(
                0,
                'included AO samples the beauty depth and skips the extra pass');
        expect(included.usedModelDepthPass).to.equal(false);
        expect(included.occlusionMask).to.equal(0);
        expect(included.samplesSceneDepth).to.equal(true);
        expect(includedEnv)
            .to.be.greaterThan(
                excludedEnv + 6,
                `environment should darken when included (drop ${
                    includedEnv})`);
        expect(includedModel)
            .to.be.greaterThan(
                excludedModel + 4,
                `environment should occlude the src model (drop ${
                    includedModel} vs ${excludedModel})`);
      });

  test(
      'toggling includeEnvironmentModel on one pass updates the next render',
      () => {
        const scene = new Scene();
        const model = new Group();
        addCorner(
            model,
            new Vector3(1.35, 0, 0),
            track(new MeshBasicMaterial({color: 0x00ff00})));
        const environment = new Group();
        environment.name = 'EnvironmentRoot';
        addCorner(
            environment,
            new Vector3(-1.55, 0, 0.2),
            track(new MeshBasicMaterial({color: 0xff0000})));
        (scene as Scene & {environmentRoot: Group}).environmentRoot =
            environment;
        scene.add(model);
        scene.add(environment);

        const camera = new PerspectiveCamera(50, 1, 0.1, 50);
        camera.position.set(0, 0.15, 5.2);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        const depthTexture = track(new DepthTexture(WIDTH, HEIGHT));
        const beautyTarget = track(new WebGLRenderTarget(WIDTH, HEIGHT, {
          depthTexture,
          samples: 0,
        }));
        const outputTarget =
            track(new WebGLRenderTarget(WIDTH, HEIGHT, {samples: 0}));
        renderer.setRenderTarget(beautyTarget);
        renderer.clear(true, true, true);
        renderer.render(scene, camera);

        const pass = new AOPass(
                         scene,
                         camera,
                         WIDTH,
                         HEIGHT,
                         undefined,
                         undefined,
                         undefined) as AOPass &
        {
          includeEnvironmentModel: boolean;
          modelDepthTarget: WebGLRenderTarget|null;
          aoMaterial: {defines: {AO_OCCLUSION_MASK?: number}};
          output: number;
          intensity: number;
          setGBuffer(
              depthTexture: DepthTexture, normalTexture: undefined): void;
          updateAoMaterial(parameters: object): void;
          render(
              renderer: WebGLRenderer,
              writeBuffer: WebGLRenderTarget,
              readBuffer: WebGLRenderTarget): void;
        };
        pass.setGBuffer(depthTexture, undefined);
        pass.output =
            (AOPass as unknown as {OUTPUT: {Default: number}}).OUTPUT.Default;
        pass.intensity = 1;
        pass.updateAoMaterial({
          algorithm: AOShader.ALGORITHM.SAO,
          radius: 1.25,
          samples: 8,
          screenSpaceRadius: 0,
        });

        const originalRender = renderer.render.bind(renderer);
        let sceneRenders = 0;
        renderer.render =
            ((...args: unknown[]) => {
              if (args[0] === scene) {
                sceneRenders++;
              }
              return (originalRender as (...renderArgs: unknown[]) => void)(
                  ...args);
            }) as typeof renderer.render;
        try {
          pass.render(renderer, outputTarget, beautyTarget);
          expect(sceneRenders).to.equal(1);
          expect(pass.aoMaterial.defines.AO_OCCLUSION_MASK).to.equal(1);

          sceneRenders = 0;
          pass.includeEnvironmentModel = true;
          pass.render(renderer, outputTarget, beautyTarget);
          expect(sceneRenders)
              .to.equal(0, 'turning inclusion on skips the extra depth pass');
          expect(pass.aoMaterial.defines.AO_OCCLUSION_MASK).to.equal(0);

          sceneRenders = 0;
          pass.includeEnvironmentModel = false;
          pass.render(renderer, outputTarget, beautyTarget);
          expect(sceneRenders).to.equal(1);
          expect(pass.aoMaterial.defines.AO_OCCLUSION_MASK).to.equal(1);
        } finally {
          renderer.render = originalRender;
          pass.dispose();
        }
      });
});
