/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {
  Camera,
  Color,
  ColorRepresentation,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  ShaderMaterial,
  Texture,
  ToneMapping,
  Vector2,
  WebGLRenderer,
} from 'three';
import {BloomPass} from 'three/examples/jsm/postprocessing/BloomPass.js';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {OutputPass} from 'three/examples/jsm/postprocessing/OutputPass.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import type {ModelScene} from '../../three-components/ModelScene.js';
import type {LDBloomTarget} from '../ld-bloom.js';

import type {LDEffectsHost} from './types.js';

const MIN_SHADOW_BLOOM_SCALE = 3;

export class BloomModule {
  bloomComposer?: EffectComposer;
  finalComposer?: EffectComposer;
  bloomPass?: UnrealBloomPass|BloomPass;
  blendPass?: ShaderPass;
  outputPass?: OutputPass;
  private renderer?: WebGLRenderer;
  private scene?: ModelScene;
  private camera?: Camera;
  activeMsaa = 0;
  targets: LDBloomTarget[] = [];
  private savedMaterials = new Map<Object3D, Material|Material[]>();
  private hiddenObjects: Object3D[] = [];
  private savedEmissive = new Map<
      Material,
      {emissive?: Color, emissiveIntensity?: number}
  >();
  savedBackground: Color|Texture|null = null;
  hasDarkenedState = false;
  private useExternalBase = false;
  private externalBaseTexture: Texture|null = null;
  private deferTerminalOutput = false;

  constructor(private readonly host: LDEffectsHost) {}

  setTargets(targets: LDBloomTarget[]): void {
    this.targets = targets;
  }

  setExternalBase(texture: Texture|null): void {
    this.useExternalBase = texture != null;
    this.externalBaseTexture = texture;
    if (this.blendPass != null && texture != null) {
      const material = this.blendPass.material as ShaderMaterial;
      material.uniforms['baseTexture'].value = texture;
    }
  }

  setDeferTerminalOutput(defer: boolean): void {
    if (this.deferTerminalOutput === defer) {
      return;
    }
    this.deferTerminalOutput = defer;
    this.rebuild();
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
    this.bloomPass?.setSize(width, height);
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
      this.finalComposer!.render(deltaTime);
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
    const material = this.blendPass?.material as ShaderMaterial|undefined;
    if (material == null) {
      return;
    }
    material.uniforms['bloomSoftShadow'].value = this.host.bloomSoftShadow;
    if (this.useExternalBase && this.externalBaseTexture != null) {
      material.uniforms['baseTexture'].value = this.externalBaseTexture;
    }
  }

  dispose(): void {
    this.restoreNonTargeted();
    this.bloomPass?.dispose();
    this.outputPass?.dispose();
    this.bloomComposer?.dispose();
    this.finalComposer?.dispose();
    this.bloomPass = undefined;
    this.blendPass = undefined;
    this.outputPass = undefined;
    this.bloomComposer = undefined;
    this.finalComposer = undefined;
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
      callback: () => void,
      ): void {
    const floor = (shadow as unknown as {floor?: Object3D}).floor;
    const shadowCamera = (shadow as unknown as {camera?: Object3D}).camera;
    if (floor == null || shadowCamera == null) {
      callback();
      return;
    }

    const previousScale = floor.scale.clone();
    const previousCameraScale = shadowCamera.scale.clone();
    const scale = Math.max(
        MIN_SHADOW_BLOOM_SCALE,
        1 + Math.max(0, this.host.bloomRadius) * 4,
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

    let current: Object3D|null = object;
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
      material: Material,
      ): LDBloomTarget|undefined {
    return this.targets.find(
        (t) =>
            t.enabled !== false &&
            (t.mesh === object.name || t.material === material.name),
    );
  }

  darkenNonTargeted(): void {
    this.savedBackground = this.scene!.background as Color|Texture|null;
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
      const matched =
          objectMaterials.some((m) => !!this.findTarget(object, m));

      if (matched) {
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
                (target.color ?? '#ffffff') as ColorRepresentation,
            );
            std.emissiveIntensity =
                target.intensity ?? this.host.bloomStrength;
            material.needsUpdate = true;
          } else if ('color' in material) {
            const basic = material as MeshBasicMaterial;
            this.savedEmissive.set(material, {emissive: basic.color.clone()});
            basic.color.set((target.color ?? '#ffffff') as ColorRepresentation);
            material.needsUpdate = true;
          }
        }
      } else if (mesh.visible) {
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

  restoreNonTargeted(): void {
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

  rebuild(): void {
    if (!this.renderer || !this.scene || !this.camera) {
      return;
    }

    this.dispose();

    const renderPass = new RenderPass(this.scene, this.camera);

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
          this.host.bloomThreshold,
      );
    }
    this.updateBloomParams();
    this.bloomComposer.addPass(this.bloomPass);

    this.blendPass = new ShaderPass(
        new ShaderMaterial({
          uniforms: {
            baseTexture: {value: this.externalBaseTexture},
            bloomTexture: {value: this.bloomComposer.renderTarget2.texture},
            bloomSoftShadow: {value: this.host.bloomSoftShadow},
          },
          vertexShader: ADDITIVE_BLEND_VERT,
          fragmentShader: ADDITIVE_BLEND_FRAG,
        }),
        'baseTexture',
    );
    this.blendPass.needsSwap = true;

    if (!this.deferTerminalOutput) {
      this.outputPass = new OutputPass();
    }

    this.finalComposer = new EffectComposer(this.renderer);
    this.finalComposer.setPixelRatio(1);
    if (!this.useExternalBase) {
      this.finalComposer.addPass(renderPass);
    }
    this.finalComposer.addPass(this.blendPass);
    if (this.outputPass != null) {
      this.finalComposer.addPass(this.outputPass);
    }
    this.updateBlendPassParams();

    const dpr = window.devicePixelRatio || 1;
    this.setSize(this.scene.width * dpr, this.scene.height * dpr);
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
          this.bloomPass as BloomPass&{
            combineUniforms: Record<string, {value: number}>
          }
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

const ADDITIVE_BLEND_FRAG = `
  uniform sampler2D baseTexture;
  uniform sampler2D bloomTexture;
  uniform bool bloomSoftShadow;
  varying vec2 vUv;
  void main() {
    vec4 base = texture2D(baseTexture, vUv);
    vec4 bloom = texture2D(bloomTexture, vUv);
    float isEmpty = 1.0 - step(0.001, base.a);
    float isOpaque = step(0.999, base.a);
    float bloomFactor = bloomSoftShadow ? 1.0 : clamp(isEmpty + isOpaque, 0.0, 1.0);
    gl_FragColor = vec4(base.rgb + bloom.rgb * bloomFactor, base.a);
  }
`;

const BLACK_MATERIAL = new MeshBasicMaterial({color: 0x000000});

const isTransparent = (material: Material|null|undefined): boolean => {
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
