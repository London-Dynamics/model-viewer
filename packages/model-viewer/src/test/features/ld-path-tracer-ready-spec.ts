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

import {ModelViewerElement} from '../../model-viewer.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath, rafPasses} from '../helpers.js';

const ASTRONAUT = assetPath('models/Astronaut.glb');
const DUCK =
    assetPath('models/glTF-Sample-Assets/Models/Duck/glTF-Binary/Duck.glb');

type PathTracerHost = ModelViewerElement&{
  isPathTracerReady: boolean;
  setPathTracerOptions(options: {strategy?: string; maxLeafTris?: number;}):
      void;
  getPathTracerOptions():
      {strategy: string; maxLeafTris: number; mode: string;};
};

const asHost = (element: ModelViewerElement): PathTracerHost =>
    element as PathTracerHost;

const waitFrames = async (count: number) => {
  for (let i = 0; i < count; i++) {
    await rafPasses();
  }
};

suite('LD path tracer ready signal', function() {
  this.timeout(30000);

  let element: ModelViewerElement;
  let sceneBuilds = 0;
  let restoreSetScene: () => void = () => {};

  const originalSetScene = WebGLPathTracer.prototype.setScene;

  setup(async () => {
    sceneBuilds = 0;
    WebGLPathTracer.prototype.setScene = function(
        this: WebGLPathTracer, scene: unknown, camera: unknown,
        options?: unknown) {
      sceneBuilds++;
      return originalSetScene.call(this, scene as never, camera as never, options as never);
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
    document.body.insertBefore(element, document.body.firstChild);

    const loaded = waitForEvent(element, 'load');
    element.src = ASTRONAUT;
    await loaded;

    element.pathTracer = true;
    await waitFrames(4);
  });

  teardown(() => {
    restoreSetScene();
    element?.remove();
  });

  test('does not construct a WebGL path tracer for the beauty pass', () => {
    expect(sceneBuilds).to.equal(0);
    expect(element.getPathTracerComposer()).to.not.equal(null);
    expect(element.pathTracerRenderedSamples).to.equal(
        element.getPathTracerComposer()!.getSamples());
  });

  test('stores BVH build options and clears ready when they change', () => {
    expect(asHost(element).getPathTracerOptions().strategy).to.equal('sah');
    expect(asHost(element).getPathTracerOptions().maxLeafTris).to.equal(1);
    expect(asHost(element).getPathTracerOptions().mode).to.equal('immediate');

    asHost(element).setPathTracerOptions({strategy: 'sah', maxLeafTris: 1});
    expect(sceneBuilds).to.equal(0);

    asHost(element).setPathTracerOptions({strategy: 'center', maxLeafTris: 10});
    expect(asHost(element).isPathTracerReady).to.equal(false);
    expect(asHost(element).getPathTracerOptions().strategy).to.equal('center');
    expect(asHost(element).getPathTracerOptions().maxLeafTris).to.equal(10);
    expect(sceneBuilds).to.equal(0);
    expect((element.getPathTracerComposer() as {pathTracer?: unknown})
               .pathTracer)
        .to.equal(undefined);
  });

  test('a model change does not build a WebGL path tracer', async () => {
    const composer = element.getPathTracerComposer()!;
    composer.markSceneDirty();
    expect(composer.isReady).to.equal(false);

    const loaded = waitForEvent(element, 'load');
    element.src = DUCK;
    await loaded;
    await waitFrames(2);

    expect(sceneBuilds).to.equal(0);
    expect(element.getPathTracerComposer()).to.not.equal(null);
  });
});
