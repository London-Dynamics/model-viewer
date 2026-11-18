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
 * Near and far for a trace camera, in view-space depth.
 *
 * Primary rays start on the near plane and stop at the far plane. The
 * viewer's far plane is `2 × max orbit`, which assumes the camera sits at
 * that orbit. A wider field of view shrinks the auto orbit while a pinned
 * camera stays put, so that plane can cut through the model and the missed
 * faces come back white.
 */
export function traceClipPlanes(
    nearest: number, farthest: number): {near: number; far: number}|null {
  if (!Number.isFinite(nearest) || !Number.isFinite(farthest) ||
      farthest <= 1e-4) {
    return null;
  }
  const closest = Math.min(Math.max(nearest, 1e-3), farthest);
  const span = Math.max(farthest - closest, 1e-3);
  const pad = Math.max(1e-3, span * 0.02);
  let near = closest * 0.5;
  if (!(near > 0) || near >= closest) {
    near = Math.max(1e-3, closest * 0.5);
  }
  let far = farthest + pad;
  if (!(far > near)) {
    far = near + span;
  }
  return {near, far};
}

/** `shadow-environment-rotation` is "x y z" in degrees. Missing axes are 0. */
export function parseShadowEnvironmentRotation(value: string):
    {x: number; y: number; z: number} {
  const parts = value.trim().split(/[\s,]+/).filter((part) => part !== '');
  const read = (index: number) => {
    const number = Number(parts[index]);
    return Number.isFinite(number) ? number : 0;
  };
  return {x: read(0), y: read(1), z: read(2)};
}
