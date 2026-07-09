/**
 * Shared types for wave simulation implementations.
 */

/**
 * Configuration for a single cascade level (from presets).
 * Resolution and enabled state come from quality level.
 */
export interface CascadeConfig {
  /** World-space scale of this cascade's tile */
  scale: number;
  /** Amplitude multiplier for this cascade */
  amplitudeScale: number;
}

/**
 * Cascades configuration with named groups (from presets).
 * Gerstner waves replace the old FFT swells cascade analytically.
 */
export interface CascadesConfig {
  /** Medium scale (waves) */
  waves: CascadeConfig;
  /** Smallest scale (ripples) */
  ripples: CascadeConfig;
}

/**
 * Helper to get cascade configs as array (for indexed access).
 * Order: [waves, ripples] - largest to smallest scale.
 * Waves is always enabled; ripples is disabled at lower quality levels.
 */
export function getCascadeConfigsArray(
  cascades: CascadesConfig,
): CascadeConfig[] {
  return [cascades.waves, cascades.ripples];
}

/**
 * Parameter interfaces for simulation uniform classes.
 * Only cascade-specific values — shared wave physics params live in WaveUniforms.
 */
export interface CascadeSimulationParams {
  amplitudeScale: number;
  resolution: number;
  scale: number;
}

/**
 * Wave configuration for reactive params API.
 */
export interface WavesConfig {
  amplitude: number;
  frequency: number;
  animationSpeed: number;
  windSpeed: number;
  windDirection: number;
  choppiness: number;
  scale: number;
  gravity: number;
  amplitudeScale: number;
  jonswapGamma: number;
  spectralSharpness: number;
}
