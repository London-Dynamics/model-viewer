import type { Node } from "three/webgpu";
/**
 * Wake displacement produced by {@link IWakeFieldSampler.sample}.
 *
 * The vertex shader adds the height to the FFT displacement total each
 * frame; see `src/shaders/waterVertex.ts`.
 */
export interface WakeDisplacementSample {
    /** Vertical displacement (Y) at the sampled world position. */
    height: Node;
}
/**
 * Backend-agnostic read interface for the wake displacement field.
 *
 * The displacement is a packed `vec2(height, foam)` buffer (WebGPU storage
 * buffer or WebGL float render target). The surface vertex shader reads the
 * height, the fragment shader reads the foam energy and the height-gradient
 * normal. Stable across a frame; re-handed to the material when the field is
 * rebuilt (resolution change).
 */
export interface IWakeFieldSampler {
    /**
     * Wake height at the given world coordinates. Outside the field extent reads
     * as zero (calm water), so the wake fades cleanly at the rim.
     */
    sample(worldX: Node, worldZ: Node): WakeDisplacementSample;
    /**
     * Persistent wake-foam energy at the given world coordinates. Fed into the
     * surface material's WaveFoam renderer (as crest-foam energy) so wake foam
     * shades identically to wind-driven crest foam.
     */
    sampleFoamEnergy(worldX: Node, worldZ: Node): Node;
    /**
     * Wake surface normal `vec3(−∂h/∂x, 1, −∂h/∂z)` (normalized) from central
     * differences of the height channel. Blended into the surface normal so the
     * wake catches light; reads as `(0, 1, 0)` where the field is calm.
     */
    sampleNormal(worldX: Node, worldZ: Node): Node;
}
//# sourceMappingURL=IWakeFieldSampler.d.ts.map