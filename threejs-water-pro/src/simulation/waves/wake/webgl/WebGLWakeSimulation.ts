import { float, vec3 } from "three/tsl";
import type * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type {
  IWakeSimulation,
  WakeSimulationParams,
} from "../IWakeSimulation";
import type { IWakeFieldSampler, WakeDisplacementSample } from "../IWakeFieldSampler";

/**
 * WebGL wake stub — a zero displacement field.
 *
 * The iWave update is a WebGPU compute kernel (storage buffers + a large
 * convolution), which the WebGL backend has no path for, so it renders no wake
 * (calm water). The surface material's sampler reads stay valid and error-free:
 * the stub's sampler returns zero height, zero foam, and an up normal.
 */
class ZeroSampler implements IWakeFieldSampler {
  sample(): WakeDisplacementSample {
    return { height: float(0.0) };
  }
  sampleFoamEnergy(): Node {
    return float(0.0);
  }
  sampleNormal(): Node {
    return vec3(0.0, 1.0, 0.0);
  }
}

export class WebGLWakeSimulation implements IWakeSimulation {
  private readonly _sampler = new ZeroSampler();

  constructor(_params: WakeSimulationParams, _renderer: THREE.WebGPURenderer) {
    // No GPU resources — the field is identically zero.
  }

  getSampler(): IWakeFieldSampler {
    return this._sampler;
  }

  injectAlongPath(): void {}
  reset(): void {}
  setFriction(): void {}
  setFoamPersistence(): void {}
  setFoamStrength(): void {}
  setFoamBreakThreshold(): void {}
  setWorldSize(): void {}

  async step(): Promise<void> {}

  dispose(): void {}
}
