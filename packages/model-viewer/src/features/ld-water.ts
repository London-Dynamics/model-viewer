/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {property} from 'lit/decorators.js';
import {
  Box3,
  DoubleSide,
  EquirectangularReflectionMapping,
  Euler,
  LinearFilter,
  Mesh,
  Object3D,
  PerspectiveCamera,
  RepeatWrapping,
  Texture,
  Vector3,
} from 'three';
import {RGBELoader} from 'three/addons/loaders/RGBELoader.js';
import {UltraHDRLoader} from 'three/addons/loaders/UltraHDRLoader.js';

import ModelViewerElementBase, {
  $needsRender,
  $renderer,
  $scene,
  $tick,
} from '../model-viewer-base.js';
import {Constructor} from '../utilities.js';

import type {
  BuoyancyOptions,
  PresetName as UpstreamWaterPresetName,
  QualityLevel as WaterQualityLevel,
  WaterPreset,
  WaterSystem,
} from 'threejs-water-pro';

export type WaterPresetName =
  'ld-boat'|'ld-boat-real-scale'|UpstreamWaterPresetName;

const WATER_PRESETS = new Set<string>([
  'ld-boat',
  'ld-boat-real-scale',
  'arctic',
  'blackFlag',
  'dusk',
  'foggy',
  'moonlit',
  'seaOfThieves',
  'storm',
  'sunset',
]);

const WATER_QUALITIES = new Set<string>(['low', 'medium', 'high', 'ultra', 'max']);
// v3.5.1 waves are real metres. These match the ld_water_pro hero:
// dusk colour, quality high, wind 6.7 m/s, peak wavelength 22 m, 16:45 sun.
const LD_WATER_HERO_WIND_SPEED = 6.7;
const LD_WATER_HERO_PEAK_WAVELENGTH = 22;
const LD_WATER_HERO_FFT_AMPLITUDE = 1;
const LD_WATER_HERO_SKY_BRIGHTNESS = 1.18;
const LD_WATER_HERO_EXPOSURE = 1.06;
const LD_WATER_REFERENCE_CLIP_PLANE_DISTANCE_METERS = 20;
const LD_WATER_REFERENCE_SCALE = 15;
const LD_WATER_MIN_CAMERA_FAR_METERS = 50000;

export interface LDWaterHullPlacement {
  waterline: number;
  heightOffset: number;
  sampleLength: number;
  sampleWidth: number;
  rotationY: number;
}

const clonePreset = (preset: WaterPreset): WaterPreset =>
  JSON.parse(JSON.stringify(preset)) as WaterPreset;

export declare interface LDWaterInterface {
  water: boolean;
  waterPreset: WaterPresetName;
  waterQuality: WaterQualityLevel;
  waterElevation: number;
  waterSeed: number|null;
  waterSkyImage: string|null;
  /**
   * Metres. The model root is placed at y = 0 when this is 0, and at
   * `-water-waterline` otherwise, so that height meets the lake.
   */
  waterWaterline: number;
  waterSkySize: number|null;
  waterBuoyancy: boolean;
}

type WaterModule = typeof import('threejs-water-pro');

const isWaterPresetName = (value: string): value is WaterPresetName =>
  WATER_PRESETS.has(value);

const isWaterQualityLevel = (value: string): value is WaterQualityLevel =>
  WATER_QUALITIES.has(value);

const isLDWaterHeroPreset = (presetName: WaterPresetName) =>
  presetName === 'ld-boat' || presetName === 'ld-boat-real-scale';

/**
 * Sun angles for Sky Pro's default clock. Latitude 45 peaks the sun at
 * 45° at noon. Azimuth 0 is +Z and 90 is +X. 16:45 is the hero sun.
 */
export const sunFromSkyProClock = (
  hours: number,
  minutes: number,
  latitudeDeg = 45
) => {
  const time = (hours + minutes / 60) / 24;
  const hourAngle = (time - 0.5) * Math.PI * 2;
  const latitude = latitudeDeg * Math.PI / 180;
  const sinElevation = Math.cos(latitude) * Math.cos(hourAngle);
  const elevation = Math.asin(sinElevation) * 180 / Math.PI;
  const east = -Math.sin(hourAngle);
  const north = -Math.sin(latitude) * Math.cos(hourAngle);
  let azimuth = Math.atan2(east, north) * 180 / Math.PI;
  if (azimuth < 0) {
    azimuth += 360;
  }
  return {time, elevation, azimuth};
};

