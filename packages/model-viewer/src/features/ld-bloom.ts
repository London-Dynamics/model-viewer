import {property} from 'lit/decorators.js';
import {
  Camera,
  Color,
  ColorRepresentation,
  HalfFloatType,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  ToneMapping,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget
} from 'three';
import {BloomPass} from 'three/examples/jsm/postprocessing/BloomPass.js';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import ModelViewerElementBase, {
  $needsRender,
  $onModelLoad,
  $scene,
  EffectComposerInterface
} from '../model-viewer-base.js';
import {ModelScene} from '../three-components/ModelScene.js';
import {Constructor, resolveDpr} from '../utilities.js';

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
  setBloomTargets(targets: LDBloomTarget[]): void;
  getBloomTargets(): LDBloomTarget[];
  setBloomTargetEnabled(
      kind: LDBloomTargetKind, name: string, enabled: boolean): void;
}

interface MaterialSnapshot {
  color?: Color;
  emissive?: Color;
  emissiveIntensity?: number;
  toneMapped: boolean;
  needsUpdate: boolean;
}

const DEFAULT_BLOOM_STRENGTH = 1.5;
const DEFAULT_BLOOM_RADIUS = 0.45;
const DEFAULT_BLOOM_THRESHOLD = 0.08;
const DEFAULT_BLOOM_MSAA = 4;
const SMART_IDLE_MS = 250;

const $composer = Symbol('composer');
const $targets = Symbol('targets');
const $snapshots = Symbol('snapshots');
const $qualityTimer = Symbol('qualityTimer');
const $handleCameraChange = Symbol('handleCameraChange');
const $parseTargets = Symbol('parseTargets');
const $syncBloom = Symbol('syncBloom');
const $applyTargets = Symbol('applyTargets');
const $restoreMaterials = Symbol('restoreMaterials');
const $ensureComposer = Symbol('ensureComposer');

class LDBloomComposer implements EffectComposerInterface {
  private composer?: EffectComposer;
  private renderPass?: RenderPass;
  private bloomPass?: UnrealBloomPass|BloomPass;
  private renderer?: WebGLRenderer;
  private scene?: ModelScene;
  private camera?: Camera;
  private activeMsaa = 0;

  constructor(private readonly host: LDBloomInterface&ModelViewerElementBase) {}

  setRenderer(renderer: WebGLRenderer): void {
    this.renderer = renderer;
    this.rebuild();
  }

  setMainScene(scene: ModelScene): void {
    this.scene = scene;
    this.rebuild();
  }

  setMainCamera(camera: Camera): void {
    this.camera = camera;
    this.rebuild();
  }

  setSize(width: number, height: number): void {
    this.composer?.setSize(width, height);
    this.bloomPass?.setSize(width, height);
  }

  beforeRender(_time: DOMHighResTimeStamp, _delta: DOMHighResTimeStamp): void {}

  render(deltaTime?: DOMHighResTimeStamp): void {
    if (!this.composer || !this.renderer || !this.scene) {
      return;
    }

    const previousToneMapping = this.renderer.toneMapping;
    this.renderer.toneMapping = this.scene.toneMapping as ToneMapping;
    this.composer.render(deltaTime);
    this.renderer.toneMapping = previousToneMapping;
  }

  updatePass(): void {
    this.rebuild();
  }

  setActiveMsaa(msaa: number): void {
    if (this.activeMsaa === msaa) {
      return;
    }
    this.activeMsaa = msaa;
    this.rebuild();
  }

  dispose(): void {
    this.bloomPass?.dispose();
    this.composer?.dispose();
    this.bloomPass = undefined;
    this.composer = undefined;
    this.renderPass = undefined;
  }

  private rebuild(): void {
    if (!this.renderer || !this.scene || !this.camera) {
      return;
    }

    this.dispose();

    const renderTarget = new WebGLRenderTarget(1, 1, {
      samples: this.activeMsaa,
      type: HalfFloatType,
      stencilBuffer: true
    });
    this.composer = new EffectComposer(this.renderer, renderTarget);
    this.composer.setPixelRatio(1);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    if (this.host.bloomMode === 'classic') {
      this.bloomPass = new BloomPass(this.host.bloomStrength);
    } else {
      this.bloomPass = new UnrealBloomPass(
          new Vector2(1, 1), this.host.bloomStrength, this.host.bloomRadius,
          this.host.bloomThreshold);
    }
    this.updateBloomPass();
    this.composer.addPass(this.bloomPass);
    this.setSize(this.scene.width * resolveDpr(), this.scene.height * resolveDpr());
  }

  private updateBloomPass(): void {
    if (!this.bloomPass) {
      return;
    }

    this.bloomPass.enabled = true;
    if (this.bloomPass instanceof UnrealBloomPass) {
      this.bloomPass.strength = this.host.bloomStrength;
      this.bloomPass.radius = this.host.bloomRadius;
      this.bloomPass.threshold = this.host.bloomThreshold;
    } else {
      (this.bloomPass as BloomPass&{combineUniforms: Record<string, any>})
          .combineUniforms['strength'].value =
          this.host.bloomStrength;
    }
  }
}

const materialsForObject = (object: Object3D): Material[] => {
  const material = (object as Mesh).material;
  if (!material) {
    return [];
  }
  return Array.isArray(material) ? material : [material];
};

const cloneTargets = (targets: LDBloomTarget[]): LDBloomTarget[] =>
    targets.map(target => ({...target}));

