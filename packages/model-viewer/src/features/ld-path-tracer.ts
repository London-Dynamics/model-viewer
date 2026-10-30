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

import {$needsRender, $onModelLoad, $scene, EffectComposerInterface,} from '../model-viewer-base.js';
import ModelViewerElementBase from '../model-viewer-base.js';
import {DEFAULT_PATH_TRACER_BUILD_OPTIONS, DEFAULT_PATH_TRACER_OPTIONS, LDPathTracerComposer, PathTracerBuildOptions, PathTracerOptions, resolvePathTracerBuildOptions, TraceStats,} from '../three-components/postprocessing/ld-path-tracer/LDPathTracerComposer.js';
import {cloneProgressiveSettings, DEFAULT_PROGRESSIVE_SETTINGS, ProgressiveOptionsPatch, ProgressiveSettings, resolveProgressiveSettings,} from '../three-components/postprocessing/ld-path-tracer/progressive/options.js';
import {ProgressiveReadout} from '../three-components/postprocessing/ld-path-tracer/progressive/ProgressivePipeline.js';
import {parseSamplesMode, parseShadowQuality, parseTraceMode, parseTraceView, TraceMode, TraceSamplesMode, TraceShadowQuality, TraceView} from '../three-components/postprocessing/ld-path-tracer/progressive/trace-composite.js';
import {Constructor} from '../utilities.js';

