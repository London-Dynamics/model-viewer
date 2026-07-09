import type * as THREE from "three/webgpu";
import type { IWakeSimulation } from "./IWakeSimulation";
import type { WakeSimulationParams } from "./IWakeSimulation";
import { WebGPUWakeSimulation } from "./webgpu";
import { WebGLWakeSimulation } from "./webgl";

/**
 * Construct the dispersive wake simulation for the active renderer backend.
 * WebGPU runs the iWave convolution + leapfrog as a compute kernel over storage
 * buffers; WebGL has no compute path, so it gets a zero-field stub (calm water).
 *
 * @param params - Resolution, extent, shared gravity node, friction, generator cap.
 * @param renderer - Active renderer.
 * @param isWebGL - true to construct the WebGL stub; false for WebGPU.
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
