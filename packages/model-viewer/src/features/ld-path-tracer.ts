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
import {Vector2} from 'three';

import {LDAmbientOcclusionInterface} from './ld-ambient-occlusion.js';
import {
  $needsRender,
  $onModelLoad,
  $scene,
  EffectComposerInterface,
} from '../model-viewer-base.js';
import ModelViewerElementBase from '../model-viewer-base.js';
import {
  DEFAULT_PATH_TRACER_OPTIONS,
  LDPathTracerComposer,
  PathTracerOptions,
} from '../three-components/postprocessing/ld-path-tracer/LDPathTracerComposer.js';
import {Constructor} from '../utilities.js';

const $pathTracerComposer = Symbol('pathTracerComposer');
const PATH_TRACER_BACKEND_CHANGE_EVENT = 'ld-path-tracer-backend-change';

export declare interface LDPathTracerInterface {
  pathTracer: boolean;
  pathTracerSamples: number;
  pathTracerSamplesThreshold: number;
  pathTracerBounces: number;
  pathTracerRenderScale: number;
  pathTracerTiles: string;
  pathTracerDepthOfField: boolean;
  pathTracerFocalLength: number;
  pathTracerFStop: number;
  pathTracerFocusDistance: number;
  pathTracerApertureBlades: number;
  pathTracerApertureRotation: number;
  pathTracerAnamorphicRatio: number;
  pathTracerDenoise: boolean;
  pathTracerDenoiseSigma: number;
  pathTracerDenoiseThreshold: number;
  pathTracerDenoiseKSigma: number;
  readonly pathTracerRenderedSamples: number;
  getPathTracerComposer(): LDPathTracerComposer|null;
}

const parseTiles = (value: string): Vector2 => {
  const [x = DEFAULT_PATH_TRACER_OPTIONS.tiles.x,
    y = DEFAULT_PATH_TRACER_OPTIONS.tiles.y] =
      value.split(/[,\s]+/)
          .map((part) => Number(part))
          .filter((part) => Number.isFinite(part) && part > 0);

  return new Vector2(Math.max(1, Math.floor(x)), Math.max(1, Math.floor(y)));
};

