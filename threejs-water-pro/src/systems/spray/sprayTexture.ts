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
import splash1Url from "../../assets/splash1.jpg";
import splash2Url from "../../assets/splash2.jpg";
import splash3Url from "../../assets/splash3.jpg";
import splash4Url from "../../assets/splash4.jpg";
import splash5Url from "../../assets/splash5.jpg";
import splash6Url from "../../assets/splash6.jpg";
import splash7Url from "../../assets/splash7.jpg";
import splash8Url from "../../assets/splash8.jpg";

/** Number of frames per side of each atlas grid. */
export const SPRAY_ATLAS_GRID = 7;
/** Total number of flipbook frames per variant (rows × cols). */
export const SPRAY_ATLAS_FRAME_COUNT = SPRAY_ATLAS_GRID * SPRAY_ATLAS_GRID;
/** Number of independent atlas variants packed into the array texture. */
export const SPRAY_VARIANT_COUNT = 8;

const ATLAS_SIZE = 2048;
const BYTES_PER_LAYER = ATLAS_SIZE * ATLAS_SIZE; // R8: 1 byte per texel

const SPLASH_URLS: readonly string[] = [
  splash1Url,
  splash2Url,
  splash3Url,
  splash4Url,
  splash5Url,
  splash6Url,
  splash7Url,
  splash8Url,
];

/**
 * Build the spray flipbook array texture. Allocates the full GPU resource
 * up front (so its dimensions never change after binding) and fills each
 * layer's pixel data asynchronously as the source JPEGs decode.
 */
export function createSprayTexture(): THREE.DataArrayTexture {
  const data = new Uint8Array(BYTES_PER_LAYER * SPRAY_VARIANT_COUNT);
  const tex = new THREE.DataArrayTexture(
    data,
    ATLAS_SIZE,
    ATLAS_SIZE,
    SPRAY_VARIANT_COUNT,
  );
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;

  SPLASH_URLS.forEach((url, layer) => {
    loadLayer(url, layer, data).then(() => {
      tex.needsUpdate = true;
    });
  });

  return tex;
}

/**
 * Decode one splash JPEG and copy its red channel into the array texture's
 * backing buffer at the given layer offset. Resolves once the data is
 * ready (the caller flips `needsUpdate`).
 */
async function loadLayer(
  url: string,
  layer: number,
  data: Uint8Array,
): Promise<void> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();

  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("createSprayTexture: 2D canvas unavailable");
  // Flip Y on draw so the buffer ends up bottom-up in source-image terms.
  // `TextureLoader` does this implicitly via `flipY=true`; `DataArrayTexture`
  // skips it and uploads pixels as-is. Without the flip, every frame in
  // the atlas (and the burst sequence itself) renders upside down.
  ctx.translate(0, ATLAS_SIZE);
  ctx.scale(1, -1);
  ctx.drawImage(img, 0, 0, ATLAS_SIZE, ATLAS_SIZE);
  const rgba = ctx.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data;

  const offset = layer * BYTES_PER_LAYER;
  for (let i = 0; i < BYTES_PER_LAYER; i++) {
    data[offset + i] = rgba[i * 4]; // red channel only
  }
}
