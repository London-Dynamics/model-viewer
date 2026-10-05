// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/** Runtime-switchable spectral/Jerlov and artist-authored water color. */
import * as THREE from "three/webgpu";
import {
  float,
  positionView,
  cameraNear,
  cameraFar,
  step,
  mix,
  max,
  abs,
  exp,
  floor,
  fract,
  int,
  vec3,
  reflect,
  normalize,
  uniform,
  uniformArray,
} from "three/tsl";
import type { Node } from "./types";
import {
  JERLOV_WATER_TYPES,
  type JerlovWaterType,
  type WaterConstituents,
} from "./waterConstituents";
import {
  buildTransmittanceLUT,
  computeCrestTransmission,
  computeInScatterReflectance,
} from "./waterSpectrum";

const LUT_SIZE = 256;
const LUT_LENGTH_SCALE = 20;
const CREST_TRANSMISSION_PATH = 3;

// ============= Params & Result interfaces =============

export type WaterColorMode = "physical" | "custom";

/** Full-spectrum physical water color derived from constituent concentrations. */
export interface PhysicalWaterColorParams {
  mode: "physical";
  algae: number;
  silt: number;
  stain: number;
}

/** Artist-authored water color with per-channel Beer-Lambert absorption. */
export interface WaterColorParams {
  absorptionColor: string;
  transmissionColor: string;
  waterColor: string;
}

/** Custom mode; `mode` is optional so existing v3.3 configs remain valid. */
export interface CustomWaterColorParams extends WaterColorParams {
  mode?: "custom";
}

/** Water-color configuration accepted by presets and runtime APIs. */
export type WaterColorConfig =
  | PhysicalWaterColorParams
  | CustomWaterColorParams;

function requireFiniteNumber(
  value: unknown,
  property: string,
  minimum = 0,
  maximum = Number.POSITIVE_INFINITY,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    const range = Number.isFinite(maximum)
      ? `between ${minimum} and ${maximum}`
      : `at least ${minimum}`;
    throw new TypeError(
      `Water color "${property}" must be a finite number ${range}.`,
    );
  }
  return value;
}

function requireColor(value: unknown, property: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`Water color "${property}" must be a color string.`);
  }
  return value;
}

/**
 * Validate a color configuration and return a fresh object with an explicit
 * mode, suitable for persisted state.
 */
export function normalizeWaterColorConfig(
  params: WaterColorConfig,
): PhysicalWaterColorParams | (WaterColorParams & { mode: "custom" }) {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    throw new TypeError("Water color input must be an object.");
  }

  if (params.mode === "physical") {
    return {
      mode: "physical",
      algae: requireFiniteNumber(params.algae, "algae"),
      silt: requireFiniteNumber(params.silt, "silt"),
      stain: requireFiniteNumber(params.stain, "stain"),
    };
  }

  if (params.mode !== undefined && params.mode !== "custom") {
    throw new TypeError("Unknown water color mode.");
  }

  return {
    mode: "custom",
    absorptionColor: requireColor(
      params.absorptionColor,
      "absorptionColor",
    ),
    transmissionColor: requireColor(
      params.transmissionColor,
      "transmissionColor",
    ),
    waterColor: requireColor(params.waterColor, "waterColor"),
  };
}

/** Parameters for {@link WaterColor.build}. */
export interface WaterColorBuildParams {
  /** Normalized linear scene depth sample (0 = near plane, 1 = far / sky). */
  depthSample: Node;
  /** View direction Y component for fallback depth. */
  viewDirY: Node;
  /** Whether the depth texture is available (0 or 1). */
  useDepthTexture: Node;
}

/** Output nodes produced by {@link WaterColor.build}. */
export interface WaterColorResult {
  /**
   * Per-channel Beer-Lambert clear-fraction `exp(-absorptionColor * depth)`.
   * `1.0` per channel = perfectly clear (light passes unattenuated),
   * `0.0` = fully absorbed. Used by the fragment composite to weight the
   * refracted seabed sample against the water's intrinsic in-scatter color.
   */
  clearFactor: Node;
  /** 1.0 when scene geometry is in front of water surface, 0.0 otherwise. */
  isObjectInFront: Node;
  /** Active physical in-scatter or artist-authored water color. */
  waterColor: Node;
  /** Water column depth in world units. */
  waterColumnDepth: Node;
}

/** Runtime-switchable physical and custom water-color model. */
export class WaterColor {
  private _mode: WaterColorMode = "physical";
  private _algae = 0;
  private _silt = 0.19;
  private _stain = 0.01;

  private _customMode = uniform(0);
  private _inScatter = uniform(new THREE.Vector3());
  private _crestTransmission = uniform(new THREE.Vector3());
  private _absorptionColor = uniform(new THREE.Color(0x0a0503));
  private _waterColor = uniform(new THREE.Color(0x003366));
  private _transmissionColor = uniform(new THREE.Color(0x50a890));
  private _waterDepth = uniform(5.0);

