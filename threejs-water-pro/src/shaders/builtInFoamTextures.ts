/**
 * Bundled foam textures shipped with the library.
 *
 * Presets reference these by name (e.g. `"foam2"`) via the `foam.*.texture`
 * field. `loadBuiltInFoamTexture` resolves the name to a cached
 * `THREE.Texture` so the same image isn't re-decoded per foam slot.
 *
 * The JPGs live under `src/assets/` and are emitted as separate asset files
 * by the library build. Consumers using Vite/Rollup/webpack 5 pick them up
 * automatically through the ESM `import` of the `.jpg` path.
 */
import * as THREE from "three/webgpu";

import foam1Url from "../assets/foam1.jpg";
import foam2Url from "../assets/foam2.jpg";
import foam3Url from "../assets/foam3.jpg";
import foam4Url from "../assets/foam4.jpg";

/** Names of the foam textures bundled with the library. */
export type BuiltInFoamName = "foam1" | "foam2" | "foam3" | "foam4";

const FOAM_URLS: Record<BuiltInFoamName, string> = {
  foam1: foam1Url,
  foam2: foam2Url,
  foam3: foam3Url,
  foam4: foam4Url,
};

const _cache = new Map<BuiltInFoamName, THREE.Texture>();
const _loader = new THREE.TextureLoader();

/**
 * Returns the bundled foam texture for the given name. The texture is loaded
 * once and cached; repeated calls return the same instance. The returned
 * texture uses `RepeatWrapping` on both axes so it tiles cleanly.
 */
export function loadBuiltInFoamTexture(name: BuiltInFoamName): THREE.Texture {
  const cached = _cache.get(name);
  if (cached) return cached;

  const tex = _loader.load(FOAM_URLS[name]);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  _cache.set(name, tex);
  return tex;
}
