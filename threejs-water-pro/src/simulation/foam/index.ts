// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

export type { IFoamFieldSampler } from "./IFoamFieldSampler";
export { createFoamAccumulation } from "./createFoamAccumulation";
export { FoamAccumulation } from "./FoamAccumulation";
export type { FoamAccumulationConfig } from "./FoamAccumulation";
export { FoamFieldSampler } from "./FoamFieldSampler";
export {
  accumulateCombinedFoam,
  foamAccumulate,
  foamInjectionEnergy,
  crestFoamEnergy,
} from "./shaders/accumulation";
export type {
  CombinedFoamParams,
  FoamAccumulateParams,
  FoamFoldSource,
  FoamInjectionEnergyParams,
} from "./shaders/accumulation";