  private _transmittanceValues = Array.from(
    { length: LUT_SIZE },
    () => new THREE.Vector3(1, 1, 1),
  );
  private _transmittanceLUT = uniformArray(
    this._transmittanceValues,
    "vec3",
  );

  constructor() {
    this._derivePhysicalOptics();
  }

  get mode(): WaterColorMode {
    return this._mode;
  }

  set mode(value: WaterColorMode) {
    this._mode = value;
    this._customMode.value = value === "custom" ? 1 : 0;
  }

  get algae(): number {
    return this._algae;
  }

  set algae(value: number) {
    this._algae = value;
    this._derivePhysicalOptics();
  }

  get silt(): number {
    return this._silt;
  }

  set silt(value: number) {
    this._silt = value;
    this._derivePhysicalOptics();
  }

  get stain(): number {
    return this._stain;
  }

  set stain(value: number) {
    this._stain = value;
    this._derivePhysicalOptics();
  }

  /**
   * Per-channel Beer-Lambert absorption coefficient used by custom mode.
   */
  get absorptionColor(): THREE.Color {
    return this._absorptionColor.value;
  }

  set absorptionColor(value: THREE.Color | string) {
    this._absorptionColor.value = new THREE.Color(value);
    this.mode = "custom";
  }

  /** Color of light transmitted through the water. */
  get transmissionColor(): THREE.Color {
    return this._transmissionColor.value;
  }

  set transmissionColor(value: THREE.Color | string) {
    this._transmissionColor.value = new THREE.Color(value);
    this.mode = "custom";
  }

  /** Intrinsic in-scattered water color used by custom mode. */
  get waterColor(): THREE.Color {
    return this._waterColor.value;
  }

  set waterColor(value: THREE.Color | string) {
    this._waterColor.value = new THREE.Color(value);
    this.mode = "custom";
  }

  /**
   * Water depth for fallback depth calculation (world units).
   * Set from ocean floor depth — not part of {@link WaterColorParams}.
   */
  get waterDepth(): number {
    return this._waterDepth.value;
  }

  set waterDepth(value: number) {
    this._waterDepth.value = value;
  }

  // ============= Public Methods =============

  /** Normalize and apply a supported preset or params object. */
  update(params: WaterColorConfig): void {
    const normalized = normalizeWaterColorConfig(params);

    if (normalized.mode === "custom") {
      this.mode = "custom";
      this._absorptionColor.value = new THREE.Color(
        normalized.absorptionColor,
      );
      this.waterColor = normalized.waterColor;
      this.transmissionColor = normalized.transmissionColor;
      return;
    }

    this.mode = "physical";
    this._algae = normalized.algae;
    this._silt = normalized.silt;
    this._stain = normalized.stain;
    this._derivePhysicalOptics();
  }

  /** Seed the physical model from a Jerlov water type. */
  setJerlovType(type: JerlovWaterType): void {
    const constituents = JERLOV_WATER_TYPES[type];
    this.mode = "physical";
    this._algae = constituents.algae;
    this._silt = constituents.silt;
    this._stain = constituents.stain;
    this._derivePhysicalOptics();
  }

  /** Release resources owned by this color model. */
  dispose(): void {
    // The uniform buffer belongs to the compiled material and has no
    // independently disposable GPU resource.
  }

  /** Transmittance through the active water-color model. */
  buildClearFactor(columnDepth: Node): Node {
    const physical = this.buildPhysicalClearFactor(columnDepth);
    const custom = exp(vec3(this._absorptionColor).negate().mul(columnDepth));
    return mix(physical, custom, this._customMode);
  }

  /** Physical in-scatter or artist-authored custom water color. */
  buildMediumColor(): Node {
    return mix(
      vec3(this._inScatter),
      vec3(this._waterColor),
      this._customMode,
    );
  }

  /**
   * Builds water-column depth, active transmittance, and medium color at the
   * unrefracted screen UV. The refracted composite resamples the same model at
   * its refracted depth.
   *
   * @param params - Depth sample, view direction, and depth texture flag.
   */
  build(params: WaterColorBuildParams): WaterColorResult {
    const { depthSample, viewDirY, useDepthTexture } = params;

    const { waterColumnDepth, isObjectInFront } =
      this.buildWaterColumnDepth(viewDirY, depthSample, useDepthTexture);

    return {
      clearFactor: this.buildClearFactor(waterColumnDepth),
      isObjectInFront,
      waterColor: this.buildMediumColor(),
      waterColumnDepth,
    };
  }

  // ============= Private Helpers =============

  /**
   * Interpolates the physical transmittance curve from its uniform buffer.
   *
   * @param pathLength - Water-column length in world units.
   */
  private buildPhysicalClearFactor(pathLength: Node): Node {
    const u = float(1).sub(
      exp(pathLength.div(LUT_LENGTH_SCALE).negate()),
    );

    // The lookup follows normalized linear-filter semantics, where sample
    // positions address texel centers at `(index + 0.5) / size`.
    const samplePosition = u
      .mul(LUT_SIZE)
      .sub(0.5)
      .clamp(0, LUT_SIZE - 1);
    const lowerIndex = int(floor(samplePosition));
    const upperIndex = int(
      floor(samplePosition.add(1).clamp(0, LUT_SIZE - 1)),
    );
    const interpolation = fract(samplePosition);

    return mix(
      vec3(this._transmittanceLUT.element(lowerIndex)),
      vec3(this._transmittanceLUT.element(upperIndex)),
      interpolation,
    );
  }

