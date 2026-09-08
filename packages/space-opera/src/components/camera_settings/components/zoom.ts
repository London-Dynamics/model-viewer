/**
 * @license
 * Copyright 2020 Google LLC. All Rights Reserved.
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
 *
 */

import {html} from 'lit';
import {customElement, state} from 'lit/decorators.js';

import {reduxStore} from '../../../space_opera_base.js';
import {zoomStyles} from '../../../styles.css.js';
import {State} from '../../../types.js';
import {
  dispatchZoomLimits,
  getConfig,
  ZoomLimits,
} from '../../config/reducer.js';
import {ConnectedLitElement} from '../../connected_lit_element/connected_lit_element.js';
import {getModelViewer} from '../../model_viewer_preview/reducer.js';

function numericToken(value?: string, position: number = 0) {
  const token = value?.trim().split(/\s+/)[position];
  if (!token || token === 'auto') {
    return undefined;
  }
  const parsed = Number.parseFloat(token);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** The Camera Settings panel. */
@customElement('me-camera-zoom-limits')
export class ZooomLimits extends ConnectedLitElement {
  static styles = zoomStyles;

  @state() enabled = false;
  @state() minRadius?: number = undefined;
  @state() minFov?: number = undefined;
  @state() maxRadius?: number = undefined;
  @state() maxFov?: number = undefined;
  private limitsKey?: string;

  stateChanged(state: State) {
    const config = getConfig(state);
    const limitsKey = [
      config.minCameraOrbit,
      config.maxCameraOrbit,
      config.minFov,
      config.maxFov,
    ].join('|');
    if (limitsKey === this.limitsKey) {
      return;
    }
    this.limitsKey = limitsKey;
    this.minRadius = numericToken(config.minCameraOrbit, 2);
    this.maxRadius = numericToken(config.maxCameraOrbit, 2);
    this.minFov = numericToken(config.minFov);
    this.maxFov = numericToken(config.maxFov);
    this.enabled = [
      this.minRadius,
      this.maxRadius,
      this.minFov,
      this.maxFov,
    ].some(value => value != null);
  }

  onToggle(event: Event) {
    this.enabled = (event.target as HTMLInputElement).checked;

    if (!this.enabled) {
      this.minRadius = undefined;
      this.minFov = undefined;
      this.maxRadius = undefined;
      this.maxFov = undefined;
      reduxStore.dispatch(dispatchZoomLimits());
    }
  }

  private dispatchLimits() {
    const limits: ZoomLimits = {
      minRadius: this.minRadius,
      maxRadius: this.maxRadius,
      minFov: this.minFov,
      maxFov: this.maxFov,
    };
    reduxStore.dispatch(dispatchZoomLimits(limits));
  }

  dispatchMin() {
    const modelViewer = getModelViewer()!;
    this.minFov = modelViewer.getFieldOfView();
    const currentOrbit = modelViewer.getCameraOrbit();
    this.minRadius = currentOrbit.radius;
    if (this.maxRadius != null && this.maxRadius < this.minRadius) {
      this.maxRadius = this.minRadius;
    }
    if (this.maxFov != null && this.maxFov < this.minFov) {
      this.maxFov = this.minFov;
    }
    this.dispatchLimits();
  }

  dispatchMax() {
    const modelViewer = getModelViewer()!;
    this.maxFov = modelViewer.getFieldOfView();
    const currentOrbit = modelViewer.getCameraOrbit();
    this.maxRadius = currentOrbit.radius;
    if (this.minRadius != null && this.minRadius > this.maxRadius) {
      this.minRadius = this.maxRadius;
    }
    if (this.minFov != null && this.minFov > this.maxFov) {
      this.minFov = this.maxFov;
    }
    this.dispatchLimits();
  }

  dispatchReset() {
    this.minRadius = undefined;
    this.minFov = undefined;
    this.maxRadius = undefined;
    this.maxFov = undefined;
    reduxStore.dispatch(dispatchZoomLimits());
  }

  render() {
    return html`
    <me-checkbox
      id="limit-enabled"
      label="Apply Minimum Zoom"
      ?checked="${this.enabled}"
      @change=${this.onToggle}>
    </me-checkbox>
    ${
        this.enabled ? html`
      <mwc-button id="set-min-button" class="SetButton" unelevated
        @click="${this.dispatchMin}">Set Minimum</mwc-button>
      <mwc-button id="set-max-button" class="SetButton" unelevated
        @click="${this.dispatchMax}">Set Maximum</mwc-button>
      <mwc-button id="reset-button" class="SetButton" unelevated icon="undo"
        @click="${this.dispatchReset}">Reset Limits</mwc-button>
    ` :
                       html``}
`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'me-camera-zoom-limits': ZooomLimits;
  }
}
