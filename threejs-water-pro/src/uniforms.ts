import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import type { TSLUniformNode } from "./types/tsl";
import type { WaveUniformParams, SunUniformParams } from "./types/params";
import type { OceanFloorOptions } from "./components/floor/types";

// ============= Surface Uniforms =============

// ============= Wave Uniforms =============

export class WaveUniforms {
  animationSpeed = 1.0;
  amplitude = uniform(1.0);
  windSpeed = uniform(50.0);
  windDirection = uniform(0.0);
  choppiness = uniform(1.0);
  gravity = uniform(9.81);
  jonswapGamma = uniform(3.3);
  /**
   * Multiplier on the frequency-dependent directional spread exponent
   * s(ω/ωp) from Hasselmann 1980. `1.0` is physically calibrated; values
   * above 1 narrow waves toward the wind direction, below 1 broaden them.
   */
  spectralSharpness = uniform(1.0);
  standingWaveRatio = uniform(0.0);

  /** Set when any uniform changes. Consumers clear after reinit. */
  dirty = true;
  /**
   * Set when a parameter that affects the Phillips·JONSWAP 2D energy integrand
   * (`windSpeed`, `gravity`, `jonswapGamma`, `spectralSharpness`,
   * `standingWaveRatio`) changes. The cascade band assignment runs an init-time
   * numerical integral that depends on these — gating it on `bandDirty` instead
   * of `dirty` keeps slider drags on unrelated params (choppiness, direction,
   * amplitude) from paying the JS-side recompute cost.
   */
  bandDirty = true;

  update(params: WaveUniformParams) {
    const nextGravity = params.gravity ?? 9.81;
    const nextGamma = params.jonswapGamma ?? 3.3;
    const nextStanding = params.standingWaveRatio ?? 0.0;
    const bandAffecting =
      params.windSpeed !== this.windSpeed.value ||
      nextGravity !== this.gravity.value ||
      nextGamma !== this.jonswapGamma.value ||
      params.spectralSharpness !== this.spectralSharpness.value ||
      nextStanding !== this.standingWaveRatio.value;

    this.animationSpeed = params.animationSpeed ?? this.animationSpeed;
    this.amplitude.value = params.amplitude;
    this.windSpeed.value = params.windSpeed;
    this.windDirection.value = params.windDirection;
    this.choppiness.value = params.choppiness;
    this.gravity.value = nextGravity;
    this.jonswapGamma.value = nextGamma;
    this.spectralSharpness.value = params.spectralSharpness;
    this.standingWaveRatio.value = nextStanding;
    this.dirty = true;
    if (bandAffecting) this.bandDirty = true;
  }
}

export class SunUniforms {
  /**
   * Sun chromaticity, sourced from the preset's `sky.sun.diskColor`. CPU-only
   * (not a TSL uniform) — its sole consumer is the directional light that
   * lights the scene.
   */
  color = new THREE.Color(0xffffff);
  direction = uniform(new THREE.Vector3(0.5, 0.2, 0.5).normalize());
  intensity = uniform(1.5);

  update(params: SunUniformParams) {
    const elevation = THREE.MathUtils.degToRad(params.elevation);
    const azimuth = THREE.MathUtils.degToRad(params.azimuth);
    this.direction.value
      .set(
        Math.cos(elevation) * Math.sin(azimuth),
        Math.sin(elevation),
        Math.cos(elevation) * Math.cos(azimuth),
      )
      .normalize();
    this.intensity.value = params.intensity;
    this.color.set(params.diskColor);
  }
}

// ============= Per-cascade Simulation Uniforms =============

export class CascadeSimulationUniforms {
  resolution = uniform(256);
  scale = uniform(100);
  amplitudeScale = uniform(1.0);

