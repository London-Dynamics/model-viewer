import type { Node } from "three/webgpu";
/**
 * Read interface for the world-fixed wave-crest foam field.
 *
 * The surface fragment shader reads `sampleEnergy` and feeds the result into the
 * WaveFoam renderer as crest-foam energy. The field is camera-anchored: it covers
 * a world window around the camera, fading to calm at the rim. The bound texture
 * node is re-pointed at the freshly written target each step, so the surface
 * material compiles against it once.
 */
export interface IFoamFieldSampler {
    /**
     * Persistent foam energy at the given world coordinates (`≥ 0`). Reads zero
     * (calm) outside the field's world window, fading smoothly at the rim.
     */
    sampleEnergy(worldX: Node, worldZ: Node): Node;
}
//# sourceMappingURL=IFoamFieldSampler.d.ts.map