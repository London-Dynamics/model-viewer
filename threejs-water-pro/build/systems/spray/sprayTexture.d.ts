/**
 * Spray flipbook atlas loader (multi-variant).
 *
 * Loads `splash{1..8}.jpg` — eight independent 7×7 burst atlases laid out
 * row-major — into a single `DataArrayTexture` of depth `SPRAY_VARIANT_COUNT`.
 * Each particle picks one variant index at spawn (frozen for its lifetime),
 * so consecutive plumes don't all play the exact same animation.
 *
 * Single-channel R8 storage: the render shader reads only the red channel
 * (alpha mask), so RGBA would waste 75% of the VRAM. With 8 variants at
 * 2048² each, this comes to ~32 MB on the GPU instead of ~128 MB.
 *
 * Returns immediately with a zero-initialised texture; layers populate
 * asynchronously as each JPEG decodes. Until a layer is filled, sampling
 * it returns black — particles spawned in the first ~100 ms after page
 * load may render invisibly, which is preferable to blocking startup.
 */
import * as THREE from "three/webgpu";
/** Number of frames per side of each atlas grid. */
export declare const SPRAY_ATLAS_GRID = 7;
/** Total number of flipbook frames per variant (rows × cols). */
export declare const SPRAY_ATLAS_FRAME_COUNT: number;
/** Number of independent atlas variants packed into the array texture. */
export declare const SPRAY_VARIANT_COUNT = 8;
/**
 * Build the spray flipbook array texture. Allocates the full GPU resource
 * up front (so its dimensions never change after binding) and fills each
 * layer's pixel data asynchronously as the source JPEGs decode.
 */
export declare function createSprayTexture(): THREE.DataArrayTexture;
//# sourceMappingURL=sprayTexture.d.ts.map