import {LDAmbientOcclusionInterface} from './ld-ambient-occlusion.js';

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
  pathTracerMode: TraceMode;
  pathTracerView: TraceView;
  pathTracerExclude: string;
  pathTracerExcludedCastShadow: boolean;
  pathTracerGroundShadow: number;
  pathTracerShadowQuality: TraceShadowQuality;
  pathTracerAoDistance: number;
  pathTracerMaterialRoles: string;
  pathTracerSamplesMode: TraceSamplesMode;
  pathTracerAdaptiveThreshold: number;
  pathTracerFadeMs: number;
  readonly pathTracerStats: TraceStats|null;
  readonly pathTracerRenderedSamples: number;
  readonly isPathTracerSettled: boolean;
  getPathTracerExcludedMeshes(): string[];
  readonly isPathTracerReady: boolean;
  readonly isContactShadowReady: boolean;
  readonly isTextureAoReady: boolean;
  readonly isLightLayersReady: boolean;
  readonly isProbesReady: boolean;
  getPathTracerComposer(): LDPathTracerComposer|null;
  setPathTracerOptions(options: Partial<PathTracerBuildOptions>&
                       ProgressiveOptionsPatch): void;
  getPathTracerOptions(): PathTracerBuildOptions&ProgressiveSettings;
  getPathTracerProgressiveState(): ProgressiveReadout|null;
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
    T extends Constructor<ModelViewerElementBase>>(ModelViewerElement: T) => {
  class LDPathTracerModelViewerElement extends ModelViewerElement {
    @property({type: Boolean, attribute: 'path-tracer'}) pathTracer = false;

    @property({type: Number, attribute: 'path-tracer-samples'})
    pathTracerSamples = DEFAULT_PATH_TRACER_OPTIONS.samples;

    @property({type: Number, attribute: 'path-tracer-samples-threshold'})
    pathTracerSamplesThreshold = DEFAULT_PATH_TRACER_OPTIONS.samplesThreshold;

    @property({type: Number, attribute: 'path-tracer-bounces'})
    pathTracerBounces = DEFAULT_PATH_TRACER_OPTIONS.bounces;

    @property({type: Number, attribute: 'path-tracer-render-scale'})
    pathTracerRenderScale = DEFAULT_PATH_TRACER_OPTIONS.renderScale;

    @property({type: String, attribute: 'path-tracer-tiles'})
    pathTracerTiles = `${DEFAULT_PATH_TRACER_OPTIONS.tiles.x} ${
        DEFAULT_PATH_TRACER_OPTIONS.tiles.y}`;

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
    pathTracerDenoiseThreshold = DEFAULT_PATH_TRACER_OPTIONS.denoiseThreshold;

    @property({type: Number, attribute: 'path-tracer-denoise-k-sigma'})
    pathTracerDenoiseKSigma = DEFAULT_PATH_TRACER_OPTIONS.denoiseKSigma;

    /**
     * full: the trace is the picture. shadows: a white-diffuse trace darkens
     * the real-time render and a ground catcher. lighting: a diffuse-proxy
     * trace replaces the real-time diffuse lighting.
     */
    @property({type: String, attribute: 'path-tracer-mode'})
    pathTracerMode: TraceMode = DEFAULT_PATH_TRACER_OPTIONS.traceMode;

    /** composite, trace (the raw traced pass) or realtime. */
    @property({type: String, attribute: 'path-tracer-view'})
    pathTracerView: TraceView = DEFAULT_PATH_TRACER_OPTIONS.traceView;

    /**
     * Comma separated: `semi-transparent`, and mesh or material names with
     * `*` wildcards (`mesh:` / `material:` prefixes narrow a token). Excluded
     * meshes render real-time on top of the result.
     */
    @property({type: String, attribute: 'path-tracer-exclude'})
    pathTracerExclude = DEFAULT_PATH_TRACER_OPTIONS.traceExclude;

    /** Excluded meshes still block light in the trace. */
    @property({type: Boolean, attribute: 'path-tracer-excluded-cast-shadow'})
    pathTracerExcludedCastShadow =
        DEFAULT_PATH_TRACER_OPTIONS.traceExcludedCastShadow;

    /** Traced ground shadow strength in shadows and lighting modes. */
    @property({type: Number, attribute: 'path-tracer-ground-shadow'})
    pathTracerGroundShadow = DEFAULT_PATH_TRACER_OPTIONS.traceGroundShadow;

    /**
     * Shadows mode: normal traces full shadows and bounces; fast traces one
     * bounce under a uniform white sky with rays cut at path-tracer-ao-distance.
     */
    @property({type: String, attribute: 'path-tracer-shadow-quality'})
    pathTracerShadowQuality: TraceShadowQuality =
        DEFAULT_PATH_TRACER_OPTIONS.traceShadowQuality;

    /** Fast shadow ray length in metres. */
    @property({type: Number, attribute: 'path-tracer-ao-distance'})
    pathTracerAoDistance = DEFAULT_PATH_TRACER_OPTIONS.traceAoDistance;

    /**
     * Per-material roles, `;` separated: `pattern[, pattern]: role` with role
     * trace, exclude, no-receive or receive-only. Patterns as in
     * path-tracer-exclude. Later entries win.
     */
    @property({type: String, attribute: 'path-tracer-material-roles'})
    pathTracerMaterialRoles = DEFAULT_PATH_TRACER_OPTIONS.traceMaterialRoles;

    /** fixed: trace the full sample count; adaptive: stop on convergence. */
    @property({type: String, attribute: 'path-tracer-samples-mode'})
    pathTracerSamplesMode: TraceSamplesMode =
        DEFAULT_PATH_TRACER_OPTIONS.traceSamplesMode;

    /** Adaptive stop threshold: mean luminance change, 0-255. */
    @property({type: Number, attribute: 'path-tracer-adaptive-threshold'})
    pathTracerAdaptiveThreshold =
        DEFAULT_PATH_TRACER_OPTIONS.traceAdaptiveThreshold;

    /** Fade-in after the camera stops, ms. The trace turns off instantly. */
    @property({type: Number, attribute: 'path-tracer-fade-ms'})
    pathTracerFadeMs = DEFAULT_PATH_TRACER_OPTIONS.traceFadeMs;

    protected[$pathTracerComposer]: EffectComposerInterface|null = null;
    private pathTracerBuildOptions: PathTracerBuildOptions = {
      ...DEFAULT_PATH_TRACER_BUILD_OPTIONS,
    };
    private progressiveSettings: ProgressiveSettings =
        cloneProgressiveSettings(DEFAULT_PROGRESSIVE_SETTINGS);

    get pathTracerRenderedSamples() {
      if (this[$pathTracerComposer] instanceof LDPathTracerComposer) {
        return this[$pathTracerComposer].getSamples();
      }

      return 0;
    }

    get pathTracerStats(): TraceStats|null {
      return this.getPathTracerComposer()?.getTraceStats() ?? null;
    }

    getPathTracerRoles() {
      return this.getPathTracerComposer()?.getTraceRoles() ?? null;
    }

    get isPathTracerSettled() {
      return this.getPathTracerComposer()?.isTraceSettled() === true;
    }

    getPathTracerExcludedMeshes(): string[] {
      return this.getPathTracerComposer()?.getExcludedMeshNames() ?? [];
    }

    get isPathTracerReady() {
      return this.getPathTracerComposer()?.isReady === true;
    }

    get isContactShadowReady() {
      return this.getPathTracerComposer()?.isContactShadowReady() === true;
    }

    get isTextureAoReady() {
      return this.getPathTracerComposer()?.isTextureAoReady() === true;
    }

    get isLightLayersReady() {
      return this.getPathTracerComposer()?.isLightLayersReady() === true;
    }

    get isProbesReady() {
      return this.getPathTracerComposer()?.isProbesReady() === true;
    }

    getPathTracerComposer(): LDPathTracerComposer|null {
      return this[$pathTracerComposer] instanceof LDPathTracerComposer ?
          this[$pathTracerComposer] :
          null;
    }

    setPathTracerOptions(options: Partial<PathTracerBuildOptions>&
                         ProgressiveOptionsPatch) {
      this.pathTracerBuildOptions =
          resolvePathTracerBuildOptions(this.pathTracerBuildOptions, options);
      this.progressiveSettings =
          resolveProgressiveSettings(this.progressiveSettings, options);
      const composer = this.getPathTracerComposer();
      composer?.setBuildOptions(this.pathTracerBuildOptions);
      composer?.setProgressiveSettings(this.progressiveSettings);
      // Progressive mode replaces shader AO. The render pipeline reads the
      // mode from the composer and drops the AO pass.
      this.dispatchEvent(new CustomEvent(PATH_TRACER_BACKEND_CHANGE_EVENT));
    }

    getPathTracerOptions(): PathTracerBuildOptions&ProgressiveSettings {
      return this.getPathTracerComposer()?.getRuntimeOptions() ?? {
        ...this.pathTracerBuildOptions,
        ...cloneProgressiveSettings(this.progressiveSettings),
      };
    }

    getPathTracerProgressiveState(): ProgressiveReadout|null {
      return this.getPathTracerComposer()?.getProgressiveReadout() ?? null;
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
        'pathTracerMode',
        'pathTracerView',
        'pathTracerExclude',
        'pathTracerExcludedCastShadow',
        'pathTracerGroundShadow',
        'pathTracerShadowQuality',
        'pathTracerAoDistance',
        'pathTracerMaterialRoles',
        'pathTracerSamplesMode',
        'pathTracerAdaptiveThreshold',
        'pathTracerFadeMs',
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
        const options = this.readAttributePathTracerOptions();
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
        const composer =
            new LDPathTracerComposer(this.readAttributePathTracerOptions());
        composer.setBuildOptions(this.pathTracerBuildOptions);
        composer.setProgressiveSettings(this.progressiveSettings);
        this[$pathTracerComposer] = composer;
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

    private readAttributePathTracerOptions(): PathTracerOptions {
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
        traceMode: parseTraceMode(this.pathTracerMode),
        traceView: parseTraceView(this.pathTracerView),
        traceExclude: this.pathTracerExclude ?? '',
        traceExcludedCastShadow: this.pathTracerExcludedCastShadow === true,
        traceGroundShadow: Number.isFinite(this.pathTracerGroundShadow) ?
            Math.max(0, this.pathTracerGroundShadow) :
            DEFAULT_PATH_TRACER_OPTIONS.traceGroundShadow,
        traceShadowQuality: parseShadowQuality(this.pathTracerShadowQuality),
        traceAoDistance: Number.isFinite(this.pathTracerAoDistance) ?
            Math.max(0.001, this.pathTracerAoDistance) :
            DEFAULT_PATH_TRACER_OPTIONS.traceAoDistance,
        traceMaterialRoles: this.pathTracerMaterialRoles ?? '',
        traceSamplesMode: parseSamplesMode(this.pathTracerSamplesMode),
        traceAdaptiveThreshold: Number.isFinite(this.pathTracerAdaptiveThreshold) ?
            Math.max(0, this.pathTracerAdaptiveThreshold) :
            DEFAULT_PATH_TRACER_OPTIONS.traceAdaptiveThreshold,
        traceFadeMs: Number.isFinite(this.pathTracerFadeMs) ?
            Math.max(0, this.pathTracerFadeMs) :
            DEFAULT_PATH_TRACER_OPTIONS.traceFadeMs,
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
      return typeof (effect as {
               hasAmbientOcclusion?: unknown
             })?.hasAmbientOcclusion === 'function' &&
          typeof (effect as {hasPathTracer?: unknown})?.hasPathTracer ===
          'function';
    }
  }

  return LDPathTracerModelViewerElement as Constructor<LDPathTracerInterface>&
      T;
};