const applyLDWaterHeroLook = (preset: WaterPreset): WaterPreset => {
  const waves = (preset as any).waves?.fft;
  if (waves != null) {
    waves.amplitude = LD_WATER_HERO_FFT_AMPLITUDE;
    waves.windSpeed = LD_WATER_HERO_WIND_SPEED;
    waves.peakWavelength = LD_WATER_HERO_PEAK_WAVELENGTH;
  }
  const sun = sunFromSkyProClock(16, 45);
  const skySun = (preset as any).sky?.sun;
  if (skySun != null) {
    skySun.elevation = sun.elevation;
    skySun.azimuth = sun.azimuth;
    skySun.diskEnabled = true;
  }
  return preset;
};

export const createLDWaterPreset = (
  presetName: WaterPresetName,
  waterModule: Pick<WaterModule, 'getPresetParams'>
): WaterPreset => {
  if (!isWaterPresetName(presetName)) {
    throw new Error(`Unknown water preset: ${presetName}`);
  }

  const upstreamPresetName =
    isLDWaterHeroPreset(presetName) ? 'dusk' : presetName;
  const preset = clonePreset(waterModule.getPresetParams(upstreamPresetName));

  if (isLDWaterHeroPreset(presetName)) {
    return applyLDWaterHeroLook(preset);
  }

  return preset;
};

export const ldWaterHeightOffset = (waterline: number): number =>
  waterline === 0 ? 0 : -waterline;

const isWindowMaterial = (material: {transmission?: number, name?: string}|null) => {
  if (material == null) {
    return false;
  }
  if ((material.transmission ?? 0) > 0) {
    return true;
  }
  return /glass|windshield/i.test(material.name || '');
};

/**
 * Transmission glass is drawn before the water pass, and the hull mask
 * hides every water fragment behind the boat. Windows become a light
 * alpha blend and leave the mask so the lake composites behind them.
 */
export const separateLDWaterWindows = (model: Object3D): number => {
  if (model.userData.ldWaterWindows === true) {
    return 0;
  }
  const parent = model.parent;
  if (parent == null) {
    return 0;
  }
  const windows: Mesh[] = [];
  model.traverse((obj) => {
    const mesh = obj as Mesh;
    if (mesh.isMesh !== true) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!materials.some((material) => isWindowMaterial(material as any))) {
      return;
    }
    for (const material of materials) {
      const windowMaterial = material as any;
      if (!isWindowMaterial(windowMaterial)) {
        continue;
      }
      windowMaterial.transmission = 0;
      windowMaterial.transparent = true;
      windowMaterial.opacity = Math.min(windowMaterial.opacity || 1, 0.2);
      windowMaterial.depthWrite = false;
      windowMaterial.roughness = Math.min(windowMaterial.roughness ?? 0.05, 0.08);
      windowMaterial.side = DoubleSide;
      windowMaterial.needsUpdate = true;
    }
    windows.push(mesh);
  });
  if (windows.length === 0) {
    model.userData.ldWaterWindows = true;
    return 0;
  }
  const glassGroup = new Object3D();
  glassGroup.name = 'windows';
  glassGroup.userData.ldWaterGlass = true;
  parent.add(glassGroup);
  model.updateMatrixWorld(true);
  for (const mesh of windows) {
    glassGroup.attach(mesh);
  }
  model.userData.ldWaterWindows = true;
  return windows.length;
};

/**
 * Drop the model so `waterline` (a glTF height in metres) meets the lake.
 * Authored XZ and yaw stay put. A waterline of 0 leaves the root at y = 0.
 */
export const placeLDWaterHull = (
  model: Object3D,
  waterline: number
): LDWaterHullPlacement => {
  const heightOffset = ldWaterHeightOffset(waterline);
  model.position.y = heightOffset;
  model.updateMatrixWorld(true);
  const size = new Box3().setFromObject(model).getSize(new Vector3());
  const rotationY = new Euler().setFromQuaternion(model.quaternion, 'YXZ').y;
  return {
    waterline,
    heightOffset,
    sampleLength: Math.max(size.z, 0.01) * 0.85,
    sampleWidth: Math.max(size.x, 0.01) * 0.8,
    rotationY,
  };
};

