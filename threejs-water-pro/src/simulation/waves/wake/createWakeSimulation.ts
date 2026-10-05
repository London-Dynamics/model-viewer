// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type * as THREE from "three/webgpu";
import type { IWakeSimulation } from "./IWakeSimulation";
import type { WakeSimulationParams } from "./IWakeSimulation";
import { WebGPUWakeSimulation } from "./webgpu";
import { WebGLWakeSimulation } from "./webgl";

/**
 * Construct the dispersive wake simulation for the active renderer backend.
 * Both backends run the same iWave convolution + leapfrog: WebGPU as a compute
 * kernel over storage buffers, WebGL as render-to-texture fragment passes over
 * float render targets.
 *
 * @param params - Resolution, extent, shared gravity node, friction, generator cap.
 * @param renderer - Active renderer.
 * @param isWebGL - true for the WebGL render-to-texture backend; false for WebGPU compute.
 */
export function createWakeSimulation(
  params: WakeSimulationParams,
  renderer: THREE.WebGPURenderer,
  isWebGL: boolean,
): IWakeSimulation {
  return isWebGL
    ? new WebGLWakeSimulation(params, renderer)
    : new WebGPUWakeSimulation(params, renderer);
}
