/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {property} from 'lit/decorators.js';
import {
  Box3,
  CubeUVReflectionMapping,
  DoubleSide,
  EquirectangularReflectionMapping,
  Euler,
  LinearFilter,
  Mesh,
  Object3D,
  PerspectiveCamera,
  RepeatWrapping,
  Texture,
  Vector2,
  Vector3,
  Vector4,
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
const LD_WATER_REFERENCE_CLIP_PLANE_DISTANCE_METERS = 20;
const LD_WATER_REFERENCE_SCALE = 15;
const LD_WATER_MIN_CAMERA_FAR_METERS = 50000;
// Quality "high" marches SSR 150 m in 16 steps. From the live stern camera
// that coarse march hits the hull from water that is not reflecting it and
// draws a second upright copy. 30 m still reaches the hull and cabins.
const LD_WATER_BOAT_SSR_MAX_METERS = 30;

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
  /**
   * Adds the lake. Off by default. Does not change tone mapping, exposure,
   * the environment image, the skybox, or scene lights. `shadow-intensity`
   * is ignored while water is on: soft shadows are a WebGL pass, and this
   * mixin does not port them.
   */
  water: boolean;
  waterPreset: WaterPresetName;
  waterQuality: WaterQualityLevel;
  waterElevation: number;
  waterSeed: number|null;
  /**
   * Metres. The model root is placed at y = 0 when this is 0, and at
   * `-water-waterline` otherwise, so that height meets the lake.
   */
  waterWaterline: number;
  waterBuoyancy: boolean;
  /** WASD helm. Off until the host sets `water-drive`. */
  waterDrive: boolean;
  /** True after the lake has been created. */
  readonly waterActive: boolean;
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
 * 45° at noon. Azimuth 0 is +Z and 90 is +X.
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

/** `sky-sun-time` as `H:MM` or `HH:MM`. Empty and out-of-range values are off. */
export const parseSkySunTime = (
  value: string|null|undefined
): {hours: number, minutes: number}|null => {
  if (value == null) {
    return null;
  }
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (match == null) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return {hours, minutes};
};

/**
 * Direction toward the sun. Azimuth 0 is +Z and 90 is +X, matching
 * `sunFromSkyProClock`.
 */
export const directionFromSkySun = (
  elevationDeg: number,
  azimuthDeg: number,
  target = new Vector3()
): Vector3 => {
  const elevation = elevationDeg * Math.PI / 180;
  const azimuth = azimuthDeg * Math.PI / 180;
  const cosElevation = Math.cos(elevation);
  return target.set(
    Math.sin(azimuth) * cosElevation,
    Math.sin(elevation),
    Math.cos(azimuth) * cosElevation
  ).normalize();
};

export interface WaterSunLighting {
  sun: {
    direction: {value: Vector3},
    intensity: {value: number},
  };
  sunLight: {
    visible: boolean,
    intensity: number,
    castShadow: boolean,
  };
}

/**
 * The vendor sun light is invisible unless `sky-sun-time` is set, so the
 * lake does not add a light of its own. A page key light still feeds the
 * water highlight through the sun uniform.
 */
export const applyWaterSunPolicy = (
  lighting: WaterSunLighting,
  sunTime: string|null|undefined,
  authoredIntensity: number,
  keyLight: {intensity: number, direction: Vector3}|null
): 'sun'|'key'|'off' => {
  lighting.sunLight.castShadow = false;
  const parsed = parseSkySunTime(sunTime);
  if (parsed != null) {
    const angles = sunFromSkyProClock(parsed.hours, parsed.minutes);
    directionFromSkySun(
      angles.elevation, angles.azimuth, lighting.sun.direction.value);
    lighting.sun.intensity.value = authoredIntensity;
    lighting.sunLight.visible = true;
    return 'sun';
  }

  lighting.sunLight.visible = false;
  if (keyLight != null && keyLight.intensity > 0) {
    lighting.sun.direction.value.copy(keyLight.direction);
    lighting.sun.intensity.value = keyLight.intensity;
    return 'key';
  }

  lighting.sun.intensity.value = 0;
  lighting.sunLight.intensity = 0;
  return 'off';
};

const applyLDWaterHeroLook = (preset: WaterPreset): WaterPreset => {
  const waves = (preset as any).waves?.fft;
  if (waves != null) {
    waves.amplitude = LD_WATER_HERO_FFT_AMPLITUDE;
    waves.windSpeed = LD_WATER_HERO_WIND_SPEED;
    waves.peakWavelength = LD_WATER_HERO_PEAK_WAVELENGTH;
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

/**
 * Local Y for the model root. A waterline of 0 leaves the root at y = 0.
 * Any other value puts that glTF height on world y = 0, cancelling a
 * camera-target pivot that has already shifted the model's parent.
 */
export const ldWaterHeightOffset = (
  waterline: number,
  parentY = 0
): number => waterline === 0 ? 0 : -waterline - parentY;

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
 * Drop the model so `waterline` (a glTF height in metres) meets the lake
 * at world y = 0. Authored XZ and yaw stay put. A waterline of 0 leaves
 * the root at local y = 0.
 */
export const placeLDWaterHull = (
  model: Object3D,
  waterline: number
): LDWaterHullPlacement => {
  const parentY = model.parent?.position.y ?? 0;
  const heightOffset = ldWaterHeightOffset(waterline, parentY);
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

const LD_WATER_DRIVE_KEYS = ['w', 'a', 's', 'd'] as const;
type LDWaterDriveKey = typeof LD_WATER_DRIVE_KEYS[number];

const isLDWaterDriveKey = (key: string): key is LDWaterDriveKey =>
  (LD_WATER_DRIVE_KEYS as readonly string[]).includes(key);

/**
 * Vendor-style 3-DOF helm (surge, sway, yaw). WASD. The hull faces +Z at
 * yaw 0. Off until `attach`. Heading is reported through `syncYaw` so
 * buoyancy can keep `rotationOffset` instead of fighting the helm.
 */
export class LDWaterDrive {
  thrust = 2;
  drag = 0.5;
  maxSpeed = 6;
  reverseMaxSpeed = 2;
  maxRudderAngle = Math.PI / 6;
  rudderRate = 1.5;
  rudderReturn = 2;
  throttleRate = 0.8;
  rudderTurn = 0.6;
  yawDamping = 0.8;
  swayDamping = 1.2;

  speed = 0;
  swaySpeed = 0;
  yawRate = 0;
  throttle = 0;
  rudderAngle = 0;
  yaw = 0;

  private model: Object3D|null = null;
  private keys: Record<LDWaterDriveKey, boolean> = {
    w: false,
    a: false,
    s: false,
    d: false,
  };
  private listening = false;
  private listenTarget: EventTarget|null = null;
  private readonly rotationOffset = new Euler(0, 0, 0, 'YXZ');

  bind(model: Object3D) {
    this.model = model;
    this.yaw = new Euler().setFromQuaternion(model.quaternion, 'YXZ').y;
    this.speed = 0;
    this.swaySpeed = 0;
    this.yawRate = 0;
    this.throttle = 0;
    this.rudderAngle = 0;
  }

  /** Test and input helper. Unknown keys are ignored. */
  setKey(key: string, down: boolean) {
    const name = key.toLowerCase();
    if (isLDWaterDriveKey(name)) {
      this.keys[name] = down;
    }
  }

  attach(target: EventTarget = document) {
    if (this.listening) {
      return;
    }
    this.listening = true;
    this.listenTarget = target;
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
  }

  detach() {
    if (this.listening && this.listenTarget != null) {
      this.listenTarget.removeEventListener(
          'keydown', this.onKeyDown as EventListener);
      this.listenTarget.removeEventListener(
          'keyup', this.onKeyUp as EventListener);
    }
    this.listening = false;
    this.listenTarget = null;
    this.keys = {w: false, a: false, s: false, d: false};
  }

  update(dt: number, syncYaw?: (rotationOffset: Euler) => void) {
    const model = this.model;
    if (model == null) {
      return;
    }

    const step = Math.min(Math.max(dt, 0), 0.1);
    if (step === 0) {
      return;
    }

    this.updateThrottle(step);
    this.updateRudder(step);
    this.updateDynamics(step);
    this.rotationOffset.set(0, this.yaw, 0);
    if (syncYaw != null) {
      syncYaw(this.rotationOffset);
      return;
    }
    model.quaternion.setFromEuler(this.rotationOffset);
  }

  private updateThrottle(dt: number) {
    if (this.keys.w) {
      this.throttle = Math.min(this.throttle + this.throttleRate * dt, 1);
    } else if (this.keys.s) {
      this.throttle = Math.max(this.throttle - this.throttleRate * dt, -1);
    } else if (this.throttle > 0) {
      this.throttle = Math.max(this.throttle - this.throttleRate * dt, 0);
    } else if (this.throttle < 0) {
      this.throttle = Math.min(this.throttle + this.throttleRate * dt, 0);
    }
  }

  private updateRudder(dt: number) {
    if (this.keys.a) {
      this.rudderAngle = Math.min(
          this.rudderAngle + this.rudderRate * dt, this.maxRudderAngle);
    } else if (this.keys.d) {
      this.rudderAngle = Math.max(
          this.rudderAngle - this.rudderRate * dt, -this.maxRudderAngle);
    } else if (this.rudderAngle > 0) {
      this.rudderAngle = Math.max(this.rudderAngle - this.rudderReturn * dt, 0);
    } else if (this.rudderAngle < 0) {
      this.rudderAngle = Math.min(this.rudderAngle + this.rudderReturn * dt, 0);
    }
  }

  private updateDynamics(dt: number) {
    const model = this.model;
    if (model == null) {
      return;
    }

    const surgeAccel =
      this.throttle * this.thrust - this.drag * this.speed +
      this.swaySpeed * this.yawRate;
    this.speed += surgeAccel * dt;
    this.speed = this.speed > 0 ?
      Math.min(this.speed, this.maxSpeed) :
      Math.max(this.speed, -this.reverseMaxSpeed);

    const flow = this.speed / this.maxSpeed;
    const rudderMoment =
      this.rudderTurn * flow * Math.abs(flow) * Math.sin(this.rudderAngle);
    this.yawRate += (rudderMoment - this.yawDamping * this.yawRate) * dt;

    const swayAccel =
      -this.speed * this.yawRate - this.swayDamping * this.swaySpeed;
    this.swaySpeed += swayAccel * dt;

    this.yaw += this.yawRate * dt;
    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    const lateralX = Math.cos(this.yaw);
    const lateralZ = -Math.sin(this.yaw);
    model.position.x +=
      (this.speed * forwardX + this.swaySpeed * lateralX) * dt;
    model.position.z +=
      (this.speed * forwardZ + this.swaySpeed * lateralZ) * dt;
  }

  private onKeyDown = (event: KeyboardEvent) => {
    if (isEditableKeyTarget(event.target)) {
      return;
    }
    this.setKey(event.key, true);
  };

  private onKeyUp = (event: KeyboardEvent) => {
    if (isEditableKeyTarget(event.target)) {
      return;
    }
    this.setKey(event.key, false);
  };
}

const isEditableKeyTarget = (target: EventTarget|null) => {
  if (target == null || !(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
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
  reflectionRoughness = 0.15,
  brightness = 1
) => {
  const Sky = (waterModule as any).Sky;
  // Construction does not call setSky. setSky also replaces
  // scene.environment, which is the separate `sky-environment` opt-in.
  return new Sky(renderer, {
    equirect: texture,
    brightness,
    reflectionRoughness,
    sunDirection: waterSystem.lighting.sun.direction,
    sunOverlay: {
      enabled: false,
      color: '#fdc4c9',
      emissiveColor: '#fff8e0',
      emissiveIntensity: 5,
      radius: 0.02,
    },
  });
};

/**
 * Reflections of the page environment, with no dome meshes, so the page
 * skybox stays. The caller restores `scene.environment` after `setSky`.
 *
 * The dark column above the horizon is the equirect seam, not a sun shaft
 * and not a sky dome. The reflection prefilter samples the page HDR through
 * `atan2`. That texture is clamp-to-edge, so the wrap filters a near-black
 * column into the sky. A clone used only for the reflection is repeat-wrapped
 * and has no mip chain; `pmremTexture` then prefilters that clone on the
 * renderer's own WebGPU path. Generating the PMREM here with `fromEquirectangular`
 * nests a render and drops the device, and the `PMREMGenerator` exported from
 * `three` is the WebGL class, which bakes a near-black environment. Lighting
 * stays on the original page texture.
 */
export const createPageEnvironmentSky = async (
  texture: Texture,
  renderer: {initTexture?: (texture: Texture) => void},
) => {
  const webgpu = await import('three/webgpu') as any;
  const {
    Fn,
    clamp,
    equirectUV,
    normalize,
    pmremTexture,
    texture: textureNode,
    vec3,
  } = webgpu.TSL;
  let reflectionSource = texture;
  let disposePmrem = () => {};
  if (texture.mapping !== CubeUVReflectionMapping) {
    const source = texture.clone();
    source.wrapS = RepeatWrapping;
    source.generateMipmaps = false;
    source.minFilter = LinearFilter;
    source.magFilter = LinearFilter;
    source.needsUpdate = true;
    renderer.initTexture?.(source);
    reflectionSource = source;
    disposePmrem = () => {
      source.dispose();
    };
  }
  return {
    followCamera() {},
    dispose() {
      disposePmrem();
    },
    getMeshes(): Object3D[] {
      return [];
    },
    // Lighting stays on the page texture. The prefiltered map is only for
    // the water reflection sampler; handing it to setSky replaces the
    // environment and the hull goes black.
    getEnvironmentTexture(): Texture {
      return texture;
    },
    createFogSampler() {
      return Fn(([dir]: [any]) => {
        const sample = textureNode(texture).sample(equirectUV(normalize(dir)));
        return vec3(sample.x, sample.y, sample.z);
      });
    },
    createReflectionSampler() {
      return Fn(([dir, extraRoughness]: [any, any]) => {
        const roughness = clamp(extraRoughness, 0, 1);
        const sample = pmremTexture(reflectionSource, normalize(dir), roughness);
        return vec3(sample.x, sample.y, sample.z);
      });
    },
  };
};

/**
 * model-viewer draws dynamic resolution into a slice of the drawing buffer,
 * then sets the canvas CSS size to `element / scale` so overflow clips that
 * slice to the element. WebGL does this in `rescaleCanvas`. The WebGPU canvas
 * is a new element and does not inherit that size, so the slice sits in the
 * top-left and the page colour shows in the rest. Same formula as
 * `rescaleCanvas`.
 */
export const presentLDWaterBeautyFrame = (
  canvas: {style: {width: string, height: string}}|null|undefined,
  elementWidth: number,
  elementHeight: number,
  scale: number,
) => {
  if (
    canvas == null ||
    !(elementWidth > 0) ||
    !(elementHeight > 0) ||
    !(scale > 0)
  ) {
    return;
  }
  const width = `${Math.ceil(elementWidth / scale)}px`;
  const height = `${Math.ceil(elementHeight / scale)}px`;
  if (canvas.style.width !== width) {
    canvas.style.width = width;
  }
  if (canvas.style.height !== height) {
    canvas.style.height = height;
  }
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

/**
 * The canvas viewport is not the beauty slice. `getViewport()` reads the
 * canvas target, and a PMREM `setSize` during the page-environment path
 * resets that target to the full drawing buffer. The ghost hull is that
 * full-buffer capture sampled with `fragCoord / bufferSize`. Prefer the
 * beauty rect model-viewer published on the renderer. A missing rect falls
 * back to the canvas viewport, which is the full buffer after the reset
 * and is the second boat.
 */
export const resolveLDWaterCaptureViewport = (
  savedBeauty: {x: number, y: number, z: number, w: number}|null|undefined,
  canvasViewport: {x: number, y: number, z: number, w: number},
): {x: number, y: number, z: number, w: number} => {
  if (
    savedBeauty != null &&
    savedBeauty.z > 0 &&
    savedBeauty.w > 0
  ) {
    return savedBeauty;
  }
  return canvasViewport;
};

/**
 * Beauty draws into model-viewer's dynamic-resolution viewport, which can
 * be a top-left slice of the drawing buffer. The water captures allocate
 * full-buffer targets, and the surface shader addresses them with
 * `fragCoord / bufferSize`. A full-buffer viewport puts the hull at a
 * different texel than the beauty fragment, so the lake shows a second,
 * larger boat shifted down-right. Copy the beauty viewport onto each
 * full-buffer target. Quarter-resolution passes keep their own viewport.
 */
export const alignLDWaterCaptureViewport = (
  target: {
    width: number,
    height: number,
    viewport: {
      x: number,
      y: number,
      z: number,
      w: number,
      set: (x: number, y: number, width: number, height: number) => void,
    },
  }|null,
  canvasViewport: {x: number, y: number, z: number, w: number},
  drawingBufferWidth: number,
  drawingBufferHeight: number,
): boolean => {
  if (target == null) {
    return false;
  }
  const viewW = canvasViewport.z;
  const viewH = canvasViewport.w;
  if (!(viewW > 0) || !(viewH > 0)) {
    return false;
  }
  if (
    target.width < drawingBufferWidth - 2 ||
    target.height < drawingBufferHeight - 2
  ) {
    return false;
  }
  if (
    target.viewport.x === canvasViewport.x &&
    target.viewport.y === canvasViewport.y &&
    target.viewport.z === viewW &&
    target.viewport.w === viewH
  ) {
    return false;
  }
  target.viewport.set(canvasViewport.x, canvasViewport.y, viewW, viewH);
  return true;
};

/**
 * `screenUV` is `fragCoord / bufferSize`. Once the capture viewport is the
 * beauty viewport, that sample is the beauty fragment. A full-buffer
 * capture stores the same fragment at a zoomed texel, which is the second
 * boat. Returns true only when the sample stays on the fragment and the
 * unaligned full-buffer texel would be a different pixel — the scales
 * below 1.
 */
export const ldWaterCaptureMatchesBeautyFragment = (
  fragX: number,
  fragY: number,
  bufferWidth: number,
  bufferHeight: number,
  viewport: {x: number, y: number, z: number, w: number},
): boolean => {
  const viewW = viewport.z;
  const viewH = viewport.w;
  if (
    !(viewW > 0) || !(viewH > 0) ||
    !(bufferWidth > 0) || !(bufferHeight > 0)
  ) {
    return false;
  }

  const sampleX = (fragX / bufferWidth) * bufferWidth;
  const sampleY = (fragY / bufferHeight) * bufferHeight;
  const inside =
    sampleX >= viewport.x && sampleX < viewport.x + viewW &&
    sampleY >= viewport.y && sampleY < viewport.y + viewH;
  const aligned =
    Math.abs(sampleX - fragX) < 1e-4 && Math.abs(sampleY - fragY) < 1e-4;
  const fullX = viewport.x + ((fragX - viewport.x) / viewW) * bufferWidth;
  const fullY = viewport.y + ((fragY - viewport.y) / viewH) * bufferHeight;
  const fullFrameDiffers =
    Math.abs(fullX - sampleX) > 0.5 || Math.abs(fullY - sampleY) > 0.5;
  return inside && aligned && fullFrameDiffers;
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
    /**
     * Adds the lake. Off by default.
     *
     * Does not change tone mapping, exposure, the environment image, the
     * skybox, or scene lights. Reflections follow the page environment. A
     * visible directional light on the page, when there is one, drives the
     * water highlight. Vendor sky and sun are the `sky` mixin, not water
     * attributes.
     *
     * `shadow-intensity` is ignored while water is on. Soft shadows are a
     * WebGL pass, and this mixin does not port them or raise an error.
     */
    @property({type: Boolean, attribute: 'water'})
    water = false;

    @property({type: String, attribute: 'water-preset'})
    waterPreset: WaterPresetName = 'ld-boat';

    @property({type: String, attribute: 'water-quality'})
    waterQuality: WaterQualityLevel = 'high';

    @property({type: Number, attribute: 'water-elevation'})
    waterElevation = 0;

    /**
     * glTF height, in metres, that should meet the lake at world y = 0.
     * The model root stays at local y = 0 when this is 0. Any other value
     * shifts the root by `-water-waterline`, and also cancels a
     * camera-target pivot already applied to the model's parent.
     */
    @property({type: Number, attribute: 'water-waterline'})
    waterWaterline = 0;

    @property({type: Number, attribute: 'water-seed'})
    waterSeed: number|null = null;

    @property({type: Boolean, attribute: 'water-buoyancy'})
    waterBuoyancy = false;

    /** Optional WASD helm. Off unless the attribute is set. */
    @property({type: Boolean, attribute: 'water-drive'})
    waterDrive = false;

    private waterSystem: WaterSystem|null = null;
    private waterLoadId = 0;
    private waterBuoyancyId: number|null = null;
    private waterMaskObject: Object3D|null = null;
    private waterPlacement: LDWaterHullPlacement|null = null;
    private waterDriveController: LDWaterDrive|null = null;
    private waterViewportRestore: (() => void)|null = null;
    private waterAuthoredSunIntensity = 0;
    private pageEnvironment: Texture|null = null;
    private pageSkyTexture: Texture|null = null;
    private pageSkyProvider: {
      getEnvironmentTexture(): Texture,
      dispose?: () => void,
    }|null = null;
    private pageSkyRequest = 0;
    private pageSkyFailed: Texture|null = null;
    private pageBackground: unknown = null;
    private pageBackgroundNode: unknown = null;
    private pageBackdropReady = false;

    get waterActive(): boolean {
      return this.waterSystem != null;
    }

    connectedCallback() {
      super.connectedCallback();
      this.addEventListener('load', this.handleWaterModelLoad);
      this.syncWaterDrive();
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
      } else if (
        this.water &&
        (changedProperties.has('waterPreset') ||
         changedProperties.has('waterQuality') ||
         changedProperties.has('waterElevation') ||
         changedProperties.has('waterWaterline') ||
         changedProperties.has('waterSeed') ||
         changedProperties.has('waterBuoyancy'))
      ) {
        this.updateWater();
      }

      if (changedProperties.has('waterDrive')) {
        this.syncWaterDrive();
      }
    }

    disconnectedCallback() {
      super.disconnectedCallback();
      this.removeEventListener('load', this.handleWaterModelLoad);
      this.waterDriveController?.detach();
      this.waterDriveController = null;
      this.clearWater();
    }

    [$tick](time: number, delta: number) {
      super[$tick](time, delta);

      if (this.waterSystem == null) {
        return;
      }

      // setCameraView snaps the target outside the damper. A zero-delta frame
      // still has to drop the hull with that new parent, or the lake and the
      // reflection keep the previous pivot.
      applyLDWaterCameraRange(this.getWaterCamera());
      this.holdWaterLighting();
      this.bindWaterReflections();
      this.holdPageBackdrop();
      const waterlineMoved = this.holdWaterline();
      if (delta <= 0) {
        if (waterlineMoved) {
          this[$needsRender]();
        }
        return;
      }
      this.updateWaterDrive(delta / 1000);
      this.waterSystem.update(delta / 1000).catch((error) => {
        this.dispatchWaterError(error);
      });
      this[$needsRender]();
    }

    private clearWater(cancelPendingLoad = true) {
      if (cancelPendingLoad) {
        this.waterLoadId++;
      }

      this.releaseWaterViewportSync();

      if (this.waterSystem != null) {
        this.unregisterWaterBuoyancy();
        this.waterSystem.dispose();
        this.waterSystem = null;
      }
      this.pageSkyProvider?.dispose?.();
      this.pageSkyProvider = null;
      this.pageSkyTexture = null;
      this.pageSkyFailed = null;
      this.pageSkyRequest++;
      this.pageBackground = null;
      this.pageBackgroundNode = null;
      this.pageBackdropReady = false;

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

    private releaseWaterViewportSync() {
      this.waterViewportRestore?.();
      this.waterViewportRestore = null;
    }

    /**
     * Scene capture renders through the same WebGPURenderer.render the beauty
     * pass uses. Full-buffer targets would otherwise ignore the viewport
     * model-viewer set for dynamic resolution.
     */
    private installWaterViewportSync(renderer: {
      render: (scene: unknown, camera: unknown) => unknown,
      getRenderTarget?: () => {
        width: number,
        height: number,
        viewport: {
          x: number,
          y: number,
          z: number,
          w: number,
          set: (x: number, y: number, width: number, height: number) => void,
        },
      }|null,
      getViewport?: (target: Vector4) => Vector4,
      getDrawingBufferSize?: (target: Vector2) => Vector2,
    }) {
      this.releaseWaterViewportSync();
      const original = renderer.render.bind(renderer);
      const viewport = new Vector4();
      const buffer = new Vector2();
      renderer.render = (scene: unknown, camera: unknown) => {
        const target = renderer.getRenderTarget?.() ?? null;
        // Captures null the background themselves. The beauty pass is the
        // screen draw (no target); put the page skybox back first.
        if (target == null) {
          this.holdPageBackdrop();
          // WebGL stretches the beauty slice by enlarging the canvas. The
          // WebGPU canvas is replaced on the backend switch and misses that
          // size whenever the scale step does not change. Reapply it on the
          // screen draw, which is the pass the page shows.
          const scene = this[$scene];
          presentLDWaterBeautyFrame(
            (renderer as {domElement?: HTMLCanvasElement}).domElement,
            scene.width,
            scene.height,
            this[$renderer].scaleFactor,
          );
        }
        if (
          target != null &&
          renderer.getDrawingBufferSize != null
        ) {
          const canvasViewport = renderer.getViewport != null ?
            renderer.getViewport(viewport) :
            viewport.set(0, 0, 0, 0);
          renderer.getDrawingBufferSize(buffer);
          alignLDWaterCaptureViewport(
            target,
            resolveLDWaterCaptureViewport(
              (renderer as {ldBeautyViewport?: Vector4|null}).ldBeautyViewport,
              canvasViewport
            ),
            buffer.x,
            buffer.y
          );
        }
        return original(scene, camera);
      };
      this.waterViewportRestore = () => {
        renderer.render = original;
      };
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

    private skyHost(): {
      sky?: boolean,
      skyEnvironment?: boolean,
      skySunTime?: string|null,
      activeSky?: {
        getEnvironmentTexture?: () => Texture|null,
        sunEnabledUniform?: {value: number},
      }|null,
    } {
      return this as unknown as {
        sky?: boolean,
        skyEnvironment?: boolean,
        skySunTime?: string|null,
        activeSky?: {
          getEnvironmentTexture?: () => Texture|null,
          sunEnabledUniform?: {value: number},
        }|null,
      };
    }

    private pageKeyLight(ownLight: object|null): {intensity: number, direction: Vector3}|null {
      let found: {intensity: number, direction: Vector3}|null = null;
      this[$scene].traverse((object) => {
        const light = object as {
          isDirectionalLight?: boolean,
          visible?: boolean,
          name?: string,
          intensity?: number,
          position: Vector3,
          target?: {getWorldPosition: (out: Vector3) => Vector3},
          getWorldPosition: (out: Vector3) => Vector3,
        };
        if (light.isDirectionalLight !== true || light === ownLight || light.visible === false) {
          return;
        }
        if (light.name === 'LDSkySun') {
          return;
        }
        const intensity = light.intensity ?? 0;
        if (found != null && intensity <= found.intensity) {
          return;
        }
        const origin = light.getWorldPosition(new Vector3());
        const target = light.target?.getWorldPosition(new Vector3()) ?? new Vector3();
        const direction = origin.sub(target);
        if (direction.lengthSq() < 1e-8) {
          return;
        }
        found = {intensity, direction: direction.normalize()};
      });
      return found;
    }

    /** Vendor sun stays off unless `sky-sun-time` is set. */
    private holdWaterLighting() {
      const water = this.waterSystem;
      if (water == null) {
        return;
      }
      const host = this.skyHost();
      const mode = applyWaterSunPolicy(
        water.lighting,
        host.skySunTime,
        this.waterAuthoredSunIntensity,
        this.pageKeyLight(water.lighting.sunLight)
      );
      const disk = host.activeSky?.sunEnabledUniform;
      if (disk != null) {
        disk.value = mode === 'sun' && host.sky === true ? 1 : 0;
      }
    }

    /**
     * The page skybox stays when `sky` is off. Remember it before the water
     * system builds, then put it back every tick. A vendor sky dome is the
     * sky mixin's backdrop and is left alone.
     */
    private rememberPageBackdrop() {
      if (this.pageBackdropReady) {
        return;
      }
      const scene = this[$scene] as {background: unknown, backgroundNode?: unknown};
      this.pageBackground = scene.background ?? null;
      this.pageBackgroundNode = scene.backgroundNode ?? null;
      this.pageBackdropReady = true;
      const renderer = this[$renderer].threeRenderer as {setClearAlpha?: (alpha: number) => void};
      if (this.pageBackground == null && renderer.setClearAlpha != null) {
        renderer.setClearAlpha(0);
      }
    }

    private holdPageBackdrop() {
      if (this.skyHost().sky === true || !this.pageBackdropReady) {
        return;
      }
      const scene = this[$scene] as {
        background: unknown,
        backgroundNode?: unknown,
        environmentNode?: unknown,
      };
      scene.background = this.pageBackground;
      scene.backgroundNode = this.pageBackgroundNode;
      // setSky installs a PMREM node after the page environment is restored.
      // WebGPU lights from that node instead of the page environment. Leave
      // the node in place only for the sky-environment opt-in.
      if (this.skyHost().skyEnvironment !== true) {
        scene.environmentNode = null;
      }
    }

    private restorePageEnvironment() {
      const scene = this[$scene] as {environment: Texture|null, environmentNode?: unknown};
      if (this.pageEnvironment == null) {
        return;
      }
      scene.environment = this.pageEnvironment;
      scene.environmentNode = null;
    }

    private rememberPageEnvironment(vendorTexture: Texture|null) {
      const environment = this[$scene].environment;
      if (environment == null || environment === vendorTexture) {
        return;
      }
      if (environment === this.pageSkyTexture) {
        return;
      }
      this.pageEnvironment = environment;
    }

    /**
     * Vendor `sky` feeds water reflections. Without it, reflections sample
     * the page environment. `sky-environment` is the only path that replaces
     * that environment map.
     */
    private bindWaterReflections() {
      const water = this.waterSystem;
      if (water == null) {
        return;
      }
      const host = this.skyHost();
      const vendor = host.sky === true ? host.activeSky ?? null : null;
      const vendorTexture = vendor?.getEnvironmentTexture?.() ?? null;
      this.rememberPageEnvironment(vendorTexture);
      const current = water.rendering.getCurrentSky();

      if (vendor != null) {
        if (current !== vendor) {
          water.setSky(vendor as any);
        }
        if (host.skyEnvironment !== true) {
          this.restorePageEnvironment();
        }
        return;
      }

      const pageTexture = this.pageEnvironment ?? this[$scene].environment;
      if (pageTexture == null) {
        return;
      }
      if (this.pageSkyFailed === pageTexture) {
        return;
      }
      if (this.pageSkyTexture !== pageTexture || this.pageSkyProvider == null) {
        this.ensurePageSky(pageTexture);
        return;
      }
      if (current !== this.pageSkyProvider) {
        water.setSky(this.pageSkyProvider as any);
      }
      this.restorePageEnvironment();
    }

    private ensurePageSky(texture: Texture) {
      const request = ++this.pageSkyRequest;
      this.pageSkyTexture = texture;
      createPageEnvironmentSky(texture, this.getWaterRenderer()).then((provider) => {
        if (request !== this.pageSkyRequest || this.waterSystem == null) {
          provider.dispose();
          return;
        }
        if (this.pageSkyTexture !== texture) {
          provider.dispose();
          return;
        }
        this.pageSkyProvider?.dispose?.();
        this.pageSkyProvider = provider;
        this.pageEnvironment = this.pageEnvironment ?? texture;
        this.waterSystem.setSky(provider as any);
        this.restorePageEnvironment();
      }).catch((error) => {
        if (request === this.pageSkyRequest) {
          this.pageSkyFailed = texture;
        }
        this.dispatchWaterError(error);
      });
    }

    private syncWaterDrive() {
      if (this.waterDrive) {
        if (this.waterDriveController == null) {
          this.waterDriveController = new LDWaterDrive();
        }
        this.waterDriveController.attach();
        const model = this[$scene].model;
        if (model != null) {
          this.waterDriveController.bind(model);
        }
      } else {
        this.waterDriveController?.detach();
      }
    }

    private bindWaterDrive(model: Object3D) {
      if (!this.waterDrive) {
        return;
      }
      if (this.waterDriveController == null) {
        this.waterDriveController = new LDWaterDrive();
        this.waterDriveController.attach();
      }
      this.waterDriveController.bind(model);
    }

    private updateWaterDrive(dtSeconds: number) {
      if (!this.waterDrive || this.waterDriveController == null) {
        return;
      }
      const buoyancyId = this.waterBuoyancyId;
      const waterSystem = this.waterSystem;
      const sync = buoyancyId != null && waterSystem != null ?
        (offset: Euler) => {
          waterSystem.buoyancy.updateObjectConfig(
              buoyancyId, {rotationOffset: offset});
        } :
        undefined;
      this.waterDriveController.update(dtSeconds, sync);
    }

    /**
     * camera-target moves the model's parent. Keep the chosen glTF height
     * on the lake when that pivot changes. Glass was reparented beside the
     * hull, so it has to take the same step.
     */
    private holdWaterline(): boolean {
      if (this.waterBuoyancy) {
        return false;
      }
      const model = this[$scene].model;
      if (model == null) {
        return false;
      }
      const parentY = model.parent?.position.y ?? 0;
      const next = ldWaterHeightOffset(this.waterWaterline, parentY);
      const delta = next - model.position.y;
      if (delta === 0) {
        return false;
      }
      model.position.y = next;
      const parent = model.parent;
      if (parent == null) {
        return true;
      }
      for (const child of parent.children) {
        if (child.userData?.ldWaterGlass === true) {
          child.position.y += delta;
        }
      }
      return true;
    }

    /** SSAO's composer is WebGL. Drop it before the WebGPU renderer replaces the canvas. */
    private releaseWebGLPostStack() {
      if (this[$scene].effectRenderer == null) {
        return;
      }
      const host = this as unknown as {unregisterEffectComposer?: () => void};
      if (typeof host.unregisterEffectComposer === 'function') {
        host.unregisterEffectComposer();
      }
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
      this.bindWaterDrive(model);
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
        this.releaseWebGLPostStack();
        await this[$renderer].requestBackend('webgpu');
        this.releaseWebGLPostStack();
        const renderer = this.getWaterRenderer();
        this.installWaterViewportSync(renderer);
        this.rememberPageBackdrop();
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
        this.waterSystem.fog.enabled = false;
        const presetSun = (preset as {sky?: {sun?: {intensity?: number}}}).sky?.sun;
        this.waterAuthoredSunIntensity =
          typeof presetSun?.intensity === 'number' ? presetSun.intensity : 0;
        this.holdWaterLighting();
        if (isLDWaterHeroPreset(this.waterPreset)) {
          this.waterSystem.ssr.maxDistance = LD_WATER_BOAT_SSR_MAX_METERS;
        }
        this.bindWaterReflections();
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
