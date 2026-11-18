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

import {property} from 'lit/decorators.js';

import ModelViewerElementBase, {$loaded, $resolveSourceUrl, $revokeResolvedSource, $scene, $updateSource} from '../model-viewer-base.js';
import {UsdzConversionError} from '../three-components/load-issues.js';
import {Constructor} from '../utilities.js';

import {convertUsdzToGlb, UsdzUpAxis} from './ld-usdz/convert-usdz.js';
import {fetchModelBytes, sourceNeedsUsdzConversion} from './ld-usdz/detect-usdz.js';

export interface LDUsdzInterface {
  /** Positive meters per USD unit. Null uses the stage value, or 1. */
  usdzMetersPerUnit: number|null;
  /** `Y` or `Z`. Null uses the stage up axis. */
  usdzUpAxis: string|null;
}

const $usdzActiveSrc = Symbol('usdzActiveSrc');
const $usdzObjectUrl = Symbol('usdzObjectUrl');
const $revokeHeldUsdzUrl = Symbol('revokeHeldUsdzUrl');

const readUpAxis = (value: string|null): UsdzUpAxis|undefined => {
  if (value == null || value.trim() === '') {
    return undefined;
  }
  const axis = value.trim().toUpperCase();
  if (axis !== 'Y' && axis !== 'Z') {
    throw new UsdzConversionError(
        new Error(`usdz-up-axis must be Y or Z, got "${value}"`));
  }
  return axis;
};

const readMetersPerUnit = (value: number|null): number|undefined => {
  if (value == null) {
    return undefined;
  }
  if (!Number.isFinite(value) || value <= 0) {
    throw new UsdzConversionError(new Error(
        'usdz-meters-per-unit must be a positive number of meters per USD unit'));
  }
  return value;
};

/**
 * Converts USDZ `src` values to GLB before the normal glTF pipeline.
 * `ios-src` is left untouched for AR Quick Look.
 */
export const LDUsdzMixin = <T extends Constructor<ModelViewerElementBase>>(
    ModelViewerElement: T): Constructor<LDUsdzInterface>&T => {
  class LDUsdzModelViewerElement extends ModelViewerElement {
    @property({type: Number, attribute: 'usdz-meters-per-unit'})
    usdzMetersPerUnit: number|null = null;

    @property({type: String, attribute: 'usdz-up-axis'})
    usdzUpAxis: string|null = null;

    private[$usdzActiveSrc]: string|null = null;
    private[$usdzObjectUrl]: string|null = null;

    private[$revokeHeldUsdzUrl]() {
      const url = this[$usdzObjectUrl];
      if (url != null) {
        URL.revokeObjectURL(url);
        this[$usdzObjectUrl] = null;
      }
    }

    override disconnectedCallback() {
      this[$revokeHeldUsdzUrl]();
      super.disconnectedCallback();
    }

    override updated(changedProperties: Map<PropertyKey, unknown>) {
      super.updated(changedProperties);
      if (this[$usdzActiveSrc] == null || this[$usdzActiveSrc] !== this.src) {
        return;
      }
      if (changedProperties.has('usdzMetersPerUnit') ||
          changedProperties.has('usdzUpAxis')) {
        this[$loaded] = false;
        this[$scene].url = null;
        this[$updateSource]();
      }
    }

    protected[$revokeResolvedSource](resolved: string, original: string) {
      super[$revokeResolvedSource](resolved, original);
      if (this[$usdzObjectUrl] === resolved) {
        this[$usdzObjectUrl] = null;
      }
    }

    protected async[$resolveSourceUrl](src: string): Promise<string> {
      let convert = false;
      try {
        convert = await sourceNeedsUsdzConversion(src, this.withCredentials);
      } catch (error) {
        throw new UsdzConversionError(error);
      }
      if (!convert) {
        if (this[$usdzActiveSrc] === src) {
          this[$usdzActiveSrc] = null;
        }
        return src;
      }

      try {
        const bytes = await fetchModelBytes(src, this.withCredentials);
        const glb = await convertUsdzToGlb(bytes, {
          metersPerUnit: readMetersPerUnit(this.usdzMetersPerUnit),
          upAxis: readUpAxis(this.usdzUpAxis),
        });
        this[$revokeHeldUsdzUrl]();
        const objectUrl = URL.createObjectURL(glb);
        this[$usdzObjectUrl] = objectUrl;
        this[$usdzActiveSrc] = src;
        return objectUrl;
      } catch (error) {
        if (error instanceof UsdzConversionError) {
          throw error;
        }
        throw new UsdzConversionError(error);
      }
    }
  }

  return LDUsdzModelViewerElement;
};
