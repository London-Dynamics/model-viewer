import { property } from 'lit/decorators.js';
import {
  Camera,
  Color,
  ColorRepresentation,
  DepthTexture,
  HalfFloatType,
  LinearSRGBColorSpace,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  Object3D,
  ShaderMaterial,
  SRGBColorSpace,
  Texture,
  ToneMapping,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { BloomPass } from 'three/examples/jsm/postprocessing/BloomPass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import ModelViewerElementBase, {
  $needsRender,
  $onModelLoad,
  $scene,
  EffectComposerInterface,
} from '../model-viewer-base.js';
import { ModelScene } from '../three-components/ModelScene.js';
import { AOPass } from '../three-components/postprocessing/ld-ambient-occlusion/AOPass.js';
import {
  AmbientOcclusionOptions,
} from '../three-components/postprocessing/ld-ambient-occlusion/LDAmbientOcclusionComposer.js';
import { Constructor } from '../utilities.js';

export type LDBloomMode = 'unreal' | 'classic';
export type LDBloomQualityMode = 'performance' | 'quality' | 'smart';
export type LDBloomTargetKind = 'material' | 'mesh';

export interface LDBloomTarget {
  material?: string;
  mesh?: string;
  color?: string;
  intensity?: number;
  enabled?: boolean;
}

export interface LDBloomOptions {
  enabled: boolean;
  targets: LDBloomTarget[];
  mode: LDBloomMode;
  strength: number;
  radius: number;
  threshold: number;
  quality: LDBloomQualityMode;
  msaa: number;
  softShadow: boolean;
}

export declare interface LDBloomInterface {
  bloom: boolean;
  bloomTargets: string | null;
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
    enabled: boolean
  ): void;
  getSceneNames(): { objects: string[]; materials: string[] };
  getBloomOptions(): LDBloomOptions;
}

const DEFAULT_BLOOM_STRENGTH = 0.6;
const DEFAULT_BLOOM_RADIUS = 0.2;
const DEFAULT_BLOOM_THRESHOLD = 0.05;
const DEFAULT_BLOOM_MSAA = 4;
const SMART_IDLE_MS = 250;
const MIN_SHADOW_BLOOM_SCALE = 3;
const AO_OPTION_PROPERTIES = [
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
] as const;

const $composer = Symbol('composer');
const $targets = Symbol('targets');
const $qualityTimer = Symbol('qualityTimer');
const $handleCameraChange = Symbol('handleCameraChange');
const $parseTargets = Symbol('parseTargets');
const $syncBloom = Symbol('syncBloom');
const $ensureComposer = Symbol('ensureComposer');

type AmbientOcclusionHost = {
  ambientOcclusion?: boolean;
  getAmbientOcclusionOptions?: () => AmbientOcclusionOptions;
};

type RenderPipelineHost = {
  ldRenderPipelineActive?: boolean;
};

type LDBloomHost = LDBloomInterface & ModelViewerElementBase &
  AmbientOcclusionHost & RenderPipelineHost;

export class LDBloomComposer implements EffectComposerInterface {
  private bloomComposer?: EffectComposer;
  private finalComposer?: EffectComposer;
  private bloomPass?: UnrealBloomPass | BloomPass;
  private blendPass?: ShaderPass;
  private outputPass?: OutputPass;
  private aoPass?: AOPass;
  private finalRenderTarget?: WebGLRenderTarget;
  private finalDepthTexture?: DepthTexture;
  private renderer?: WebGLRenderer;
  private scene?: ModelScene;
  private camera?: Camera;
  private activeMsaa = 0;
  private targets: LDBloomTarget[] = [];
  // Non-targeted meshes whose material was swapped out for an opaque black
  // stand-in during the bloom pass. Opaque non-targets *must* still be drawn
  // (in black) so that they correctly occlude bright targeted meshes behind
  // them — otherwise the bloom of e.g. a car's rear tail-lights would leak
  // through the front of the body when the camera is on the other side.
  private savedMaterials = new Map<Object3D, Material | Material[]>();
  // Non-targeted meshes whose visibility was toggled off for the bloom pass.
  // We hide *transparent* non-targets (e.g. a tail-light's outer red glass)
  // rather than swapping their material — replacing them with opaque black
  // would turn a see-through cover into a wall and silently kill the bloom of
  // the emissive mesh sitting right behind it.
  private hiddenObjects: Object3D[] = [];
  private savedEmissive = new Map<
    Material,
    { emissive?: Color; emissiveIntensity?: number }
  >();
  private savedBackground: Color | Texture | null = null;
  // True only between darkenNonTargeted and the matching restoreNonTargeted.
  // Without this guard, calling restoreNonTargeted outside a render cycle (eg
  // from dispose()) would write the still-null savedBackground onto the live
  // scene, permanently blanking the skybox.
  private hasDarkenedState = false;