export const LDBloomMixin = <T extends Constructor<ModelViewerElementBase>>(
    ModelViewerElement: T): Constructor<LDBloomInterface>&T => {
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

    private[$composer]: LDBloomComposer|null = null;
    private[$targets]: LDBloomTarget[] = [];
    private[$snapshots] = new Map<Material, MaterialSnapshot>();
    private[$qualityTimer]: number|null = null;

    connectedCallback() {
      super.connectedCallback();
      this.addEventListener('camera-change', this[$handleCameraChange]);
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.removeEventListener('camera-change', this[$handleCameraChange]);
      this[$restoreMaterials]();
      this[$composer]?.dispose();
      this[$composer] = null;
    }

    setBloomTargets(targets: LDBloomTarget[]): void {
      this[$targets] = cloneTargets(targets);
      this.bloomTargets = JSON.stringify(this[$targets]);
      this[$syncBloom]();
    }

    getBloomTargets(): LDBloomTarget[] {
      return cloneTargets(this[$targets]);
    }

    setBloomTargetEnabled(
        kind: LDBloomTargetKind, name: string, enabled: boolean): void {
      this[$targets] = this[$targets].map(target => {
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

      if (changedProperties.has('bloomMode') ||
          changedProperties.has('bloomStrength') ||
          changedProperties.has('bloomRadius') ||
          changedProperties.has('bloomThreshold') ||
          changedProperties.has('bloomMsaa')) {
        this[$composer]?.updatePass();
      }

      if (changedProperties.has('bloom') ||
          changedProperties.has('bloomTargets') ||
          changedProperties.has('bloomMode') ||
          changedProperties.has('bloomStrength') ||
          changedProperties.has('bloomRadius') ||
          changedProperties.has('bloomThreshold') ||
          changedProperties.has('bloomMsaa')) {
        this[$syncBloom]();
      }
    }

    [$onModelLoad]() {
      super[$onModelLoad]();
      this[$syncBloom]();
    }

    private[$handleCameraChange] = () => {
      if (!this.bloom || this.bloomQuality !== 'smart' ||
          this.bloomMode !== 'unreal') {
        return;
      }

      this[$composer]?.setActiveMsaa(0);
      if (this[$qualityTimer] != null) {
        window.clearTimeout(this[$qualityTimer]);
      }
      this[$qualityTimer] = window.setTimeout(() => {
        this[$qualityTimer] = null;
        this[$composer]?.setActiveMsaa(this.bloomMsaa);
        this[$scene].queueRender();
      }, SMART_IDLE_MS);
    };

    private[$parseTargets](): void {
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

    private[$ensureComposer](): void {
      if (this[$composer] == null) {
        this[$composer] = new LDBloomComposer(this);
      }
      this[$composer].setActiveMsaa(
          this.bloomQuality === 'performance' ? 0 : this.bloomMsaa);
      this.registerEffectComposer(this[$composer]);
    }

    private[$syncBloom](): void {
      this[$restoreMaterials]();

      if (!this.bloom) {
        this.unregisterEffectComposer();
        this[$needsRender]();
        return;
      }

      this[$ensureComposer]();
      this[$applyTargets]();
      this[$scene].queueRender();
      this[$needsRender]();
    }

    private[$applyTargets](): void {
      const activeTargets = this[$targets].filter(
          target => target.enabled !== false && (target.material || target.mesh));
      if (activeTargets.length === 0) {
        return;
      }

      this[$scene].traverse((object: Object3D) => {
        const objectMaterials = materialsForObject(object);
        for (const material of objectMaterials) {
          const target = activeTargets.find(candidate => {
            return candidate.mesh === object.name ||
                candidate.material === material.name;
          });
          if (!target) {
            continue;
          }
          this[$snapshots].set(material, {
            color: 'color' in material ?
                (material as Material&{color: Color}).color.clone() :
                undefined,
            emissive: 'emissive' in material ?
                (material as MeshStandardMaterial).emissive.clone() :
                undefined,
            emissiveIntensity: 'emissiveIntensity' in material ?
                (material as MeshStandardMaterial).emissiveIntensity :
                undefined,
            toneMapped: material.toneMapped,
            needsUpdate: material.needsUpdate
          });

          const color = target.color || '#ffffff';
          const intensity = target.intensity ?? this.bloomStrength;
          if ('emissive' in material) {
            const standardMaterial = material as MeshStandardMaterial;
            standardMaterial.emissive.set(color as ColorRepresentation);
            standardMaterial.emissiveIntensity = intensity;
          } else if ('color' in material) {
            (material as MeshBasicMaterial).color.set(color as ColorRepresentation);
          }
          material.toneMapped = false;
          material.needsUpdate = true;
        }
      });
    }

    private[$restoreMaterials](): void {
      this[$snapshots].forEach((snapshot, material) => {
        if (snapshot.color && 'color' in material) {
          (material as Material&{color: Color}).color.copy(snapshot.color);
        }
        if (snapshot.emissive && 'emissive' in material) {
          (material as MeshStandardMaterial).emissive.copy(snapshot.emissive);
        }
        if (snapshot.emissiveIntensity !== undefined &&
            'emissiveIntensity' in material) {
          (material as MeshStandardMaterial).emissiveIntensity =
              snapshot.emissiveIntensity;
        }
        material.toneMapped = snapshot.toneMapped;
        material.needsUpdate = snapshot.needsUpdate;
      });
      this[$snapshots].clear();
    }
  }

  return LDBloomModelViewerElement;
};
