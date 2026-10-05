/**
 * WaterReflectionGBufferPass renders the water surface at full resolution,
 * outputting `vec4(reflectDirWS.xyz, viewZ)` so the SSR ray-march pass can
 * reconstruct view-space ray origins and reflection directions without having
 * access to the water material's varyings.
 *
 * The G-buffer always runs at full resolution so the reflection direction
 * stays anti-aliased at distant grazing angles; only the SSR march resolution
 * scales.
 */
import * as THREE from "three/webgpu";
import type { UniformNode } from "three/webgpu";
import type { IWaveSimulation } from "../../simulation/waves";
import type { RainRipples } from "../../simulation/ripples";
import { type CascadeSampler, type Fresnel } from "../../shaders";
export interface WaterReflectionGBufferPassOptions {
    cascadeSampler: CascadeSampler | null;
    clipmapOffset: UniformNode<THREE.Vector2>;
    fresnel: Fresnel;
    oceanSim: IWaveSimulation;
    rainRipples: RainRipples | null;
}
/**
 * Renders the water mesh at full resolution into a G-buffer storing the
 * world-space reflection direction (RGB) and view-space depth (A).
 */
export declare class WaterReflectionGBufferPass {
    private renderTarget;
    private material;
    private camera;
    private waterObject;
    private savedParent;
    private options;
    private tempScene;
    constructor(camera: THREE.PerspectiveCamera, width: number, height: number, options: WaterReflectionGBufferPassOptions);
    /** Set the water mesh to render. */
    setWaterObject(obj: THREE.Object3D): void;
    /** Update the camera. */
    setCamera(camera: THREE.PerspectiveCamera): void;
    /** Get the G-buffer texture (vec4(reflectDirWS, viewZ)). */
    getTexture(): THREE.Texture;
    /** Resize the render target. */
    setSize(width: number, height: number): void;
    /**
     * Rebuild the shader graph after a quality-level change swapped any of the
     * inputs (cascade sampler, rainRipples, etc.).
     */
    rebuild(options: WaterReflectionGBufferPassOptions): void;
    /** Render the water mesh into the G-buffer. */
    render(renderer: THREE.WebGPURenderer): void;
    dispose(): void;
    private buildShaderGraph;
}
//# sourceMappingURL=WaterReflectionGBufferPass.d.ts.map