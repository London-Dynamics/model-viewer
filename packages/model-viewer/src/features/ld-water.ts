/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {property} from 'lit/decorators.js';
import {
  EquirectangularReflectionMapping,
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

const WATER_QUALITIES = new Set<string>(['low', 'medium', 'high', 'ultra']);
const LD_BOAT_SAMPLE_LENGTH_METERS = 7.627;
const LD_BOAT_SAMPLE_WIDTH_METERS = 2.971;
const LD_WATER_REFERENCE_SCALE = 15;
const LD_BOAT_REFERENCE_HEIGHT_OFFSET_METERS = -5.9;
const LD_WATER_REFERENCE_CLIP_PLANE_DISTANCE_METERS = 20;
const LD_WATER_MIN_CAMERA_FAR_METERS = 50000;

const clonePreset = (preset: WaterPreset): WaterPreset =>
  JSON.parse(JSON.stringify(preset)) as WaterPreset;

export declare interface LDWaterInterface {
  water: boolean;
  waterPreset: WaterPresetName;
  waterQuality: WaterQualityLevel;
  waterElevation: number;
  waterSeed: number|null;
  waterSkyImage: string|null;
  waterBuoyancy: boolean;
}

type WaterModule = typeof import('threejs-water-pro');

const isWaterPresetName = (value: string): value is WaterPresetName =>
  WATER_PRESETS.has(value);

const isWaterQualityLevel = (value: string): value is WaterQualityLevel =>
  WATER_QUALITIES.has(value);

const scaleWaterPath = (
  preset: WaterPreset,
  path: string[],
  scale: number
) => {
  let current = preset as any;
  for (const key of path.slice(0, -1)) {
    current = current?.[key];
  }

  const key = path[path.length - 1];
  if (current != null && typeof current[key] === 'number') {
    current[key] *= scale;
  }
};

const scaleLDWaterPresetForRealScale = (preset: WaterPreset): WaterPreset => {
  const scale = 1 / LD_WATER_REFERENCE_SCALE;
  const waveHeightScale = 2 / LD_WATER_REFERENCE_SCALE;
  const scaledWorldPaths = [
    ['clipmap', 'baseSize'],
    ['foam', 'surface', 'size'],
    ['foam', 'waves', 'size'],
    ['foam', 'shoreline', 'size'],
    ['foam', 'shoreline', 'range'],
    ['oceanFloor', 'depth'],
    ['oceanFloor', 'displacementScale'],
    ['oceanFloor', 'displacementStrength'],
    ['oceanFloor', 'tileSize'],
    ['oceanFloor', 'caustics', 'scale'],
    ['waves', 'fft', 'cascades', 'ripples', 'scale'],
    ['waves', 'fft', 'cascades', 'waves', 'scale'],
    ['waves', 'gerstner', 'wavelength'],
  ];
  const waveHeightPaths = [
    ['waves', 'fft', 'amplitude'],
    ['waves', 'gerstner', 'amplitude'],
  ];

  for (const path of scaledWorldPaths) {
    scaleWaterPath(preset, path, scale);
  }
  for (const path of waveHeightPaths) {
    scaleWaterPath(preset, path, waveHeightScale);
  }

  // At real model scale these camera-facing particles expose fixed world-space
  // waterline artifacts around the boat. Disable them until the particle system
  // itself supports a scale-aware configuration.
  preset.postProcessing.underwaterParticles.enabled = false;

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
    presetName === 'ld-boat' || presetName === 'ld-boat-real-scale' ?
    'sunset' :
    presetName;
  const preset = clonePreset(waterModule.getPresetParams(upstreamPresetName));

  if (presetName === 'ld-boat-real-scale') {
    return scaleLDWaterPresetForRealScale(preset);
  }

  return preset;
};

export const registerLDWaterBuoyancy = (
  waterSystem: Pick<WaterSystem, 'buoyancy'|'masking'>,
  model: Object3D,
  presetName: WaterPresetName = 'ld-boat'
): number => {
  const heightOffset = presetName === 'ld-boat-real-scale' ?
    LD_BOAT_REFERENCE_HEIGHT_OFFSET_METERS / LD_WATER_REFERENCE_SCALE :
    LD_BOAT_REFERENCE_HEIGHT_OFFSET_METERS;
  const options: BuoyancyOptions = {
    heightOffset,
    heightSmoothing: 0.2,
    multiPoint: true,
    sampleLength: LD_BOAT_SAMPLE_LENGTH_METERS,
    sampleWidth: LD_BOAT_SAMPLE_WIDTH_METERS,
    sampleOffset: new Vector3(0, 0, 0),
    useBoundingBox: false,
    rotationInfluence: 0.45,
    rotationSmoothing: 0.35,
  };

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

export const loadLDWaterSkyTexture = async (url: string): Promise<Texture> => {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.endsWith('.hdr')) {
    const texture = await new RGBELoader().loadAsync(url);
    return configureLDWaterSkyTexture(texture);
  }

  const texture = await new UltraHDRLoader().loadAsync(url);
  return configureLDWaterSkyTexture(texture);
};

export const attachLDWaterSky = (
  waterSystem: Pick<WaterSystem, 'lighting'|'setSky'>,
  scene: Object3D,
  waterModule: Pick<WaterModule, 'Sky'>,
  texture: Texture
) => {
  const Sky = (waterModule as any).Sky;
  const sky = new Sky({
    equirect: texture,
    brightness: 0.3,
    reflectionBlurDistance: 1500,
    reflectionDistanceBlur: 0.5,
    reflectionRoughness: 0.02,
    sunDirection: waterSystem.lighting.sun.direction,
  });
  waterSystem.setSky(sky);
  for (const mesh of sky.getMeshes()) {
    scene.add(mesh);
  }
  return sky;
};

export const applyLDWaterElevation = (
  waterSystem: Pick<WaterSystem, 'setElevation'>,
  elevation: number
) => {
  waterSystem.setElevation(elevation);
};

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
    waterQuality: WaterQualityLevel = 'medium';

    @property({type: Number, attribute: 'water-elevation'})
    waterElevation = 0;

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
    private waterSky: {dispose(): void, getMeshes(): Object3D[]}|null = null;

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
         changedProperties.has('waterSeed') ||
         changedProperties.has('waterSkyImage') ||
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
      if (!this.waterBuoyancy) {
        this.waterSystem.masking.add(model);
        this.waterMaskObject = model;
        return;
      }

      this.waterBuoyancyId =
        registerLDWaterBuoyancy(this.waterSystem, model, this.waterPreset);
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
        this.waterSystem.loadPreset(
          createLDWaterPreset(this.waterPreset, waterModule)
        );
        applyLDWaterClipPlaneDistance(this.waterSystem, this.waterPreset);
        applyLDWaterElevation(this.waterSystem, this.waterElevation);
        if (this.waterSkyImage != null) {
          const skyTexture = await loadLDWaterSkyTexture(this.waterSkyImage);
          if (loadId !== this.waterLoadId || !this.water) {
            return;
          }
          this.waterSky = attachLDWaterSky(
            this.waterSystem,
            this[$scene],
            waterModule,
            skyTexture
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