export const registerLDWaterBuoyancy = (
  waterSystem: Pick<WaterSystem, 'buoyancy'|'masking'>,
  model: Object3D,
  placement: LDWaterHullPlacement
): number => {
  const options: BuoyancyOptions = {
    heightOffset: placement.heightOffset,
    heightSmoothing: 0.2,
    multiPoint: true,
    sampleLength: placement.sampleLength,
    sampleWidth: placement.sampleWidth,
    sampleOffset: new Vector3(0, 0, 0),
    useBoundingBox: false,
    rotationOffset: new Euler(0, placement.rotationY, 0, 'YXZ'),
    rotationInfluence: 0.35,
    rotationSmoothing: 0.35,
  };

  separateLDWaterWindows(model);
  waterSystem.masking.add(model);

  return waterSystem.buoyancy.addObject(model as Mesh, options);
};

const configureLDWaterSkyTexture = (texture: Texture) => {
  texture.mapping = EquirectangularReflectionMapping;
  texture.wrapS = RepeatWrapping;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
};

const downsampleEquirect = (texture: Texture, width: number) => {
  const image = texture.image as {data: Float32Array|Uint16Array, width: number, height: number};
  const src = image.data;
  const sw = image.width;
  const sh = image.height;
  const height = Math.max(2, Math.round(width / 2));
  const dst = new (src.constructor as any)(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / width));
      const si = (sy * sw + sx) * 4;
      const di = (y * width + x) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  texture.image = {data: dst, width, height};
  texture.needsUpdate = true;
};

export const loadLDWaterSkyTexture = async (
  url: string,
  maxWidth: number|null = null
): Promise<Texture> => {
  const lowerUrl = url.toLowerCase();
  const texture = lowerUrl.endsWith('.hdr') ?
    await new RGBELoader().loadAsync(url) :
    await new UltraHDRLoader().loadAsync(url);
  const configured = configureLDWaterSkyTexture(texture);
  const imageWidth = (configured.image as {width?: number}|null)?.width ?? 0;
  if (maxWidth != null && maxWidth > 0 && imageWidth > maxWidth) {
    downsampleEquirect(configured, maxWidth);
  }
  return configured;
};

export const attachLDWaterSky = (
  waterSystem: Pick<WaterSystem, 'lighting'|'setSky'>,
  renderer: unknown,
  waterModule: Pick<WaterModule, 'Sky'>,
  texture: Texture,
  reflectionRoughness = 0.15
) => {
  const Sky = (waterModule as any).Sky;
  const sky = new Sky(renderer, {
    equirect: texture,
    brightness: LD_WATER_HERO_SKY_BRIGHTNESS,
    reflectionRoughness,
    sunDirection: waterSystem.lighting.sun.direction,
    sunOverlay: {
      enabled: true,
      color: '#fdc4c9',
      emissiveColor: '#fff8e0',
      emissiveIntensity: 5,
      radius: 0.02,
    },
  });
  // setSky adds the backdrop and owns scene.environment.
  waterSystem.setSky(sky);
  return sky;
};

/**
 * v3.5.1 removed WaterSystem.setElevation. The surface stays at y = 0.
 * Draft is `water-waterline`, not this legacy attribute.
 */
export const applyLDWaterElevation = (
  _waterSystem: unknown,
  _elevation: number
) => {};

export const applyLDWaterClipPlaneDistance = (
  waterSystem: Pick<WaterSystem, 'clipPlaneDistance'>,
  presetName: WaterPresetName
) => {
  waterSystem.clipPlaneDistance =
    presetName === 'ld-boat-real-scale' ?
    LD_WATER_REFERENCE_CLIP_PLANE_DISTANCE_METERS /
        LD_WATER_REFERENCE_SCALE :
    LD_WATER_REFERENCE_CLIP_PLANE_DISTANCE_METERS;
};

export const applyLDWaterCameraRange = (
  camera: PerspectiveCamera,
  minFar = LD_WATER_MIN_CAMERA_FAR_METERS
) => {
  if (camera.far >= minFar) {
    return;
  }

  camera.far = minFar;
  camera.updateProjectionMatrix();
};

export const ensureLDWaterModelNormals = (model: Object3D) => {
  model.traverse((object) => {
    const mesh = object as Mesh;
    const geometry = mesh.geometry;
    if (geometry == null || geometry.getAttribute('normal') != null) {
      return;
    }

    if (geometry.getAttribute('position') != null) {
      geometry.computeVertexNormals();
    }
  });
};

