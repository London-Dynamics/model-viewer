// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Factory functions for creating wave simulation and sampler instances.
 * Automatically detects the rendering backend and creates the appropriate implementation.
 */

import type * as THREE from "three/webgpu";
import type { IWaveSimulation } from "./IWaveSimulation";
import type { IWaveSampler } from "./IWaveSampler";
import type { CascadesConfig } from "./types";
import type { QualityLevelConfig } from "../../config/QualityLevels";
import type { WaveUniforms } from "../../uniforms";
import type { TSLUniformNode } from "../../types/tsl";
import { WebGPUWaveSimulation } from "./webgpu";
import { WebGPUWaveSampler } from "./webgpu";
import { WebGLWaveSimulation } from "./webgl";
import { WebGLWaveSampler } from "./webgl";

export interface CreateWaveSimulationOptions {
  cascades: CascadesConfig;
  /** TSL uniform node for wind bias (from WaveFoam._windBiasNode). */
  foamWindBias: TSLUniformNode;
  forceBackend?: "webgpu" | "webgl";
  qualityConfig: QualityLevelConfig;
  /** Phillips spectrum seed. Defaults to 1; clients should set this for multiplayer sync. */
  seed: number;
  waveUniforms: WaveUniforms;
}

/**
 * Check if WebGPU is available in the browser.
 */
function isWebGPUAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

/**
 * Detect if the renderer is using WebGL backend.
 * Checks for WebGL-specific API on the backend object rather than relying
 * on constructor names, which get mangled in production builds.
 */
function isWebGLBackend(renderer: THREE.WebGPURenderer): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const backend = (renderer as any).backend;
  if (backend) {
    // WebGLBackend exposes a `gl` property (the WebGL2RenderingContext).
    // WebGPUBackend does not. This survives minification.
    if ("gl" in backend) return true;
    // WebGPUBackend has a `device` property (GPUDevice).
    if ("device" in backend) return false;
  }

  // Fallback: if WebGPU API is not available, we must be using WebGL
  return !isWebGPUAvailable();
}

/**
 * Create a wave simulation instance based on renderer capabilities.
 *
 * @param renderer - The Three.js WebGPU renderer
 * @param options - Wave simulation options
 * @returns An IWaveSimulation instance (either WebGPU or WebGL implementation)
 */
export function createWaveSimulation(
  renderer: THREE.WebGPURenderer,
  options: CreateWaveSimulationOptions,
): IWaveSimulation {
  const useWebGL =
    options.forceBackend === "webgl" ||
    (options.forceBackend !== "webgpu" && isWebGLBackend(renderer));

  if (useWebGL) {
    return new WebGLWaveSimulation(renderer, {
      cascades: options.cascades,
      foamWindBias: options.foamWindBias,
      qualityConfig: options.qualityConfig,
      seed: options.seed,
      waveUniforms: options.waveUniforms,
    });
  } else {
    return new WebGPUWaveSimulation(renderer, {
      cascades: options.cascades,
      foamWindBias: options.foamWindBias,
      qualityConfig: options.qualityConfig,
      seed: options.seed,
      waveUniforms: options.waveUniforms,
    });
  }
}

/**
 * Create a wave sampler instance for the given simulation.
 *
 * @param simulation - The wave simulation to sample from
 * @param renderer - The Three.js WebGPU renderer
 * @returns An IWaveSampler instance matching the simulation backend
 */
export function createWaveSampler(
  simulation: IWaveSimulation,
  renderer: THREE.WebGPURenderer,
): IWaveSampler {
  const capabilities = simulation.getCapabilities();

  if (capabilities.backend === "webgpu") {
    return new WebGPUWaveSampler(simulation as WebGPUWaveSimulation, renderer);
  } else {
    return new WebGLWaveSampler(simulation as WebGLWaveSimulation, renderer);
  }
}
