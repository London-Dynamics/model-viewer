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
import {isCrossOriginScript, openPathTracerBvhWorker} from '../../three-components/postprocessing/ld-path-tracer/PathTracerBVHWorker.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath, rafPasses} from '../helpers.js';

const ASTRONAUT = assetPath('models/Astronaut.glb');

suite('LD path tracer BVH worker', function() {
  this.timeout(30000);

  let element: ModelViewerElement;
  let asyncBuilds = 0;
  let restore: () => void = () => {};

  const originalSetSceneAsync = WebGLPathTracer.prototype.setSceneAsync;

  setup(async () => {
    asyncBuilds = 0;
    WebGLPathTracer.prototype.setSceneAsync = function(
        this: WebGLPathTracer, ...args: unknown[]) {
      asyncBuilds++;
      return (originalSetSceneAsync as (...inner: unknown[]) => Promise<void>)
          .apply(this, args);
    };
    restore = () => {
      WebGLPathTracer.prototype.setSceneAsync = originalSetSceneAsync;
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
    await rafPasses();
    await rafPasses();
  });

  teardown(() => {
    restore();
    element?.remove();
  });

  test('does not build the beauty scene with WebGLPathTracer.setSceneAsync', () => {
    expect(asyncBuilds).to.equal(0);
    expect(element.getPathTracerComposer()).to.not.equal(null);
    element.dispatchEvent(new CustomEvent('ld-path-tracer-backend-change'));
    expect(asyncBuilds).to.equal(0);
  });
});

suite('path tracer BVH worker URL', () => {
  const OriginalWorker = window.Worker;

  const installWorkerSpy = () => {
    const urls: string[] = [];
    const PatchedWorker = class extends OriginalWorker {
      constructor(url: string|URL, options?: WorkerOptions) {
        urls.push(String(url));
        super(url, options);
      }
    };
    window.Worker = PatchedWorker as typeof Worker;
    return urls;
  };

  teardown(() => {
    window.Worker = OriginalWorker;
  });

  test('starts a cross-origin script from a blob URL', async () => {
    const crossOrigin = new URL('http://cdn.example/path-tracer-bvh.worker.js');
    expect(isCrossOriginScript(crossOrigin)).to.equal(true);
    const urls = installWorkerSpy();
    let fetched = '';
    const worker = await openPathTracerBvhWorker(crossOrigin, async (input) => {
      fetched = String(input);
      return new Response(
          'self.onmessage = function () {};',
          {status: 200, headers: {'content-type': 'text/javascript'}});
    });

    expect(fetched).to.equal(crossOrigin.href);
    expect(urls.length).to.equal(1);
    expect(urls[0].startsWith('blob:')).to.equal(true);
    worker.terminate();
  });

  test(
      'reports a failed cross-origin fetch instead of calling Worker',
      async () => {
        const crossOrigin = new URL('http://cdn.example/missing-worker.js');
        const urls = installWorkerSpy();
        try {
          await openPathTracerBvhWorker(
              crossOrigin, async () => new Response('missing', {status: 404}));
          expect.fail('cross-origin fetch should reject');
        } catch (error) {
          expect(String(error)).to.contain('Access-Control-Allow-Origin');
          expect(String(error)).to.contain('404');
        }
        expect(urls.length).to.equal(0);
      });

  test('starts a same-origin script directly', async () => {
    const sameOrigin = new URL('path-tracer-bvh.worker.js', location.href);
    expect(isCrossOriginScript(sameOrigin)).to.equal(false);
    let fetched = false;
    const urls = installWorkerSpy();
    const worker = await openPathTracerBvhWorker(sameOrigin, async () => {
      fetched = true;
      return new Response('', {status: 200});
    });

    expect(fetched).to.equal(false);
    expect(urls.length).to.equal(1);
    expect(urls[0]).to.equal(sameOrigin.href);
    worker.terminate();
  });
});