  /**
   * Lower edge of the wavenumber band this cascade owns (rad/m). Energy
   * below this is smoothly attenuated to zero so adjacent cascades partition
   * the spectrum without overlap. Tiny non-zero default keeps the shader's
   * `smoothstep(kLo, kLo·1.5, k)` well-defined before assignCascadeBands writes
   * a real value.
   */
  kBandLow = uniform(1.0e-9);
  /**
   * Upper edge of the wavenumber band this cascade owns (rad/m). The smooth
   * cutoff between `kBandHigh/1.5` and `kBandHigh` also serves as anti-alias
   * roll-off near the cascade's Nyquist limit. Large default acts as
   * "unbounded" until assignCascadeBands writes a real value.
   */
  kBandHigh = uniform(1.0e9);
  /**
   * Init-time amplitude scaling that compensates for energy removed by the
   * k-band window, so each cascade's total displacement variance matches
   * the un-banded integral over its full [kFundamental, kNyquist] range.
   * Recomputed whenever scale/resolution/windSpeed/gravity change.
   */
  bandAmplitudeCompensation = uniform(1.0);

  foamLeadingEdgeScale = uniform(2.0);

  time = uniform(0);
  deltaTime = uniform(0.016);
  fftStage = uniform(0);
  fftDirection = uniform(0);
  fftComponent = uniform(0);
  // Phillips spectrum seed. Plain default is `1`; WaterSystem overrides
  // per-cascade at construction so cascades stay decorrelated even when the
  // caller sets a fixed root seed.
  randomSeed = uniform(1);

  init(resolution: number, scale: number, amplitudeScale: number) {
    this.resolution.value = resolution;
    this.scale.value = scale;
    this.amplitudeScale.value = amplitudeScale;
  }

  updateCascadeConfig(scale: number, amplitudeScale: number) {
    this.scale.value = scale;
    this.amplitudeScale.value = amplitudeScale;
  }
}

/**
 * Ocean floor displacement uniforms (FBM terrain variation)
 * Note: displacementScale uses inverted semantics - larger values = larger features
 */
export class FloorDisplacementUniforms {
  blendSoftness = uniform(0.3);
  blendThreshold = uniform(0.5);
  displacementScale = uniform(150.0);
  displacementStrength = uniform(5.0);
  lacunarity = uniform(2.0);
  normalScale = uniform(1.0);
  persistence = uniform(0.5);
  textureDisplacementStrength = uniform(0.5);
  textureScale = uniform(2.0);

  update(options: OceanFloorOptions) {
    if (options.blendSoftness !== undefined)
      this.blendSoftness.value = options.blendSoftness;
    if (options.blendThreshold !== undefined)
      this.blendThreshold.value = options.blendThreshold;
    if (options.displacementScale !== undefined)
      this.displacementScale.value = options.displacementScale;
    if (options.displacementStrength !== undefined)
      this.displacementStrength.value = options.displacementStrength;
    if (options.lacunarity !== undefined)
      this.lacunarity.value = options.lacunarity;
    if (options.normalScale !== undefined)
      this.normalScale.value = options.normalScale;
    if (options.persistence !== undefined)
      this.persistence.value = options.persistence;
    if (options.textureDisplacementStrength !== undefined)
      this.textureDisplacementStrength.value =
        options.textureDisplacementStrength;
  }
}

// ============= Uber Uniform =============

/**
 * Consolidated uniform object containing remaining surface shader uniform groups
 * that have not been converted to standalone shader classes.
 *
 * Shader classes (Fresnel, WaterColor, UnderwaterSurface,
 * SurfaceFoam, WaveFoam, ShorelineFoam, SSR, SSS, Sparkle, CascadeSampler) are
 * now owned directly by WaterSurfaceMaterial and passed individually to the
 * shader graph.
 */
export interface SurfaceUniforms {
  /** 1.0 when the camera is below the water surface, 0.0 above. */
  cameraSubmerged: TSLUniformNode;
  clipPlane: {
    cameraForward: TSLUniformNode;
    distance: TSLUniformNode;
    waterlineEnabled: TSLUniformNode;
    waterlineHighlightSharpness: TSLUniformNode;
    waterlineHighlightStrength: TSLUniformNode;
    waterlineNormalStrength: TSLUniformNode;
    waterlineSmoothness: TSLUniformNode;
    waterlineThickness: TSLUniformNode;
  };
  maskEnabled: TSLUniformNode;
  sun: {
    direction: TSLUniformNode;
    intensity: TSLUniformNode;
  };
  useDepthTexture: TSLUniformNode;
  useSceneColorTexture: TSLUniformNode;
  windDirection: TSLUniformNode;
}
