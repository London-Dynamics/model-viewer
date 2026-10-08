/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {property} from 'lit/decorators.js';
import {DirectionalLight, Texture, Vector3} from 'three';

import ModelViewerElementBase, {$needsRender, $renderer, $scene, $tick} from '../model-viewer-base.js';
import {Constructor} from '../utilities.js';

import {
  attachLDWaterSky,
  directionFromSkySun,
  loadLDWaterSkyTexture,
  parseSkySunTime,
  sunFromSkyProClock,
} from './ld-water.js';

/**
 * Intensity of the sky-only sun. Matches the dusk preset the hero clock
 * was authored against. With water on, the water preset's own sun
 * intensity is used instead.
 */
const LD_SKY_SUN_INTENSITY = 2;

export interface LDSkyView {
  dispose(): void;
  followCamera(camera: unknown): void;
  getMeshes(): {parent: unknown, removeFromParent(): void}[];
  getEnvironmentTexture(): Texture;
  brightness?: number;
  sunEnabledUniform?: {value: number};
}

export declare interface LDSkyInterface {
  /**
   * Vendor sky dome. Off by default. Overrides the page skybox while on.
   * The dome is a WebGPU material, so this requests the WebGPU renderer.
   * Turning it off does not restore WebGL. It does not replace the
   * environment map unless `sky-environment` is also set.
   */
  sky: boolean;
  /** Equirectangular image for the vendor sky. Unused until `sky` is set. */
  skyImage: string|null;
  /** Downsample `sky-image` to this width. Null keeps the file. */
  skySize: number|null;
  /** Dome brightness. Default 1. Does not change exposure. */
  skyBrightness: number;
  /**
   * Sun clock as `H:MM` or `HH:MM`. Off when unset. Independent of `sky`
   * and of `water`. Does not by itself switch to WebGPU.
   */
  skySunTime: string|null;
  /**
   * Use the vendor sky as the environment map. Off by default, so a visible
   * sky still leaves the page `environment-image` as the lighting.
   */
  skyEnvironment: boolean;
  /** The vendor sky, once built. Water reads this for reflections. */
  readonly activeSky: LDSkyView|null;
}

/**
 * Opt-in vendor sky and sun. Neither attribute is required for water.
 * Water uses them when they are set, and otherwise keeps the page
 * environment and lights.
 */
