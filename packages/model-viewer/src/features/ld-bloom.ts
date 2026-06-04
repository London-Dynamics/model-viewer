import {property} from 'lit/decorators.js';
import {Mesh, Object3D} from 'three';

import ModelViewerElementBase, {
  $needsRender,
  $onModelLoad,
  $scene,
} from '../model-viewer-base.js';
import {Constructor} from '../utilities.js';

import {
  $ldEffectsComposer,
  syncLDEffectsComposer,
} from './ld-effects-composer/index.js';
import type {LDEffectsComposer} from './ld-effects-composer/index.js';

export type LDBloomMode = 'unreal'|'classic';
export type LDBloomQualityMode = 'performance'|'quality'|'smart';
export type LDBloomTargetKind = 'material'|'mesh';

export interface LDBloomTarget {
  material?: string;
  mesh?: string;
  color?: string;
  intensity?: number;
  enabled?: boolean;
}

export declare interface LDBloomInterface {
  bloom: boolean;
  bloomTargets: string|null;
  bloomMode: LDBloomMode;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  bloomQuality: LDBloomQualityMode;
  bloomMsaa: number;
  bloomSoftShadow: boolean;
  setBloomTargets(targets: LDBloomTarget[]): void;
  getBloomTargets(): LDBloomTarget[];
  setBloomTargetEnabled(
      kind: LDBloomTargetKind,
      name: string,
      enabled: boolean): void;
  getSceneNames(): {objects: string[], materials: string[]};
}

const DEFAULT_BLOOM_STRENGTH = 0.6;
const DEFAULT_BLOOM_RADIUS = 0.2;
const DEFAULT_BLOOM_THRESHOLD = 0.05;
const DEFAULT_BLOOM_MSAA = 4;
const SMART_IDLE_MS = 250;

const $targets = Symbol('targets');
const $qualityTimer = Symbol('qualityTimer');
const $handleCameraChange = Symbol('handleCameraChange');
const $parseTargets = Symbol('parseTargets');
const $syncBloom = Symbol('syncBloom');

const materialsForObject = (object: Object3D) => {
  const material = (object as Mesh).material;
  if (!material) {
    return [];
  }
  return Array.isArray(material) ? material : [material];
};

const cloneTargets = (targets: LDBloomTarget[]): LDBloomTarget[] =>
    targets.map((target) => ({...target}));

export const LDBloomMixin = <T extends Constructor<ModelViewerElementBase>>(
    ModelViewerElement: T,
): Constructor<LDBloomInterface>&T => {
  class LDBloomModelViewerElement extends ModelViewerElement {
    @property({type: Boolean, attribute: 'bloom'})
    bloom = false;

    @property({type: String, attribute: 'bloom-targets'})
    bloomTargets: string|null = null;

    @property({type: String, attribute: 'bloom-mode'})
    bloomMode: LDBloomMode = 'unreal';

    @property({type: Number, attribute: 'bloom-strength'})
    bloomStrength = DEFAULT_BLOOM_STRENGTH;

    @property({type: Number, attribute: 'bloom-radius'})
    bloomRadius = DEFAULT_BLOOM_RADIUS;

    @property({type: Number, attribute: 'bloom-threshold'})
    bloomThreshold = DEFAULT_BLOOM_THRESHOLD;

    @property({type: String, attribute: 'bloom-quality'})
    bloomQuality: LDBloomQualityMode = 'quality';

    @property({type: Number, attribute: 'bloom-msaa'})
    bloomMsaa = DEFAULT_BLOOM_MSAA;

    @property({type: Boolean, attribute: 'bloom-soft-shadow'})
    bloomSoftShadow = false;

    private [$targets]: LDBloomTarget[] = [];
    private [$qualityTimer]: number|null = null;

    connectedCallback() {
      super.connectedCallback();
      this.addEventListener('camera-change', this[$handleCameraChange]);
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.removeEventListener('camera-change', this[$handleCameraChange]);
      if (this[$qualityTimer] != null) {
        window.clearTimeout(this[$qualityTimer]);
        this[$qualityTimer] = null;
      }
    }

    setBloomTargets(targets: LDBloomTarget[]): void {
      this[$targets] = cloneTargets(targets);
      this.bloomTargets = JSON.stringify(this[$targets]);
      this[$syncBloom]();
    }

    getBloomTargets(): LDBloomTarget[] {
      return cloneTargets(this[$targets]);
    }

    getSceneNames(): {objects: string[], materials: string[]} {
      const objects = new Set<string>();
      const materials = new Set<string>();
      this[$scene].traverse((object: Object3D) => {
        if (object.name) {
          objects.add(object.name);
        }
        for (const material of materialsForObject(object)) {
          if (material.name) {
            materials.add(material.name);
          }
        }
      });
      return {
        objects: [...objects].sort(),
        materials: [...materials].sort(),
      };
    }

    setBloomTargetEnabled(
        kind: LDBloomTargetKind,
        name: string,
        enabled: boolean,
        ): void {
      this[$targets] = this[$targets].map((target) => {
        if (target[kind] === name) {
          return {...target, enabled};
        }
        return target;
      });
      this.bloomTargets = JSON.stringify(this[$targets]);
      this[$syncBloom]();
    }

    updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);

      if (changedProperties.has('bloomTargets')) {
        this[$parseTargets]();
      }

      if (
          changedProperties.has('bloomMode') ||
          changedProperties.has('bloomStrength') ||
          changedProperties.has('bloomRadius') ||
          changedProperties.has('bloomThreshold') ||
          changedProperties.has('bloomMsaa')
      ) {
        (this as unknown as {[$ldEffectsComposer]?: LDEffectsComposer})
            [$ldEffectsComposer]?.updateBloomPass();
      }

      if (
          changedProperties.has('bloom') ||
          changedProperties.has('bloomTargets') ||
          changedProperties.has('bloomMode') ||
          changedProperties.has('bloomStrength') ||
          changedProperties.has('bloomRadius') ||
          changedProperties.has('bloomThreshold') ||
          changedProperties.has('bloomMsaa') ||
          changedProperties.has('bloomSoftShadow') ||
          changedProperties.has('bloomQuality')
      ) {
        this[$syncBloom]();
      }
    }

    [$onModelLoad]() {
      super[$onModelLoad]();
      this[$syncBloom]();
    }

    private [$handleCameraChange] = () => {
      if (
          !this.bloom ||
          this.bloomQuality !== 'smart' ||
          this.bloomMode !== 'unreal'
      ) {
        return;
      }

      const composer =
          (this as unknown as {[$ldEffectsComposer]?: LDEffectsComposer})
              [$ldEffectsComposer];
      composer?.setActiveBloomMsaa(0);
      if (this[$qualityTimer] != null) {
        window.clearTimeout(this[$qualityTimer]);
      }
      this[$qualityTimer] = window.setTimeout(() => {
        this[$qualityTimer] = null;
        composer?.setActiveBloomMsaa(this.bloomMsaa);
        this[$scene].queueRender();
      }, SMART_IDLE_MS);
    };

    private [$parseTargets](): void {
      if (this.bloomTargets == null || this.bloomTargets.trim() === '') {
        this[$targets] = [];
        return;
      }

      try {
        const parsed = JSON.parse(this.bloomTargets);
        this[$targets] = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        console.warn('Invalid bloom-targets JSON.', error);
        this[$targets] = [];
      }
    }

    private [$syncBloom](): void {
      syncLDEffectsComposer(this);
      this[$needsRender]();
    }
  }

  return LDBloomModelViewerElement;
};
