// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

export type {
  IWakeSimulation,
  InjectAlongPathParams,
  WakeSimulationParams,
} from "./IWakeSimulation";
export type { IWakeFieldSampler, WakeDisplacementSample } from "./IWakeFieldSampler";
export type { InjectionDecision, InjectionDecisionParams } from "./injectionMath";
export { decideInjectionForFrame } from "./injectionMath";
export { createWakeSimulation } from "./createWakeSimulation";
export type { IWaveKernel, SeparableKernel } from "./kernel";
export {
  buildIWaveKernel,
  besselJ0,
  operatorScale,
  separableKernel,
} from "./kernel";
export { WebGPUWakeSimulation, WebGPUWakeFieldSampler } from "./webgpu";
export { WebGLWakeSimulation } from "./webgl";