export const LDSkyMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDSkyInterface> & T => {
  class LDSkyModelViewerElement extends ModelViewerElement {
    @property({type: Boolean, attribute: 'sky'})
    sky = false;

    @property({type: String, attribute: 'sky-image'})
    skyImage: string|null = null;

    @property({type: Number, attribute: 'sky-size'})
    skySize: number|null = null;

    @property({type: Number, attribute: 'sky-brightness'})
    skyBrightness = 1;

    @property({type: String, attribute: 'sky-sun-time'})
    skySunTime: string|null = null;

    @property({type: Boolean, attribute: 'sky-environment'})
    skyEnvironment = false;

    private skyObject: LDSkyView|null = null;
    private skyLoadId = 0;
    private skyLoadedKey: string|null = null;
    private skySunLight: DirectionalLight|null = null;
    private skySunDirection: {value: Vector3}|null = null;
    private savedSkybox: unknown = null;
    private skyboxHidden = false;
    private savedEnvironment: Texture|null = null;

    get activeSky(): LDSkyView|null {
      return this.sky ? this.skyObject : null;
    }

    connectedCallback() {
      super.connectedCallback();
      this.updateComplete.then(() => {
        if (this.isConnected && (this.sky || this.skySunTime != null)) {
          this.syncSky();
          this.syncSunLight();
        }
      });
    }

    updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);
      if (
        changedProperties.has('sky') ||
        changedProperties.has('skyImage') ||
        changedProperties.has('skySize') ||
        changedProperties.has('skyBrightness') ||
        changedProperties.has('skyEnvironment') ||
        changedProperties.has('water')
      ) {
        this.syncSky();
      }
      if (
        changedProperties.has('skySunTime') ||
        changedProperties.has('sky') ||
        changedProperties.has('water')
      ) {
        this.syncSunLight();
      }
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.skyLoadId++;
      this.teardownSky();
    }

    [$tick](time: number, delta: number) {
      this.syncSunLight();
      super[$tick](time, delta);
      this.holdSkyPlacement();
    }

    private waterIsActive(): boolean {
      return (this as unknown as {waterActive?: boolean}).waterActive === true;
    }

    private async syncSky() {
      const loadId = ++this.skyLoadId;
      if (!this.sky || this.skyImage == null) {
        this.teardownSky();
        return;
      }

      const key = `${this.skyImage}|${this.skySize ?? ''}`;
      if (this.skyObject != null && this.skyLoadedKey === key) {
        this.skyObject.brightness = this.skyBrightness;
        this.holdSkyPlacement();
        return;
      }

      try {
        this.releaseWebGLPostStack();
        await this[$renderer].requestBackend('webgpu');
        this.releaseWebGLPostStack();
        const renderer = this[$renderer].threeRenderer as {isWebGPURenderer?: boolean};
        if (renderer?.isWebGPURenderer !== true) {
          throw new Error(
            'The vendor sky is a WebGPU material and this renderer is WebGL.'
          );
        }
        const texture = await loadLDWaterSkyTexture(this.skyImage, this.skySize);
        if (loadId !== this.skyLoadId || !this.sky) {
          return;
        }
        const waterModule = await import('threejs-water-pro');
        const webgpu = await import('three/webgpu') as any;
        const tsl = webgpu.TSL as {uniform: (value: Vector3) => {value: Vector3}};
        if (this.skySunDirection == null) {
          this.skySunDirection = tsl.uniform(new Vector3(0, 1, 0));
        }
        this.teardownSky();
        const sky = attachLDWaterSky(
          {lighting: {sun: {direction: this.skySunDirection}}, setSky() {}} as any,
          renderer,
          waterModule,
          texture,
          0.15,
          this.skyBrightness
        ) as LDSkyView;
        if (loadId !== this.skyLoadId || !this.sky) {
          sky.dispose();
          return;
        }
        this.skyObject = sky;
        this.skyLoadedKey = key;
        this.holdSkyPlacement();
        this[$needsRender]();
      } catch (error) {
        if (loadId === this.skyLoadId) {
          this.dispatchEvent(new CustomEvent('sky-error', {detail: {error}}));
        }
      }
    }

    private holdSkyPlacement() {
      const sky = this.skyObject;
      if (!this.sky || sky == null) {
        this.restorePageSkybox();
        this.restorePageEnvironment();
        return;
      }

      if (!this.waterIsActive()) {
        const scene = this[$scene];
        for (const mesh of sky.getMeshes()) {
          if (mesh.parent !== scene) {
            scene.add(mesh as any);
          }
        }
        sky.followCamera(scene.camera);
      }
      this.hidePageSkybox();
      this.syncSkyDisk();
      if (!this.waterIsActive()) {
        this.syncSkyEnvironment();
      }
    }

    private syncSkyDisk() {
      const disk = this.skyObject?.sunEnabledUniform;
      if (disk == null) {
        return;
      }
      disk.value = parseSkySunTime(this.skySunTime) != null ? 1 : 0;
    }

    private hidePageSkybox() {
      if (this.skyboxHidden) {
        return;
      }
      const scene = this[$scene] as any;
      this.savedSkybox = scene.groundedSkybox?.map ?? scene.background ?? null;
      if (scene.groundedSkybox?.parent != null) {
        scene.target.remove(scene.groundedSkybox);
      }
      scene.background = null;
      this.skyboxHidden = true;
    }

    private restorePageSkybox() {
      if (!this.skyboxHidden) {
        return;
      }
      const texture = this.savedSkybox;
      this.savedSkybox = null;
      this.skyboxHidden = false;
      this[$scene].setBackground(texture as Texture|null);
    }

    private syncSkyEnvironment() {
      const scene = this[$scene] as {environment: Texture|null, environmentNode?: unknown};
      const skyTexture = this.skyObject?.getEnvironmentTexture() ?? null;
      if (this.skyEnvironment && skyTexture != null) {
        if (this.savedEnvironment == null && scene.environment !== skyTexture) {
          this.savedEnvironment = scene.environment;
        }
        scene.environment = skyTexture;
        scene.environmentNode = null;
        return;
      }
      this.restorePageEnvironment();
    }

    private restorePageEnvironment() {
      if (this.savedEnvironment == null && this.skyEnvironment !== true) {
        return;
      }
      const scene = this[$scene] as {environment: Texture|null, environmentNode?: unknown};
      if (this.savedEnvironment != null) {
        scene.environment = this.savedEnvironment;
        scene.environmentNode = null;
      }
      this.savedEnvironment = null;
    }

    private syncSunLight() {
      const parsed = parseSkySunTime(this.skySunTime);
      if (this.skySunDirection != null && parsed != null) {
        const angles = sunFromSkyProClock(parsed.hours, parsed.minutes);
        directionFromSkySun(
          angles.elevation, angles.azimuth, this.skySunDirection.value);
      }
      this.syncSkyDisk();

      if (parsed == null || this.waterIsActive()) {
        this.skySunLight?.removeFromParent();
        this.skySunLight = null;
        return;
      }

      if (this.skySunLight == null) {
        this.skySunLight = new DirectionalLight(0xfff8e0, LD_SKY_SUN_INTENSITY);
        this.skySunLight.name = 'LDSkySun';
        this.skySunLight.castShadow = false;
        this[$scene].add(this.skySunLight);
      }
      const aim = this.skySunDirection?.value ??
        directionFromSkySun(
          sunFromSkyProClock(parsed.hours, parsed.minutes).elevation,
          sunFromSkyProClock(parsed.hours, parsed.minutes).azimuth
        );
      this.skySunLight.position.copy(aim).multiplyScalar(150);
      this.skySunLight.intensity = LD_SKY_SUN_INTENSITY;
      this.skySunLight.castShadow = false;
    }

    private teardownSky() {
      if (this.skyObject != null) {
        for (const mesh of this.skyObject.getMeshes()) {
          mesh.removeFromParent();
        }
        this.skyObject.dispose();
        this.skyObject = null;
      }
      this.skyLoadedKey = null;
      this.restorePageSkybox();
      this.restorePageEnvironment();
    }

    private releaseWebGLPostStack() {
      if (this[$scene].effectRenderer == null) {
        return;
      }
      const host = this as unknown as {unregisterEffectComposer?: () => void};
      if (typeof host.unregisterEffectComposer === 'function') {
        host.unregisterEffectComposer();
      }
    }
  }

  return LDSkyModelViewerElement;
};
