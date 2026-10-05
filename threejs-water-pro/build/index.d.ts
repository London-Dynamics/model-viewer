/**
 * WebGPU Water - Main Library Entry Point
 *
 * This module exports the core components needed to integrate
 * the water rendering system into your Three.js application.
 */
export { WaterSystem, type WaterPreset, type WaterPresetConfig, } from "./WaterSystem";
export type { WavesConfig } from "./simulation/waves/types";
export type { ColorConfig, FresnelConfig, SSSConfig, HorizonConfig, } from "./components/surface/types";
export type { UnderwaterConfig } from "./rendering/postprocessing/types";
export { JERLOV_WATER_TYPES, type JerlovWaterType, type WaterConstituents, } from "./shaders/waterConstituents";
export type { CustomWaterColorParams, PhysicalWaterColorParams, WaterColorConfig, WaterColorMode, WaterColorParams, } from "./shaders/waterColor";
export { normalizeWaterColorConfig } from "./shaders/waterColor";
export { WaveSimulation, WaveSampler, WebGLWaveSimulation, WebGPUWaveSimulation, MAX_SAMPLE_POINTS, deriveCascadeScale, type IWaveSimulation, type CascadesConfig, type CascadeSimulationParams, type WaveSample, } from "./simulation/waves";
export { WaterSurfaceMaterial } from "./components/surface/WaterSurfaceMaterial";
export { WaterSurfaceGeometry, type ClipmapConfig, } from "./components/surface/WaterSurfaceGeometry";
export { getQualityFeatures, QUALITY_LEVELS, type QualityLevel, type QualityLevelConfig, } from "./config/QualityLevels";
export { BuoyancySystem, BuoyancyDebugVisualizer, type BuoyancyOptions, type BuoyancyDebugData, type SamplePointData, type BuoyancyDebugConfig, } from "./systems/buoyancy";
export { SpraySystem, SprayDebugVisualizer, type SprayParams, type AddEmitterOptions, type SprayProbe, type ProbeDebugSnapshot, type SprayDebugConfig, } from "./systems/spray";
export { WakeSystem, WakeDebugVisualizer, type WakeGenerator, type WakeGeneratorOptions, type WakeDebugData, type WakeDebugConfig, } from "./systems/wake";
export { Sky, type SkyParams, type SkySunOverlayParams, } from "./components/sky/Sky";
export type { SkyProvider } from "./components/sky/SkyProvider";
export { OceanFloor, type OceanFloorOptions, } from "./components/floor/OceanFloor";
export type { OceanFloorCaustics } from "./components/floor/types";
export { AtmosphericFog, Underwater, type FoggedColorOptions, type FogParams, } from "./rendering/postprocessing";
export { UnderwaterParticles, PARTICLE_DEFAULTS as UNDERWATER_PARTICLE_DEFAULTS, type ParticlesInternalOptions, type ParticleParams as UnderwaterParticleParams, } from "./systems/underwater";
export { SceneCapturePass } from "./rendering/passes/SceneCapturePass";
export { SceneDepthSampler } from "./rendering/passes/SceneDepthSampler";
export { PRESETS, getPresetParams, applyPresetToParams, normalizeWaterSceneConfig, type PresetName, type PresetConfig, type WaterSceneConfig, } from "./config/presets";
export { RainSystem, type RainSystemParams } from "./systems/rain";
export { RainParticles, type RainParams } from "./systems/rain";
export { RainRipples, type RainRippleParams } from "./simulation/ripples";
export { loadBuiltInFoamTexture, type BuiltInFoamName, } from "./shaders/builtInFoamTextures";
//# sourceMappingURL=index.d.ts.map