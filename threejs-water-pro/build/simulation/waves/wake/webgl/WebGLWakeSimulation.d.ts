import type * as THREE from "three/webgpu";
import type { IWakeSimulation, WakeSimulationParams } from "../IWakeSimulation";
import type { IWakeFieldSampler } from "../IWakeFieldSampler";
export declare class WebGLWakeSimulation implements IWakeSimulation {
    private readonly _sampler;
    constructor(_params: WakeSimulationParams, _renderer: THREE.WebGPURenderer);
    getSampler(): IWakeFieldSampler;
    injectAlongPath(): void;
    reset(): void;
    setFriction(): void;
    setFoamPersistence(): void;
    setFoamStrength(): void;
    setFoamBreakThreshold(): void;
    setWorldSize(): void;
    step(): Promise<void>;
    dispose(): void;
}
//# sourceMappingURL=WebGLWakeSimulation.d.ts.map