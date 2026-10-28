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

type PathTracerHost = ModelViewerElement&{
  isPathTracerReady: boolean;
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

suite('LD path tracer BVH worker', function() {
  this.timeout(60000);

  let element: ModelViewerElement;
  let asyncBuilds = 0;
  let workerUrls: string[] = [];
  let restore: () => void = () => {};

  const originalSetSceneAsync = WebGLPathTracer.prototype.setSceneAsync;
  const OriginalWorker = window.Worker;

  setup(async () => {
    asyncBuilds = 0;
    workerUrls = [];
    WebGLPathTracer.prototype.setSceneAsync = function(
        this: WebGLPathTracer, ...args: unknown[]) {
      asyncBuilds++;
      return (originalSetSceneAsync as (...inner: unknown[]) => Promise<void>)
          .apply(this, args);
    };
    const PatchedWorker = class extends OriginalWorker {
      constructor(url: string|URL, options?: WorkerOptions) {
        workerUrls.push(String(url));
        super(url, options);
      }
    };
    window.Worker = PatchedWorker as typeof Worker;
    restore = () => {
      WebGLPathTracer.prototype.setSceneAsync = originalSetSceneAsync;
      window.Worker = OriginalWorker;
    };

    element = new ModelViewerElement();
    element.style.width = '96px';
    element.style.height = '96px';
    element.pathTracerSamples = 4;
    element.pathTracerSamplesThreshold = 1;
    document.body.insertBefore(element, document.body.firstChild);

    const loaded = waitForEvent(element, 'load');
    element.src = ASTRONAUT;
    await loaded;
    element.pathTracer = true;
    await waitUntil(
        () => (element as PathTracerHost).isPathTracerReady === true,
        'path tracer did not become ready with the BVH worker');
  });

  teardown(() => {
    restore();
    element?.remove();
  });

  test(
      'builds the scene once off the main thread and does not rebuild for the same backend',
      async () => {
        expect(asyncBuilds).to.equal(1);
        expect(workerUrls.length).to.equal(1);
        expect(workerUrls[0]).to.contain('path-tracer-bvh.worker.js');
        expect((element as PathTracerHost).isPathTracerReady).to.equal(true);

        element.dispatchEvent(new CustomEvent('ld-path-tracer-backend-change'));
        await rafPasses();
        await rafPasses();
        await rafPasses();

        expect(asyncBuilds).to.equal(1);
        expect(workerUrls.length).to.equal(1);
      });
});