  constructor(private readonly host: LDBloomHost) {}

  setTargets(targets: LDBloomTarget[]): void {
    this.targets = targets;
  }

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
    this.bloomComposer?.setSize(width, height);
    this.finalComposer?.setSize(width, height);
    this.finalRenderTarget?.setSize(width, height);
    this.aoPass?.setSize(width, height);
    this.bloomPass?.setSize(width, height);
  }

  beforeRender(_time: DOMHighResTimeStamp, _delta: DOMHighResTimeStamp): void {}

  render(deltaTime?: DOMHighResTimeStamp): void {
    if (
      !this.bloomComposer ||
      !this.finalComposer ||
      !this.renderer ||
      !this.scene
    ) {
      return;
    }

    const previousToneMapping = this.renderer.toneMapping;
    this.renderer.toneMapping = this.scene.toneMapping as ToneMapping;

    // Force a transparent clear color so the WebGL canvas itself stays
    // alpha=0 in pixels not covered by scene content. Combined with the
    // alpha-aware additive blend below (see ADDITIVE_BLEND_FRAG), this
    // lets the model-viewer's CSS `background` show through whenever the
    // user disables the skybox.
    const previousClearAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearAlpha(0);

    const renderBloomInput = () => {
      if (this.targets.length > 0) {
        this.darkenNonTargeted();
        this.bloomComposer!.render(deltaTime);
        this.restoreNonTargeted();
      } else {
        this.bloomComposer!.render(deltaTime);
      }
    };

    const renderFinalComposite = () => {
      this.updateBlendPassParams();
      if (this.aoPass == null) {
        this.finalComposer!.render(deltaTime);
        return;
      }

      const previousAutoClear = this.renderer!.autoClear;
      const previousOutputColorSpace = this.renderer!.outputColorSpace;
      this.renderer!.autoClear = false;
      this.renderer!.toneMapping = NoToneMapping;
      this.renderer!.outputColorSpace = LinearSRGBColorSpace;
      this.finalComposer!.render(deltaTime);
      this.renderer!.autoClear = previousAutoClear;
      this.renderer!.outputColorSpace = previousOutputColorSpace;
    };

    const shadow = this.scene.shadow;
    if (this.host.bloomSoftShadow && shadow != null) {
      this.runWithPaddedShadowPlane(shadow, () => {
        renderBloomInput();
        renderFinalComposite();
      });
    } else {
      this.runWithShadowBloomState(renderBloomInput);
      renderFinalComposite();
    }

    this.renderer.setClearAlpha(previousClearAlpha);
    this.renderer.toneMapping = previousToneMapping;
  }

  private updateBlendPassParams(): void {
    const material = this.blendPass?.material as ShaderMaterial | undefined;
    if (material == null) {
      return;
    }
    material.uniforms['bloomSoftShadow'].value = this.host.bloomSoftShadow;
  }

  updatePass(): void {
    this.rebuild();
  }

  setActiveMsaa(msaa: number): void {
    const effectiveMsaa = this.host.ambientOcclusion ? 0 : msaa;
    if (this.activeMsaa === effectiveMsaa) {
      return;
    }
    this.activeMsaa = effectiveMsaa;
    this.rebuild();
  }

  dispose(): void {
    this.restoreNonTargeted();
    this.bloomPass?.dispose();
    this.aoPass?.dispose();
    this.outputPass?.dispose();
    this.bloomComposer?.dispose();
    this.finalComposer?.dispose();
    this.finalRenderTarget?.dispose();
    this.finalDepthTexture?.dispose?.();
    this.bloomPass = undefined;
    this.blendPass = undefined;
    this.outputPass = undefined;
    this.aoPass = undefined;
    this.bloomComposer = undefined;
    this.finalComposer = undefined;
    this.finalRenderTarget = undefined;
    this.finalDepthTexture = undefined;
  }

  runWithShadowBloomState(callback: () => void): void {
    const shadow = this.scene?.shadow;
    if (shadow == null) {
      callback();
      return;
    }

    if (this.host.bloomSoftShadow) {
      this.runWithPaddedShadowPlane(shadow, callback);
      return;
    }

    const previousVisible = shadow.visible;
    shadow.visible = false;
    try {
      callback();
    } finally {
      shadow.visible = previousVisible;
    }
  }

  private runWithPaddedShadowPlane(
    shadow: Object3D,
    callback: () => void
  ): void {
    const floor = (shadow as unknown as { floor?: Object3D }).floor;
    const shadowCamera = (shadow as unknown as { camera?: Object3D }).camera;
    if (floor == null || shadowCamera == null) {
      callback();
      return;
    }

    const previousScale = floor.scale.clone();
    const previousCameraScale = shadowCamera.scale.clone();
    const scale = Math.max(
      MIN_SHADOW_BLOOM_SCALE,
      1 + Math.max(0, this.host.bloomRadius) * 4
    );
    shadowCamera.scale.multiplyScalar(scale);
    if (
      this.renderer != null &&
      this.scene != null &&
      'render' in shadow &&
      typeof shadow.render === 'function'
    ) {
      shadow.render(this.renderer, this.scene);
    }
    try {
      callback();
    } finally {
      floor.scale.copy(previousScale);
      shadowCamera.scale.copy(previousCameraScale);
      if ('needsUpdate' in shadow) {
        shadow.needsUpdate = true;
      }
    }
  }

  private isBloomSoftShadowObject(object: Object3D): boolean {
    const shadow = this.scene?.shadow;
    if (!this.host.bloomSoftShadow || shadow == null) {
      return false;
    }

    let current: Object3D | null = object;
    while (current != null) {
      if (current === shadow) {
        return true;
      }
      current = current.parent;
    }
    return false;
  }

  private findTarget(
    object: Object3D,
    material: Material
  ): LDBloomTarget | undefined {
    return this.targets.find(
      (t) =>
        t.enabled !== false &&
        (t.mesh === object.name || t.material === material.name)
    );
  }

  private darkenNonTargeted(): void {
    // Disable the scene background so the HDR skybox doesn't bloom
    this.savedBackground = this.scene!.background as Color | Texture | null;
    this.scene!.background = null;
    this.hasDarkenedState = true;

    this.scene!.traverse((object: Object3D) => {
      if (this.isBloomSoftShadowObject(object)) {
        return;
      }

      if (!(object as Mesh).isMesh) {
        return;
      }
      const mesh = object as Mesh;
      const objectMaterials = materialsForObject(object);
      const matched = objectMaterials.some((m) => !!this.findTarget(object, m));

      if (matched) {
        // Boost emissive so the mesh is bright enough to exceed bloom threshold
        for (const material of objectMaterials) {
          const target = this.findTarget(object, material);
          if (!target) {
            continue;
          }
          if ('emissive' in material) {
            const std = material as MeshStandardMaterial;
            this.savedEmissive.set(material, {
              emissive: std.emissive.clone(),
              emissiveIntensity: std.emissiveIntensity,
            });
            std.emissive.set(
              (target.color ?? '#ffffff') as ColorRepresentation
            );
            std.emissiveIntensity = target.intensity ?? this.host.bloomStrength;
            material.needsUpdate = true;
          } else if ('color' in material) {
            // MeshBasicMaterial — boost color directly
            const basic = material as MeshBasicMaterial;
            this.savedEmissive.set(material, { emissive: basic.color.clone() });
            basic.color.set((target.color ?? '#ffffff') as ColorRepresentation);
            material.needsUpdate = true;
          }
        }
      } else if (mesh.visible) {
        // Non-targeted meshes need different treatment depending on whether
        // they are transparent:
        //
        //   * Opaque → swap to BLACK_MATERIAL so they still occlude. Without
        //     this, a targeted emissive mesh (e.g. a car's rear tail-light)
        //     would bloom *through* the rest of the body when viewed from
        //     the opposite side, as if the car were transparent.
        //
        //   * Transparent → hide entirely. Replacing a see-through cover
        //     (e.g. a tail-light's outer red glass) with opaque black would
        //     turn it into a wall and silently kill the bloom of the
        //     emissive mesh sitting right behind it.
        if (objectMaterials.some((m) => isTransparent(m))) {
          mesh.visible = false;
          this.hiddenObjects.push(mesh);
        } else {
          this.savedMaterials.set(object, mesh.material);
          mesh.material = BLACK_MATERIAL;
        }
      }
    });
  }

  private restoreNonTargeted(): void {
    if (!this.hasDarkenedState) {
      return;
    }

    if (this.scene != null) {
      this.scene.background = this.savedBackground;
    }
    this.savedBackground = null;

    for (const object of this.hiddenObjects) {
      object.visible = true;
    }
    this.hiddenObjects.length = 0;

    this.savedMaterials.forEach((mat, object) => {
      (object as Mesh).material = mat as Material;
    });
    this.savedMaterials.clear();

    this.savedEmissive.forEach((saved, material) => {
      if ('emissive' in material && saved.emissive) {
        (material as MeshStandardMaterial).emissive.copy(saved.emissive);
        if (saved.emissiveIntensity !== undefined) {
          (material as MeshStandardMaterial).emissiveIntensity =
            saved.emissiveIntensity;
        }
      } else if ('color' in material && saved.emissive) {
        (material as MeshBasicMaterial).color.copy(saved.emissive);
      }
      material.needsUpdate = true;
    });
    this.savedEmissive.clear();

    this.hasDarkenedState = false;
  }

  private rebuild(): void {
    if (!this.renderer || !this.scene || !this.camera) {
      return;
    }

    this.dispose();

    // Shared render pass — reused by both composers so we only render the
    // scene once per pass (Three.js selective bloom pattern).
    const renderPass = new RenderPass(this.scene, this.camera);

    // Bloom composer: renders to its own internal offscreen buffers.
    // Do NOT pass a render target — let EffectComposer create its own so
    // the ping-pong buffer state stays predictable.
    this.bloomComposer = new EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.setPixelRatio(1);
    this.bloomComposer.addPass(renderPass);

    if (this.host.bloomMode === 'classic') {
      this.bloomPass = new BloomPass(this.host.bloomStrength);
    } else {
      this.bloomPass = new UnrealBloomPass(
        new Vector2(1, 1),
        this.host.bloomStrength,
        this.host.bloomRadius,
        this.host.bloomThreshold
      );
    }
    this.updateBloomParams();
    this.bloomComposer.addPass(this.bloomPass);

    // After bloomComposer.render(), result is always in renderTarget2 because
    // 2 passes × needsSwap=true returns buffers to their initial positions.
    // Set the reference once at build time (Three.js example pattern).
    this.blendPass = new ShaderPass(
      new ShaderMaterial({
        uniforms: {
          baseTexture: { value: null },
          bloomTexture: { value: this.bloomComposer.renderTarget2.texture },
          bloomSoftShadow: { value: this.host.bloomSoftShadow },
        },
        vertexShader: ADDITIVE_BLEND_VERT,
        fragmentShader: ADDITIVE_BLEND_FRAG,
      }),
      'baseTexture'
    );
    this.blendPass.needsSwap = true;

    // Final composer: renders the full scene, optionally applies AO,
    // additively blends bloom, then tone-maps + sRGB-converts to the canvas via
    // OutputPass.
    //
    // The intermediate render targets are linear / unmapped, so we MUST end
    // with OutputPass — otherwise renderer.toneMappingExposure (driven by the
    // model-viewer `exposure` property) is never read and the exposure
    // control silently does nothing whenever bloom is enabled.
    this.outputPass = new OutputPass();
    const outputPassRender = this.outputPass.render.bind(this.outputPass);
    this.outputPass.render = (
      renderer: WebGLRenderer,
      writeBuffer: WebGLRenderTarget,
      readBuffer: WebGLRenderTarget,
      deltaTime?: number,
      maskActive?: boolean
    ) => {
      const previousToneMapping = renderer.toneMapping;
      const previousOutputColorSpace = renderer.outputColorSpace;
      renderer.toneMapping = this.scene?.toneMapping ?? previousToneMapping;
      renderer.outputColorSpace = SRGBColorSpace;
      outputPassRender(
        renderer,
        writeBuffer,
        readBuffer,
        deltaTime ?? 0,
        maskActive ?? false
      );
      renderer.toneMapping = previousToneMapping;
      renderer.outputColorSpace = previousOutputColorSpace;
    };
    const ambientOcclusionOptions = this.getAmbientOcclusionOptions();
    if (ambientOcclusionOptions != null) {
      this.finalDepthTexture = new DepthTexture(
        this.scene.width,
        this.scene.height
      );
      this.finalRenderTarget = new WebGLRenderTarget(
        this.scene.width,
        this.scene.height,
        {
          depthTexture: this.finalDepthTexture,
          type: HalfFloatType,
          // AOPass reads the render target depth texture directly. Multisampled
          // depth is resolved separately by WebGL, so keep the AO base target
          // single-sampled even when bloom smart quality returns to idle MSAA.
          samples: 0,
        }
      );
      this.finalRenderTarget.texture.colorSpace = LinearSRGBColorSpace;
      this.finalComposer =
        new EffectComposer(this.renderer, this.finalRenderTarget);
    } else {
      this.finalComposer = new EffectComposer(this.renderer);
    }
    this.finalComposer.setPixelRatio(1);
    this.finalComposer.addPass(renderPass);
    if (ambientOcclusionOptions != null && this.finalDepthTexture != null) {
      this.aoPass = new AOPass(
        this.scene,
        this.camera,
        this.scene.width,
        this.scene.height,
        undefined,
        undefined,
        undefined
      );
      this.aoPass.setGBuffer(this.finalDepthTexture, undefined);
      this.finalComposer.addPass(this.aoPass);
      this.updateAmbientOcclusionPass(ambientOcclusionOptions);
    }
    this.finalComposer.addPass(this.blendPass);
    this.finalComposer.addPass(this.outputPass);
    this.updateBlendPassParams();

    const dpr = window.devicePixelRatio || 1;
    this.setSize(this.scene.width * dpr, this.scene.height * dpr);
    this.disableAmbientOcclusionMultisampling();
  }

  private disableAmbientOcclusionMultisampling(): void {
    if (this.aoPass == null || this.finalRenderTarget == null) {
      return;
    }

    this.finalRenderTarget.samples = 0;
    if (this.finalComposer != null) {
      this.finalComposer.renderTarget1.samples = 0;
      this.finalComposer.renderTarget2.samples = 0;
    }
  }

  private getAmbientOcclusionOptions(): AmbientOcclusionOptions | null {
    if (
      !this.host.ambientOcclusion ||
      typeof this.host.getAmbientOcclusionOptions !== 'function'
    ) {
      return null;
    }

    return this.host.getAmbientOcclusionOptions();
  }

  private updateAmbientOcclusionPass(options: AmbientOcclusionOptions): void {
    if (this.aoPass == null) {
      return;
    }

    const sceneRadius = this.scene?.boundingSphere?.radius ?? 1.0;
    const radiusScale = 1.0 / Math.max(sceneRadius, 0.5);
    const fineTuneFactor = 0.1;
    const scaledRadius = options.radius * radiusScale * fineTuneFactor;
    const scaledThickness = options.thickness * radiusScale * fineTuneFactor;

    const aoPass = this.aoPass as AOPass & {
      intensity: number;
      output: number;
    };

    aoPass.intensity = options.intensity;
    aoPass.output = options.output;
    aoPass.updateAoMaterial({
      algorithm: options.algorithm,
      radius: scaledRadius,
      distanceExponent: options.distanceExponent,
      thickness: scaledThickness,
      distanceFallOff: options.distanceFallOff,
      bias: options.bias,
      scale: options.scale,
      samples: options.samples,
      nvAlignedSamples: options.nvAlignedSamples ? 1 : 0,
      screenSpaceRadius: options.screenSpaceRadius ? 1 : 0,
      aoNoiseType: options.aoNoiseType,
    });
    aoPass.updatePdMaterial({
      lumaPhi: options.pdLumaPhi,
      depthPhi: options.pdDepthPhi,
      normalPhi: options.pdNormalPhi,
      radius: options.pdRadius,
      radiusExponent: options.pdRadiusExponent,
      rings: options.pdRings,
      samples: options.pdSamples,
    });
  }

  private updateBloomParams(): void {
    if (!this.bloomPass) {
      return;
    }
    this.bloomPass.enabled = true;
    if (this.bloomPass instanceof UnrealBloomPass) {
      this.bloomPass.strength = this.host.bloomStrength;
      this.bloomPass.radius = this.host.bloomRadius;
      this.bloomPass.threshold = this.host.bloomThreshold;
    } else {
      (
        this.bloomPass as BloomPass & { combineUniforms: Record<string, any> }
      ).combineUniforms['strength'].value = this.host.bloomStrength;
    }
  }
}

