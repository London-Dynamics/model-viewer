/**
 * WebGL FFT wave simulation using render-to-texture ping-pong buffers.
 * This implementation replicates the WebGPU compute shader approach using fragment shaders.
 */
import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import type { IWaveSimulation, WaveCapabilities, WaveDisplacementNodes, WaveNormalNodes } from "../IWaveSimulation";
import type { CascadesConfig } from "../types";
import type { TSLBuffer, TSLUniformNode } from "../../../types/tsl";
import type { QualityLevelConfig } from "../../../config/QualityLevels";
import { type WaveUniforms } from "../../../uniforms";
export interface WebGLWaveSimulationOptions {
    cascades: CascadesConfig;
    foamWindBias: TSLUniformNode;
    qualityConfig: QualityLevelConfig;
    /** Phillips spectrum seed. Cascade `i` uses `seed + i` for decorrelation. */
    seed: number;
    waveUniforms: WaveUniforms;
}
/**
 * WebGL FFT wave simulation using render-to-texture.
 * Provides physically-based wave simulation compatible with WebGL2.
 */
export declare class WebGLWaveSimulation implements IWaveSimulation {
    private cascades;
    private renderer;
    private time;
    private _explicitTimeThisFrame;
    private _seed;
    private _animationSpeed;
    private _waveUniforms;
    private _foamWindBias;
    private quadMesh;
    constructor(renderer: THREE.WebGPURenderer, options: WebGLWaveSimulationOptions);
    /**
     * Override the simulation's time accumulator with an absolute time.
     * Used by `WaterSystem.syncToTick` for multiplayer sync. The next
     * `update()` call drives the GPU using the new time without further
     * internal accumulation.
     */
    setTime(t: number): void;
    get animationSpeed(): number;
    set animationSpeed(value: number);
    getCapabilities(): WaveCapabilities;
    getDisplacementNodes(): WaveDisplacementNodes;
    getNormalNodes(): WaveNormalNodes;
    /** Convert world coordinates to UV for a cascade's texture. */
    private worldToUV;
    private initCascades;
    private createRenderTarget;
    private createCascade;
    private renderToTarget;
    private runFFT;
    private updateCascade;
    init(): void;
    initializeBuffers(_renderer: THREE.WebGPURenderer): Promise<void>;
    update(deltaTime?: number): void;
    dispose(): void;
    getCascadeCount(): number;
    getDisplacementBuffer(_cascadeIndex?: number): TSLBuffer | null;
    getResolution(cascadeIndex?: number): number;
    getScale(cascadeIndex?: number): number;
    /**
     * Get a cascade's world-space scale uniform node (the single source of truth
     * shared with the cascade's FFT/normal shaders). The persistent-foam field
     * sampler binds to it so its cascade-tiled world→UV mapping tracks the same
     * scale as the normal texture the inject pass reads.
     */
    getScaleNode(cascadeIndex?: number): Node | null;
    setMaxScale(maxScale: number): void;
    /** Get the displacement texture for a cascade. */
    getDisplacementTexture(cascadeIndex?: number): THREE.Texture | null;
    /** Get the normal texture for a cascade. */
    getNormalTexture(cascadeIndex?: number): THREE.Texture | null;
    /** Get the displacement render target for CPU readback. */
    getDisplacementRenderTarget(cascadeIndex?: number): THREE.RenderTarget | null;
    /** Get the normal render target for CPU readback. */
    getNormalRenderTarget(cascadeIndex?: number): THREE.RenderTarget | null;
}
//# sourceMappingURL=WebGLWaveSimulation.d.ts.map