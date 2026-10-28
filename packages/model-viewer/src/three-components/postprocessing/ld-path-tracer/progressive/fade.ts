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

export interface FadeState {
  value: number;
  target: number;
}

export const createFade = (value = 0, target = 0): FadeState =>
    ({value, target});

export const stepFade = (
    state: FadeState,
    deltaMs: number,
    fadeMs: number,
    ): FadeState => {
  if (!(deltaMs > 0) || state.value === state.target) {
    return state;
  }
  if (!(fadeMs > 0)) {
    return {value: state.target, target: state.target};
  }
  const step = deltaMs / fadeMs;
  let value = state.value;
  if (value < state.target) {
    value = Math.min(state.target, value + step);
  } else {
    value = Math.max(state.target, value - step);
  }
  return {value, target: state.target};
};

export const fadeSettled = (state: FadeState): boolean =>
    Math.abs(state.value - state.target) < 1e-3;