const ADDITIVE_BLEND_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The Three.js UnrealBloomPass internally uses a Gaussian-blur shader that
// hard-codes the bloom output's alpha to 1.0 *everywhere*. Naively summing
// (base + bloom) for the final composite would therefore force the canvas
// alpha to 1 across every pixel, producing an opaque black canvas in
// transparent regions of the scene — which silently hides the model-
// viewer's CSS `background` whenever the user turns the skybox off.
//
// We deliberately drop bloom's bogus alpha and inherit alpha from the
// scene render pass. Three.js renders to a `premultipliedAlpha: true`
// canvas, which the browser composites as
// `displayed = stored.rgb + bg * (1 - stored.a)`. With this rule:
//   * mesh pixels (base.a = 1) appear fully opaque, with bloom added on
//     top as the usual `mesh + bloom` highlight;
//   * bloom-halo pixels outside the silhouette of the emissive mesh
//     (base.a = 0) store rgb = bloom.rgb, alpha = 0, and the browser
//     composites them as `bloom.rgb + bg`, so a coloured halo glows
//     additively over whatever CSS background the page has chosen;
//   * empty pixels (no mesh, no bloom) store rgb = 0, alpha = 0 and the
//     CSS background shows through unchanged.
const ADDITIVE_BLEND_FRAG = `
  uniform sampler2D baseTexture;
  uniform sampler2D bloomTexture;
  uniform bool bloomSoftShadow;
  varying vec2 vUv;
  void main() {
    vec4 base = texture2D(baseTexture, vUv);
    vec4 bloom = texture2D(bloomTexture, vUv);
    // model-viewer's generated soft shadow is a semi-transparent plane in the
    // base render. When shadow bloom is disabled, keep bloom off those
    // semi-transparent pixels while still allowing bloom on opaque model pixels
    // and empty CSS-background pixels.
    float isEmpty = 1.0 - step(0.001, base.a);
    float isOpaque = step(0.999, base.a);
    float bloomFactor = bloomSoftShadow ? 1.0 : clamp(isEmpty + isOpaque, 0.0, 1.0);
    gl_FragColor = vec4(base.rgb + bloom.rgb * bloomFactor, base.a);
  }
`;

