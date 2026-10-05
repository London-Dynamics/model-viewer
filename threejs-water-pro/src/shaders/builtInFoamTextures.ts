// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

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

const _cache = new Map<BuiltInFoamName, Promise<THREE.Texture>>();
const _loader = new THREE.TextureLoader();

/**
 * Loads the bundled foam texture for the given name, resolving once the image
 * has decoded. The decode is performed once per name and cached, so repeated
 * calls share the same in-flight or settled promise. The resolved texture uses
 * `RepeatWrapping` on both axes so it tiles cleanly.
 *
 * Resolving only after decode is what lets callers bind the texture without the
 * GPU sampling an empty image; assigning a not-yet-decoded texture is the cause
 * of foam swaps that "don't apply".
 */
export function loadBuiltInFoamTexture(
  name: BuiltInFoamName,
): Promise<THREE.Texture> {
  const cached = _cache.get(name);
  if (cached) return cached;

  const promise = _loader.loadAsync(FOAM_URLS[name]).then((tex) => {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });
  // Drop failed loads so a later call can retry instead of replaying the error.
  promise.catch(() => _cache.delete(name));
  _cache.set(name, promise);
  return promise;
}
