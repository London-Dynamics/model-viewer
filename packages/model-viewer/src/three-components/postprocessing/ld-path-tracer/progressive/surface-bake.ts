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

/**
 * Atlas camera the WebGPU path tracer already calls for a primary ray.
 * uv is the lightmap texel. Origin is the stored position plus a normal
 * bias, direction is the negated normal, and an empty texel returns false.
 */
export type AtlasBakeCamera = 'getCameraRay';

/**
 * UV-space shadow / occlusion atlas.
 *
 * TODO(webgpu-atlas-bake): sample this with WebGPUPathTracer, the same
 * sampling, BVH, and denoiser as the beauty trace. Install the atlas camera
 * through getCameraRay. Do not construct a WebGL path tracer. The GPU runner
 * is prototyping that camera and will land the patch in this class.
 *
 * Until then the bake publishes no texture. Shader AO stays up. An empty
 * readback must not become a near-zero scale that divides the shadow away.
 */
export class AtlasBake {
  readonly implemented: boolean = false;
  readonly camera: AtlasBakeCamera = 'getCameraRay';

  /** Samples completed. Zero while the WebGPU atlas camera is absent. */
  step(): number {
    return 0;
  }

  dispose(): void {}
}