// Shared opaque-black stand-in for non-target meshes during the bloom pass.
// Drawing these meshes (instead of hiding them) preserves depth-buffer
// occlusion so the rest of the model can correctly hide bright targeted
// meshes that are physically behind it from the camera's point of view.
const BLACK_MATERIAL = new MeshBasicMaterial({ color: 0x000000 });

// A material is treated as transparent for occlusion purposes if it would
// not write a fully-opaque pixel into the depth buffer. We err on the side
// of "transparent" (= hide instead of replace) because failing to occlude
// is a much milder visual artefact than turning a glass cover into a wall
// and silently killing a bloom that the user explicitly asked for.
const isTransparent = (material: Material | null | undefined): boolean => {
  if (!material) {
    return false;
  }
  if (material.transparent) {
    return true;
  }
  if ('alphaMap' in material && (material as MeshStandardMaterial).alphaMap) {
    return true;
  }
  if (material.alphaTest > 0) {
    return true;
  }
  return false;
};

const materialsForObject = (object: Object3D): Material[] => {
  const material = (object as Mesh).material;
  if (!material) {
    return [];
  }
  return Array.isArray(material) ? material : [material];
};

const cloneTargets = (targets: LDBloomTarget[]): LDBloomTarget[] =>
  targets.map((target) => ({ ...target }));

