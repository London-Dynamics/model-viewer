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

import {parseShadowEnvironmentRotation, traceClipPlanes} from '../../../../three-components/postprocessing/ld-path-tracer/trace-clip.js';

suite('path tracer trace clip', () => {
  test('keeps a zoomed-out model inside the ray range', () => {
    // Camera at the 28° framing distance, field of view widened to 39°.
    // The auto far plane (2 × the new ideal orbit) lands inside the cabinet.
    const viewerFar = 3.358;
    const nearest = 2.681;
    const farthest = 3.755;
    const planes = traceClipPlanes(nearest, farthest);

    expect(planes).to.not.equal(null);
    expect(planes!.near).to.be.below(nearest);
    expect(planes!.far).to.be.above(farthest);
    expect(planes!.far).to.be.above(viewerFar);
    expect(planes!.near).to.be.above(0);
  });

  test('rejects a depth range that does not reach the camera', () => {
    expect(traceClipPlanes(Number.NaN, 1)).to.equal(null);
    expect(traceClipPlanes(1, 0)).to.equal(null);
  });

  test('reads shadow environment rotation in degrees', () => {
    expect(parseShadowEnvironmentRotation('0 90 0'))
        .to.deep.equal({x: 0, y: 90, z: 0});
    expect(parseShadowEnvironmentRotation('10, -20, 30'))
        .to.deep.equal({x: 10, y: -20, z: 30});
    expect(parseShadowEnvironmentRotation('')).to.deep.equal({x: 0, y: 0, z: 0});
    expect(parseShadowEnvironmentRotation('nope 4'))
        .to.deep.equal({x: 0, y: 4, z: 0});
  });
});