export const LDPathTracerMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
) => {
  class LDPathTracerModelViewerElement extends ModelViewerElement {
    @property({type: Boolean, attribute: 'path-tracer'})
    pathTracer = false;

    @property({type: Number, attribute: 'path-tracer-samples'})
    pathTracerSamples = DEFAULT_PATH_TRACER_OPTIONS.samples;

    @property({type: Number, attribute: 'path-tracer-samples-threshold'})
    pathTracerSamplesThreshold = DEFAULT_PATH_TRACER_OPTIONS.samplesThreshold;

    @property({type: Number, attribute: 'path-tracer-bounces'})
    pathTracerBounces = DEFAULT_PATH_TRACER_OPTIONS.bounces;

    @property({type: Number, attribute: 'path-tracer-render-scale'})
    pathTracerRenderScale = DEFAULT_PATH_TRACER_OPTIONS.renderScale;

    @property({type: String, attribute: 'path-tracer-tiles'})
    pathTracerTiles = `${DEFAULT_PATH_TRACER_OPTIONS.tiles.x} ${DEFAULT_PATH_TRACER_OPTIONS.tiles.y}`;

    @property({type: Boolean, attribute: 'path-tracer-depth-of-field'})
    pathTracerDepthOfField = DEFAULT_PATH_TRACER_OPTIONS.depthOfField;

    @property({type: Number, attribute: 'path-tracer-focal-length'})
    pathTracerFocalLength = DEFAULT_PATH_TRACER_OPTIONS.focalLength;

    @property({type: Number, attribute: 'path-tracer-f-stop'})
    pathTracerFStop = DEFAULT_PATH_TRACER_OPTIONS.fStop;

    @property({type: Number, attribute: 'path-tracer-focus-distance'})
    pathTracerFocusDistance = DEFAULT_PATH_TRACER_OPTIONS.focusDistance;

    @property({type: Number, attribute: 'path-tracer-aperture-blades'})
    pathTracerApertureBlades = DEFAULT_PATH_TRACER_OPTIONS.apertureBlades;

    @property({type: Number, attribute: 'path-tracer-aperture-rotation'})
    pathTracerApertureRotation = DEFAULT_PATH_TRACER_OPTIONS.apertureRotation;

    @property({type: Number, attribute: 'path-tracer-anamorphic-ratio'})
    pathTracerAnamorphicRatio = DEFAULT_PATH_TRACER_OPTIONS.anamorphicRatio;

    @property({type: Boolean, attribute: 'path-tracer-denoise'})
    pathTracerDenoise = DEFAULT_PATH_TRACER_OPTIONS.denoise;

    @property({type: Number, attribute: 'path-tracer-denoise-sigma'})
    pathTracerDenoiseSigma = DEFAULT_PATH_TRACER_OPTIONS.denoiseSigma;

    @property({type: Number, attribute: 'path-tracer-denoise-threshold'})
    pathTracerDenoiseThreshold =
        DEFAULT_PATH_TRACER_OPTIONS.denoiseThreshold;

    @property({type: Number, attribute: 'path-tracer-denoise-k-sigma'})
    pathTracerDenoiseKSigma = DEFAULT_PATH_TRACER_OPTIONS.denoiseKSigma;

    protected[$pathTracerComposer]: EffectComposerInterface|null = null;

    get pathTracerRenderedSamples() {
      if (this[$pathTracerComposer] instanceof LDPathTracerComposer) {
        return this[$pathTracerComposer].getSamples();
      }

      return 0;
    }

    getPathTracerComposer(): LDPathTracerComposer|null {
      return this[$pathTracerComposer] instanceof LDPathTracerComposer ?
        this[$pathTracerComposer] :
        null;
    }

    override connectedCallback() {
      super.connectedCallback();
      if (this.pathTracer) {
        this.setupPathTracer();
      }
    }

    override disconnectedCallback() {
      super.disconnectedCallback();
      this.teardownPathTracer();
    }

    override updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);

      if (this.pathTracer) {
        if (this[$pathTracerComposer] == null) {
          this.setupPathTracer();
        }
      } else if (this[$pathTracerComposer] != null) {
        this.teardownPathTracer();
      }

      const knobs = [
        'pathTracerSamples',
        'pathTracerSamplesThreshold',
        'pathTracerBounces',
        'pathTracerRenderScale',
        'pathTracerTiles',
        'pathTracerDepthOfField',
        'pathTracerFocalLength',
        'pathTracerFStop',
        'pathTracerFocusDistance',
        'pathTracerApertureBlades',
        'pathTracerApertureRotation',
        'pathTracerAnamorphicRatio',
        'pathTracerDenoise',
        'pathTracerDenoiseSigma',
        'pathTracerDenoiseThreshold',
        'pathTracerDenoiseKSigma',
        'ambientOcclusion',
        'aoAlgorithm',
        'aoRadius',
        'aoIntensity',
        'aoBias',
        'aoThickness',
        'aoDistanceExponent',
        'aoDistanceFalloff',
        'aoSamples',
        'aoScreenSpaceRadius',
        'aoNoise',
        'aoOutput',
        'aoDenoiseRadius',
        'aoDenoiseRadiusExponent',
        'aoDenoiseRings',
        'aoDenoiseSamples',
        'aoDenoiseLumaPhi',
        'aoDenoiseDepthPhi',
        'aoDenoiseNormalPhi',
      ];

      if (knobs.some((prop) => changedProperties.has(prop))) {
        const options = this.getPathTracerOptions();
        if (this[$pathTracerComposer] instanceof LDPathTracerComposer) {
          this[$pathTracerComposer].updateOptions(options);
          (this as any)[$needsRender]();
        }
      }
    }

    [$onModelLoad]() {
      super[$onModelLoad]();
      if (this[$pathTracerComposer] instanceof LDPathTracerComposer) {
        this[$pathTracerComposer].markSceneDirty();
      }
      if (this.pathTracer) {
        this.setupPathTracer();
      }
    }

    private setupPathTracer() {
      const currentEffect = (this as any)[$scene].effectRenderer;
      if (currentEffect != null &&
          currentEffect !== this[$pathTracerComposer] &&
          !this.isRenderPipeline(currentEffect)) {
        console.warn(
            '[model-viewer] path-tracer requires control over the effect composer. Please remove other custom composers before enabling.');
        this.pathTracer = false;
        return;
      }

      if (!this[$pathTracerComposer]) {
        this[$pathTracerComposer] =
            new LDPathTracerComposer(this.getPathTracerOptions());
      }
      if (!this.isRenderPipeline(currentEffect)) {
        this.registerEffectComposer(this[$pathTracerComposer]!);
      }
      this.dispatchEvent(new CustomEvent(PATH_TRACER_BACKEND_CHANGE_EVENT));
      (this as any)[$needsRender]();
    }

    private teardownPathTracer() {
      if (this[$pathTracerComposer]) {
        if ((this as any)[$scene].effectRenderer ===
            this[$pathTracerComposer]) {
          this.unregisterEffectComposer();
        }
        (this[$pathTracerComposer] as LDPathTracerComposer).dispose();
        this[$pathTracerComposer] = null;
        this.dispatchEvent(new CustomEvent(PATH_TRACER_BACKEND_CHANGE_EVENT));
        (this as any)[$needsRender]();
      }
    }

    private getPathTracerOptions(): PathTracerOptions {
      return {
        samples: Math.max(1, Math.floor(this.pathTracerSamples)),
        samplesThreshold:
            Math.max(1, Math.floor(this.pathTracerSamplesThreshold)),
        bounces: Math.max(1, Math.floor(this.pathTracerBounces)),
        renderScale: this.pathTracerRenderScale,
        tiles: parseTiles(this.pathTracerTiles),
        depthOfField: this.pathTracerDepthOfField,
        focalLength: this.pathTracerFocalLength,
        fStop: this.pathTracerFStop,
        focusDistance: this.pathTracerFocusDistance,
        apertureBlades: this.pathTracerApertureBlades,
        apertureRotation: this.pathTracerApertureRotation,
        anamorphicRatio: this.pathTracerAnamorphicRatio,
        denoise: this.pathTracerDenoise,
        denoiseSigma: this.pathTracerDenoiseSigma,
        denoiseThreshold: this.pathTracerDenoiseThreshold,
        denoiseKSigma: this.pathTracerDenoiseKSigma,
        ambientOcclusionPreviewOptions:
            this.getAmbientOcclusionPreviewOptions(),
      };
    }

    private getAmbientOcclusionPreviewOptions() {
      const host = this as unknown as LDAmbientOcclusionInterface;
      if (!host.ambientOcclusion ||
          typeof host.getAmbientOcclusionOptions !== 'function') {
        return null;
      }

      return host.getAmbientOcclusionOptions();
    }

    private isRenderPipeline(effect: unknown): boolean {
      return typeof (effect as {hasAmbientOcclusion?: unknown})
          ?.hasAmbientOcclusion === 'function' &&
          typeof (effect as {hasPathTracer?: unknown})?.hasPathTracer ===
          'function';
    }
  }

  return LDPathTracerModelViewerElement as Constructor<
      LDPathTracerInterface> &
      T;
};
