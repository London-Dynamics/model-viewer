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
import {WebGLPathTracer} from 'three-gpu-pathtracer';
import {CENTER} from 'three-mesh-bvh';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath, rafPasses} from '../helpers.js';

const ASTRONAUT = assetPath('models/Astronaut.glb');
const DUCK =
    assetPath('models/glTF-Sample-Assets/Models/Duck/glTF-Binary/Duck.glb');

const PATH_TRACER_READY_EVENT = 'path-tracer-ready';
const BACKEND_CHANGE_EVENT = 'ld-path-tracer-backend-change';

type PathTracerHost = ModelViewerElement&{
  isPathTracerReady: boolean;
  setPathTracerOptions(options: {strategy?: string; maxLeafTris?: number;}):
      void;
  getPathTracerOptions(): {strategy: string; maxLeafTris: number;};
};

const asHost = (element: ModelViewerElement): PathTracerHost =>
    element as PathTracerHost;

const waitFrames = async (count: number) => {
  for (let i = 0; i < count; i++) {
    await rafPasses();
  }
};

const waitUntil = async (predicate: () => boolean, message: string) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 40000) {
      throw new Error(message);
    }
    await rafPasses();
  }
};

suite('LD path tracer ready signal', function() {
  this.timeout(60000);

  let element: ModelViewerElement;
  let sceneBuilds = 0;
  let readyCount = 0;
  let samplesAtReady: number[] = [];
  let restoreSetScene: () => void = () => {};

  const originalSetScene = WebGLPathTracer.prototype.setScene;

  setup(async () => {
    sceneBuilds = 0;
    readyCount = 0;
    samplesAtReady = [];
    WebGLPathTracer.prototype.setScene = function(
        this: WebGLPathTracer, scene: any, camera: any, options?: any) {
      const result = originalSetScene.call(this, scene, camera, options);
      if (element != null && scene === element[$scene]) {
        sceneBuilds++;
      }
      return result;
    };
    restoreSetScene = () => {
      WebGLPathTracer.prototype.setScene = originalSetScene;
    };

    element = new ModelViewerElement();
    element.style.width = '96px';
    element.style.height = '96px';
    element.interactionPrompt = 'none';
    element.pathTracerSamples = 4;
    element.pathTracerSamplesThreshold = 1;
    element.addEventListener(PATH_TRACER_READY_EVENT, () => {
      readyCount++;
      samplesAtReady.push(element.pathTracerRenderedSamples);
    });
    document.body.insertBefore(element, document.body.firstChild);

    const loaded = waitForEvent(element, 'load');
    element.src = ASTRONAUT;
    await loaded;

    element.pathTracer = true;
    await waitUntil(
        () => asHost(element).isPathTracerReady === true,
        'path tracer did not become ready');
  });

  teardown(() => {
    restoreSetScene();
    element?.remove();
  });

  test(
      'fires path-tracer-ready once after the build and the first traced tile',
      async () => {
        await waitFrames(8);

        expect(sceneBuilds).to.equal(1);
        expect(readyCount).to.equal(1);
        expect(samplesAtReady[0]).to.be.greaterThan(0);
        expect(asHost(element).isPathTracerReady).to.equal(true);
      });

  test(
      'keeps accumulating samples while the interaction prompt is visible',
      async () => {
        element.pathTracerSamples = 32;
        element.cameraControls = true;
        element.interactionPrompt = 'auto';
        element.interactionPromptThreshold = 0;
        await waitFrames(8);
        const duringPrompt = element.pathTracerRenderedSamples;
        await waitFrames(12);

        expect(element.pathTracerRenderedSamples)
            .to.be.greaterThan(duringPrompt + 0.3);
        expect(readyCount).to.equal(1);
        expect(asHost(element).isPathTracerReady).to.equal(true);
      });

  test(
      'does not build again when the backend changes with the same renderer and scene',
      async () => {
        const buildsAfterReady = sceneBuilds;
        expect(buildsAfterReady).to.be.greaterThan(0);

        element.dispatchEvent(new CustomEvent(BACKEND_CHANGE_EVENT));
        await waitFrames(6);

        expect(sceneBuilds).to.equal(buildsAfterReady);
        expect(readyCount).to.equal(1);
        expect(asHost(element).isPathTracerReady).to.equal(true);
      });

  test(
      'resets isPathTracerReady when the model changes and fires ready once more',
      async () => {
        expect(asHost(element).isPathTracerReady).to.equal(true);
        const buildsBeforeSwap = sceneBuilds;
        const composer = element.getPathTracerComposer()!;
        const originalMarkSceneDirty = composer.markSceneDirty.bind(composer);
        let sawReset = false;
        composer.markSceneDirty = () => {
          originalMarkSceneDirty();
          sawReset = asHost(element).isPathTracerReady === false;
        };

        const loaded = waitForEvent(element, 'load');
        element.src = DUCK;
        await loaded;
        await waitUntil(
            () => asHost(element).isPathTracerReady === true,
            'path tracer did not become ready after the model change');
        await waitFrames(4);

        expect(sawReset).to.equal(true);
        expect(readyCount).to.equal(2);
        expect(sceneBuilds).to.be.greaterThan(buildsBeforeSwap);
        expect(asHost(element).isPathTracerReady).to.equal(true);
      });

  test(
      'exposes BVH build options without rebuilding when they are unchanged',
      async () => {
        expect(asHost(element).getPathTracerOptions()).to.deep.equal({
          strategy: 'sah',
          maxLeafTris: 1,
        });

        const buildsBefore = sceneBuilds;
        asHost(element).setPathTracerOptions({strategy: 'sah', maxLeafTris: 1});
        await waitFrames(4);
        expect(sceneBuilds).to.equal(buildsBefore);
        expect(asHost(element).isPathTracerReady).to.equal(true);

        asHost(element).setPathTracerOptions(
            {strategy: 'center', maxLeafTris: 10});
        expect(asHost(element).isPathTracerReady).to.equal(false);
        expect(asHost(element).getPathTracerOptions()).to.deep.equal({
          strategy: 'center',
          maxLeafTris: 10,
        });
        await waitUntil(
            () => asHost(element).isPathTracerReady === true,
            'path tracer did not become ready after build options changed');

        expect(sceneBuilds).to.equal(buildsBefore + 1);
        expect(readyCount).to.equal(2);

        const generator =
            (element.getPathTracerComposer() as any)?.pathTracer?._generator;
        expect(generator.bvhOptions.strategy).to.equal(CENTER);
        expect(generator.bvhOptions.targetLeafSize).to.equal(10);
      });

  test(
      'applies environment-intensity without rebuilding the scene',
      async () => {
        const buildsBefore = sceneBuilds;
        let environmentUpdates = 0;
        const originalUpdate = WebGLPathTracer.prototype.updateEnvironment;
        WebGLPathTracer.prototype.updateEnvironment = function(
            this: WebGLPathTracer) {
          environmentUpdates++;
          return originalUpdate.call(this);
        };

        try {
          element.environmentIntensity = 0.35;
          await element.updateComplete;
          await waitFrames(4);

          expect(element[$scene].environmentIntensity).to.equal(0.35);
          expect(environmentUpdates).to.be.greaterThan(0);
          expect(sceneBuilds).to.equal(buildsBefore);
          const tracer =
              (element.getPathTracerComposer() as {
                pathTracer?: {
                  _pathTracer?: {material?: {environmentIntensity?: number}};
                };
              } |
               null)
                  ?.pathTracer;
          const material = tracer?._pathTracer?.material;
          if (element[$scene].environment != null) {
            expect(material?.environmentIntensity).to.be.closeTo(0.35, 1e-6);
          }
          expect(asHost(element).isPathTracerReady).to.equal(true);
        } finally {
          WebGLPathTracer.prototype.updateEnvironment = originalUpdate;
        }
      });
});
