/**
 * WebGPU Water - Main Library Entry Point
 *
 * This module exports the core components needed to integrate
 * the water rendering system into your Three.js application.
 */

// High-level API (recommended for most users)
export { WaterSystem, type WaterPreset } from "./WaterSystem";

// Reactive param config types (for typing reactive property groups)
export type { WavesConfig } from "./simulation/waves/types";
export type {
  ColorConfig,
  FresnelConfig,
  SSSConfig,
  HorizonConfig,
} from "./components/surface/types";
export type { UnderwaterConfig } from "./rendering/postprocessing/types";

// Waves (FFT ocean simulation and sampling)
export {
  WaveSimulation,
  WaveSampler,
  WebGLWaveSimulation,
  WebGPUWaveSimulation,
  MAX_SAMPLE_POINTS,
  getCascadeConfigsArray,
  type IWaveSimulation,
  type CascadesConfig,
  type CascadeConfig,
  type CascadeSimulationParams,
  type WaveSample,
} from "./simulation/waves";

// Surface (water material and geometry)
export { WaterSurfaceMaterial } from "./components/surface/WaterSurfaceMaterial";
export {
  WaterSurfaceGeometry,
  type ClipmapConfig,
} from "./components/surface/WaterSurfaceGeometry";
export {
  getQualityFeatures,
  QUALITY_LEVELS,
  type QualityLevel,
  type QualityLevelConfig,
} from "./config/QualityLevels";

// Buoyancy (physics)
export {
  BuoyancySystem,
  BuoyancyDebugVisualizer,
  type BuoyancyOptions,
  type BuoyancyDebugData,
  type SamplePointData,
  type BuoyancyDebugConfig,
} from "./systems/buoyancy";

// Spray (scene-driven probe-based particle system; WebGPU only)
export {
  SpraySystem,
  SprayDebugVisualizer,
  type SprayParams,
  type AddEmitterOptions,
  type SprayProbe,
  type ProbeDebugSnapshot,
  type SprayDebugConfig,
} from "./systems/spray";

// Wake (generator registry + dispersive iWave displacement field)
export {
  WakeSystem,
  WakeDebugVisualizer,
  type WakeGenerator,
  type WakeGeneratorOptions,
  type WakeDebugData,
  type WakeDebugConfig,
} from "./systems/wake";

// Sky (image-based equirect / HDRI sky with optional sun disk overlay)
export {
  Sky,
  type SkyParams,
  type SkySunOverlayParams,
} from "./components/sky/Sky";

// Floor (ocean floor with integrated caustics)
export {
  OceanFloor,
  type OceanFloorOptions,
} from "./components/floor/OceanFloor";
export type { OceanFloorCaustics } from "./components/floor/types";

// Post-processing (underwater effects and fog)
export {
  AtmosphericFog,
  Underwater,
  type FogParams,
} from "./rendering/postprocessing";

// Underwater particles (world-space ambient particles)
export {
  UnderwaterParticles,
  PARTICLE_DEFAULTS as UNDERWATER_PARTICLE_DEFAULTS,
  type ParticlesInternalOptions,
  type ParticleParams as UnderwaterParticleParams,
} from "./systems/underwater";

// Passes (render passes)
export { SceneDepthPass } from "./rendering/passes/SceneDepthPass";
export { SceneColorPass } from "./rendering/passes/SceneColorPass";

// Config (presets and types)
export {
  PRESETS,
  getPresetParams,
  applyPresetToParams,
  type PresetName,
  type PresetConfig,
} from "./config/presets";

// Rain (particles, ripple simulation, and combined system)
export { RainSystem, type RainSystemParams } from "./systems/rain";
export { RainParticles, type RainParams } from "./systems/rain";
export { RainRipples, type RainRippleParams } from "./simulation/ripples";

// Param types
export type { GerstnerParams } from "./types/params";

// Bundled foam textures
export {
  loadBuiltInFoamTexture,
  type BuiltInFoamName,
} from "./shaders/builtInFoamTextures";

