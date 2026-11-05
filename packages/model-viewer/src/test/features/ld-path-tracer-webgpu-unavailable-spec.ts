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

import {ModelViewerElement} from '../../model-viewer.js';
import {PATH_TRACER_UNAVAILABLE_EVENT} from '../../three-components/postprocessing/ld-path-tracer/WebGPUPathTracerSession.js';
import {rafPasses, webGpuAvailable} from '../helpers.js';

suite('WebGPU path tracer availability', function() {
  this.timeout(20000);

  test(
      'reports unavailable and keeps the real-time view when WebGPU cannot start',
      async function() {
        if (await webGpuAvailable()) {
          this.skip();
        }
        const element = new ModelViewerElement();
        element.style.width = '64px';
        element.style.height = '64px';
        let reason = '';
        element.addEventListener(PATH_TRACER_UNAVAILABLE_EVENT, (event) => {
          reason = String((event as CustomEvent).detail?.reason ?? '');
        });
        document.body.appendChild(element);
        try {
          element.pathTracer = true;
          await element.updateComplete;
          const start = performance.now();
          while (reason === '' && performance.now() - start < 8000) {
            await rafPasses();
          }
          expect(element.pathTracer).to.equal(true);
          expect(element.isPathTracerReady).to.equal(false);
          expect(reason.length).to.be.greaterThan(0);
          expect((element as ModelViewerElement & {
                   pathTracerUnavailableReason: string,
                 }).pathTracerUnavailableReason)
              .to.equal(reason);
        } finally {
          element.remove();
        }
      });
});
