/**
 * WebGPU Water - Main Library Entry Point
 *
 * This module exports the core components needed to integrate
 * the water rendering system into your Three.js application.
 */
export { WaterSystem, type WaterPreset } from "./WaterSystem";
export type { WavesConfig } from "./simulation/waves/types";
export type { ColorConfig, FresnelConfig, SSSConfig, HorizonConfig, } from "./components/surface/types";
export type { UnderwaterConfig } from "./rendering/postprocessing/types";
export { WaveSimulation, WaveSampler, WebGLWaveSimulation, WebGPUWaveSimulation, MAX_SAMPLE_POINTS, getCascadeConfigsArray, type IWaveSimulation, type CascadesConfig, type CascadeConfig, type CascadeSimulationParams, type WaveSample, } from "./simulation/waves";
export { WaterSurfaceMaterial } from "./components/surface/WaterSurfaceMaterial";
export { WaterSurfaceGeometry, type ClipmapConfig, } from "./components/surface/WaterSurfaceGeometry";
export { getQualityFeatures, QUALITY_LEVELS, type QualityLevel, type QualityLevelConfig, } from "./config/QualityLevels";
export { BuoyancySystem, BuoyancyDebugVisualizer, type BuoyancyOptions, type BuoyancyDebugData, type SamplePointData, type BuoyancyDebugConfig, } from "./systems/buoyancy";
export { SpraySystem, SprayDebugVisualizer, type SprayParams, type AddEmitterOptions, type SprayProbe, type ProbeDebugSnapshot, type SprayDebugConfig, } from "./systems/spray";
export { WakeSystem, WakeDebugVisualizer, type WakeGenerator, type WakeGeneratorOptions, type WakeDebugData, type WakeDebugConfig, } from "./systems/wake";
export { Sky, type SkyParams, type SkySunOverlayParams, } from "./components/sky/Sky";
export { OceanFloor, type OceanFloorOptions, } from "./components/floor/OceanFloor";
export type { OceanFloorCaustics } from "./components/floor/types";
export { AtmosphericFog, Underwater, type FogParams, } from "./rendering/postprocessing";
export { UnderwaterParticles, PARTICLE_DEFAULTS as UNDERWATER_PARTICLE_DEFAULTS, type ParticlesInternalOptions, type ParticleParams as UnderwaterParticleParams, } from "./systems/underwater";
export { SceneDepthPass } from "./rendering/passes/SceneDepthPass";
export { SceneColorPass } from "./rendering/passes/SceneColorPass";
export { PRESETS, getPresetParams, applyPresetToParams, type PresetName, type PresetConfig, } from "./config/presets";
export { RainSystem, type RainSystemParams } from "./systems/rain";
export { RainParticles, type RainParams } from "./systems/rain";
export { RainRipples, type RainRippleParams } from "./simulation/ripples";
export type { GerstnerParams } from "./types/params";
export { loadBuiltInFoamTexture, type BuiltInFoamName, } from "./shaders/builtInFoamTextures";
//# sourceMappingURL=index.d.ts.map