  /**
   * Calculates the water column depth from depth texture or fallback.
   *
   * @param viewDirY - Y component of the view direction.
   * @param depthSample - Normalized linear scene depth sample.
   * @param useDepthTexture - Whether the depth texture is available (0 or 1).
   */
  private buildWaterColumnDepth(
    viewDirY: Node,
    depthSample: Node,
    useDepthTexture: Node,
  ): { waterColumnDepth: Node; isObjectInFront: Node } {
    const fallbackDepth = this._waterDepth.div(max(abs(viewDirY), 0.1));

    const waterSurfaceViewDepth = positionView.z.negate();

    const sceneLinearDepth = depthSample
      .mul(cameraFar.sub(cameraNear))
      .add(cameraNear);

    const depthDiff = sceneLinearDepth.sub(waterSurfaceViewDepth);
    const isObjectInFront = step(depthDiff, float(-0.01));

    const waterColumnDepth = max(depthDiff, 0.0);

    // Use fallback for sky (depth near far plane)
    const isSky = step(cameraFar.mul(0.99), sceneLinearDepth);
    const depthTextureResult = mix(waterColumnDepth, fallbackDepth, isSky);

    const finalDepth = mix(fallbackDepth, depthTextureResult, useDepthTexture);
    const finalIsObjectInFront = isObjectInFront.mul(useDepthTexture);

    return {
      waterColumnDepth: finalDepth,
      isObjectInFront: finalIsObjectInFront,
    };
  }

  private _derivePhysicalOptics(): void {
    const constituents: WaterConstituents = {
      algae: this._algae,
      silt: this._silt,
      stain: this._stain,
    };
    this._inScatter.value.copy(computeInScatterReflectance(constituents));
    this._crestTransmission.value.copy(
      computeCrestTransmission(constituents, CREST_TRANSMISSION_PATH),
    );
    const lut = buildTransmittanceLUT(constituents, {
      size: LUT_SIZE,
      lengthScale: LUT_LENGTH_SCALE,
    });
    for (let index = 0; index < LUT_SIZE; index++) {
      this._transmittanceValues[index].set(
        lut[index * 4],
        lut[index * 4 + 1],
        lut[index * 4 + 2],
      );
    }
    this._transmittanceLUT.needsUpdate = true;
  }

  /** Active crest-transmission node consumed by SSS. @internal */
  get _transmissionColorNode(): Node {
    return mix(
      vec3(this._crestTransmission),
      vec3(this._transmissionColor),
      this._customMode,
    );
  }
}

// ============= Standalone Reflection Builder =============

// Minimum world-space Y for the environment sample direction. Back-face
// slopes can mirror the view ray below the world horizon, where a sky HDRI
// is dark; skimming the sample just above the horizon avoids those patches.
const ENV_SAMPLE_MIN_Y = 0.02;

/**
 * Input parameters for buildReflectionSampling.
 */
export interface ReflectionSamplingParams {
  /** View direction (from surface toward camera). */
  viewDir: Node;
  /**
   * Surface normal for the reflection direction. Pass the bent
   * `reflectionNormal` from {@link FresnelResult} so the reflection
   * vector cannot dip below the local surface at grazing angles.
   */
  reflectionNormal: Node;
  /** Sky reflection sampler (optional): `(dir, extraRoughness) => color`. */
  reflectionSampler?: (dir: Node, roughness: Node) => Node;
  /**
   * Sub-footprint slope variance driving the reflection blur (filtered-BRDF
   * roughness). Higher where the pixel folds away unresolved waves.
   */
  roughness: Node;
}

/**
 * Result from buildReflectionSampling.
 */
export interface ReflectionSamplingResult {
  /** Sampled reflection color. */
  reflectionColor: Node;
  /** World-space reflection direction. */
  reflectDir: Node;
}

/**
 * Samples reflection color from sky or environment map.
 * This is a standalone builder function (not part of WaterColor) because
 * it handles optional JS-level samplers and doesn't depend on color uniforms.
 *
 * @param params - View direction, normal, and optional samplers.
 * @returns Reflection color and direction.
 */
export function buildReflectionSampling(
  params: ReflectionSamplingParams,
): ReflectionSamplingResult {
  const { viewDir, reflectionNormal, reflectionSampler, roughness } = params;

  const reflectDir = reflect(viewDir.negate(), reflectionNormal);
  const envSampleDir = normalize(
    vec3(reflectDir.x, max(reflectDir.y, ENV_SAMPLE_MIN_Y), reflectDir.z),
  );
  const reflectionColor: Node = reflectionSampler
    ? reflectionSampler(envSampleDir, roughness)
    : vec3(0.6, 0.8, 1.0);

  return { reflectionColor, reflectDir };
}