export const LDBloomMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDBloomInterface> & T => {
  class LDBloomModelViewerElement extends ModelViewerElement {
    @property({ type: Boolean, attribute: 'bloom' })
    bloom = false;

    @property({ type: String, attribute: 'bloom-targets' })
    bloomTargets: string | null = null;

    @property({ type: String, attribute: 'bloom-mode' })
    bloomMode: LDBloomMode = 'unreal';

    @property({ type: Number, attribute: 'bloom-strength' })
    bloomStrength = DEFAULT_BLOOM_STRENGTH;

    @property({ type: Number, attribute: 'bloom-radius' })
    bloomRadius = DEFAULT_BLOOM_RADIUS;

    @property({ type: Number, attribute: 'bloom-threshold' })
    bloomThreshold = DEFAULT_BLOOM_THRESHOLD;

    @property({ type: String, attribute: 'bloom-quality' })
    bloomQuality: LDBloomQualityMode = 'quality';

    @property({ type: Number, attribute: 'bloom-msaa' })
    bloomMsaa = DEFAULT_BLOOM_MSAA;

    @property({ type: Boolean, attribute: 'bloom-soft-shadow' })
    bloomSoftShadow = false;

    private [$composer]: LDBloomComposer | null = null;
    private [$targets]: LDBloomTarget[] = [];
    private [$qualityTimer]: number | null = null;

    connectedCallback() {
      super.connectedCallback();
      this.addEventListener('camera-change', this[$handleCameraChange]);
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.removeEventListener('camera-change', this[$handleCameraChange]);
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

    getBloomOptions(): LDBloomOptions {
      return {
        enabled: this.bloom,
        targets: this[$targets].filter(
          (target) => !!(target.material || target.mesh)
        ),
        mode: this.bloomMode,
        strength: this.bloomStrength,
        radius: this.bloomRadius,
        threshold: this.bloomThreshold,
        quality: this.bloomQuality,
        msaa: this.bloomMsaa,
        softShadow: this.bloomSoftShadow,
      };
    }

    getSceneNames(): { objects: string[]; materials: string[] } {
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
      enabled: boolean
    ): void {
      this[$targets] = this[$targets].map((target) => {
        if (target[kind] === name) {
          return { ...target, enabled };
        }
        return target;
      });
      this.bloomTargets = JSON.stringify(this[$targets]);
      this[$syncBloom]();
    }

    updated(changedProperties: Map<string | number | symbol, unknown>) {
      super.updated(changedProperties);

      if (changedProperties.has('bloomTargets')) {
        this[$parseTargets]();
      }

      if (
        changedProperties.has('bloomMode') ||
        changedProperties.has('bloomStrength') ||
        changedProperties.has('bloomRadius') ||
        changedProperties.has('bloomThreshold') ||
        changedProperties.has('bloomMsaa') ||
        AO_OPTION_PROPERTIES.some((prop) => changedProperties.has(prop))
      ) {
        this[$composer]?.updatePass();
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
        AO_OPTION_PROPERTIES.some((prop) => changedProperties.has(prop))
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
        this.bloomMode !== 'unreal' ||
        this.shouldDisableBloomMsaa()
      ) {
        return;
      }

      this[$composer]?.setActiveMsaa(0);
      if (this[$qualityTimer] != null) {
        window.clearTimeout(this[$qualityTimer]);
      }
      this[$qualityTimer] = window.setTimeout(() => {
        this[$qualityTimer] = null;
        this[$composer]?.setActiveMsaa(this.getEffectiveBloomMsaa());
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

    private [$ensureComposer](): void {
      if (this[$composer] == null) {
        this[$composer] = new LDBloomComposer(this);
      }
      this[$composer].setActiveMsaa(this.getEffectiveBloomMsaa());
      this.registerEffectComposer(this[$composer]);
    }

    private getEffectiveBloomMsaa(): number {
      if (this.bloomQuality === 'performance' || this.shouldDisableBloomMsaa()) {
        return 0;
      }

      return this.bloomMsaa;
    }

    private shouldDisableBloomMsaa(): boolean {
      return Boolean((this as AmbientOcclusionHost).ambientOcclusion);
    }

    private shouldDeferToRenderPipeline(): boolean {
      return Boolean((this as RenderPipelineHost).ldRenderPipelineActive);
    }

    private [$syncBloom](): void {
      if (!this.bloom) {
        if (this[$scene].effectRenderer === this[$composer]) {
          this.unregisterEffectComposer();
        }
        this[$needsRender]();
        return;
      }

      // Pass all named targets to the composer (including disabled ones) so
      // that an explicit but fully-disabled target list still suppresses
      // global bloom: the composer keeps the selective-masking pipeline,
      // findTarget skips disabled entries, and every mesh ends up darkened.
      const namedTargets = this[$targets].filter(
        (t) => !!(t.material || t.mesh)
      );

      if (this.shouldDeferToRenderPipeline()) {
        this[$composer]?.setTargets(namedTargets);
        this[$scene].queueRender();
        this[$needsRender]();
        return;
      }

      this[$ensureComposer]();
      this[$composer]!.setTargets(namedTargets);
      this[$scene].queueRender();
      this[$needsRender]();
    }
  }

  return LDBloomModelViewerElement;
};
