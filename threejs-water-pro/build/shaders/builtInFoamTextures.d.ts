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
/** Names of the foam textures bundled with the library. */
export type BuiltInFoamName = "foam1" | "foam2" | "foam3" | "foam4";
/**
 * Returns the bundled foam texture for the given name. The texture is loaded
 * once and cached; repeated calls return the same instance. The returned
 * texture uses `RepeatWrapping` on both axes so it tiles cleanly.
 */
export declare function loadBuiltInFoamTexture(name: BuiltInFoamName): THREE.Texture;
//# sourceMappingURL=builtInFoamTextures.d.ts.map