export const LDWaterMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDWaterInterface> & T => {
  class LDWaterModelViewerElement extends ModelViewerElement {
    @property({type: Boolean, attribute: 'water'})
    water = false;

    @property({type: String, attribute: 'water-preset'})
    waterPreset: WaterPresetName = 'ld-boat';

    @property({type: String, attribute: 'water-quality'})
    waterQuality: WaterQualityLevel = 'high';

    @property({type: Number, attribute: 'water-elevation'})
    waterElevation = 0;

    /**
     * glTF height, in metres, that should meet the lake. The model root
     * is placed at y = 0 when this is 0, and at `-water-waterline`
     * otherwise.
     */
    @property({type: Number, attribute: 'water-waterline'})
    waterWaterline = 0;

    /** Downsample the sky equirect to this width. Null keeps the file. */
    @property({type: Number, attribute: 'water-sky-size'})
    waterSkySize: number|null = null;

    @property({type: Number, attribute: 'water-seed'})
    waterSeed: number|null = null;

    @property({type: String, attribute: 'water-sky-image'})
    waterSkyImage: string|null = null;

    @property({type: Boolean, attribute: 'water-buoyancy'})
    waterBuoyancy = false;

    private waterSystem: WaterSystem|null = null;
    private waterLoadId = 0;
    private waterBuoyancyId: number|null = null;
    private waterMaskObject: Object3D|null = null;
    private waterSky: {
      dispose(): void,
      getMeshes(): Object3D[],
      getEnvironmentTexture?(): Texture|null,
    }|null = null;
    private waterPlacement: LDWaterHullPlacement|null = null;

    connectedCallback() {
      super.connectedCallback();
      this.addEventListener('load', this.handleWaterModelLoad);
      this.updateComplete.then(() => {
        if (this.isConnected && this.water && this.waterSystem == null) {
          this.updateWater();
        }
      });
    }

    updated(changedProperties: Map<string|number|symbol, unknown>) {
      super.updated(changedProperties);

      if (changedProperties.has('water')) {
        if (this.water) {
          this.updateWater();
        } else {
          this.clearWater();
        }
        return;
      }

      if (
        this.water &&
        (changedProperties.has('waterPreset') ||
         changedProperties.has('waterQuality') ||
         changedProperties.has('waterElevation') ||
         changedProperties.has('waterWaterline') ||
         changedProperties.has('waterSeed') ||
         changedProperties.has('waterSkyImage') ||
         changedProperties.has('waterSkySize') ||
         changedProperties.has('waterBuoyancy'))
      ) {
        this.updateWater();
      }
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.removeEventListener('load', this.handleWaterModelLoad);
      this.clearWater();
    }

    [$tick](time: number, delta: number) {
      super[$tick](time, delta);

      if (this.waterSystem == null || delta <= 0) {
        return;
      }

      applyLDWaterCameraRange(this.getWaterCamera());
      const skyTexture = this.waterSky?.getEnvironmentTexture?.() ?? null;
      if (skyTexture != null && this[$scene].environment !== skyTexture) {
        this.waterSystem.setSky(this.waterSky as any);
      }
      this.waterSystem.update(delta / 1000).catch((error) => {
        this.dispatchWaterError(error);
      });
      this[$needsRender]();
    }

    private clearWater(cancelPendingLoad = true) {
      if (cancelPendingLoad) {
        this.waterLoadId++;
      }

      if (this.waterSystem != null) {
        this.clearWaterSky();
        this.unregisterWaterBuoyancy();
        this.waterSystem.dispose();
        this.waterSystem = null;
      }

      this[$scene].clearWater();
      this[$needsRender]();
    }

    private dispatchWaterError(error: unknown) {
      this.dispatchEvent(
        new CustomEvent('water-error', {detail: {error}})
      );
    }

    private validateWaterSettings() {
      if (!isWaterPresetName(this.waterPreset)) {
        throw new Error(`Unknown water preset: ${this.waterPreset}`);
      }

      if (!isWaterQualityLevel(this.waterQuality)) {
        throw new Error(`Unknown water quality: ${this.waterQuality}`);
      }
    }

    private getWaterRenderer() {
      const threeRenderer = this[$renderer].threeRenderer as any;
      if (threeRenderer?.isWebGPURenderer !== true) {
        throw new Error(
          'LD Water requires a WebGPU renderer. The current model-viewer ' +
          'renderer is WebGL and cannot host threejs-water-pro.'
        );
      }
      return threeRenderer;
    }

    private getWaterCamera() {
      const camera = this[$scene].camera;
      if (!(camera instanceof PerspectiveCamera)) {
        throw new Error('LD Water requires a perspective camera.');
      }
      return camera;
    }

    private createWaterMarker() {
      const marker = new Object3D();
      marker.name = 'LDWaterRoot';
      marker.position.y = this.waterElevation;
      marker.userData.noHit = true;
      marker.userData.selectable = false;
      return marker;
    }

    private handleWaterModelLoad = () => {
      this.prepareWaterModel();
      this.registerWaterBuoyancy();
    };

    private prepareWaterModel() {
      const model = this[$scene].model;
      if (this.water && model != null) {
        ensureLDWaterModelNormals(model);
      }
    }

    private unregisterWaterBuoyancy() {
      if (this.waterSystem != null && this.waterMaskObject != null) {
        this.waterSystem.masking.remove(this.waterMaskObject);
        this.waterMaskObject = null;
      }

      if (this.waterSystem == null || this.waterBuoyancyId == null) {
        this.waterBuoyancyId = null;
        return;
      }

      this.waterSystem.buoyancy.removeObject(this.waterBuoyancyId);
      this.waterBuoyancyId = null;
      this.waterPlacement = null;
    }

    private clearWaterSky() {
      if (this.waterSky == null) {
        return;
      }

      for (const mesh of this.waterSky.getMeshes()) {
        mesh.removeFromParent();
      }
      this.waterSky.dispose();
      this.waterSky = null;
    }

    private registerWaterBuoyancy() {
      const model = this[$scene].model;
      if (this.waterSystem == null || model == null) {
        return;
      }

      this.unregisterWaterBuoyancy();
      ensureLDWaterModelNormals(model);
      this.waterPlacement = placeLDWaterHull(model, this.waterWaterline);
      separateLDWaterWindows(model);
      if (!this.waterBuoyancy) {
        this.waterSystem.masking.add(model);
        this.waterMaskObject = model;
        return;
      }

      this.waterBuoyancyId =
        registerLDWaterBuoyancy(this.waterSystem, model, this.waterPlacement);
      this.waterMaskObject = model;
    }

    private async updateWater() {
      const loadId = ++this.waterLoadId;
      this.clearWater(false);

      if (!this.water) {
        return;
      }

      try {
        this.validateWaterSettings();
        this[$scene].setShadowMode('none');
        this.prepareWaterModel();
        await this[$renderer].requestBackend('webgpu');
        const renderer = this.getWaterRenderer();
        const camera = this.getWaterCamera();
        applyLDWaterCameraRange(camera);
        const waterModule =
          await import('threejs-water-pro') as WaterModule;

        if (loadId !== this.waterLoadId || !this.water) {
          return;
        }

        this.waterSystem = await waterModule.WaterSystem.create(
          renderer,
          this[$scene] as any,
          camera as any,
          this.waterQuality,
          {
            deterministic: this.waterSeed != null,
            seed: this.waterSeed ?? undefined,
          }
        );
        ensureLDWaterModelNormals(this[$scene]);
        const preset = createLDWaterPreset(this.waterPreset, waterModule);
        this.waterSystem.loadPreset(preset);
        applyLDWaterElevation(this.waterSystem, this.waterElevation);
        if (isLDWaterHeroPreset(this.waterPreset)) {
          (this as any).toneMapping = 'aces';
          (this as any).exposure = LD_WATER_HERO_EXPOSURE;
        }
        if (this.waterSkyImage != null) {
          const skyTexture = await loadLDWaterSkyTexture(
            this.waterSkyImage,
            this.waterSkySize
          );
          if (loadId !== this.waterLoadId || !this.water) {
            return;
          }
          this.waterSky = attachLDWaterSky(
            this.waterSystem,
            renderer,
            waterModule,
            skyTexture,
            (preset as any).sky?.reflectionRoughness ?? 0.15
          );
        }
        this.registerWaterBuoyancy();
        this[$scene].setWater(this.createWaterMarker());
        this.dispatchEvent(new CustomEvent('water-load'));
      } catch (error) {
        if (loadId === this.waterLoadId && this.water) {
          this.dispatchWaterError(error);
        }
      } finally {
        this[$needsRender]();
      }
    }
  }

  return LDWaterModelViewerElement;
};
