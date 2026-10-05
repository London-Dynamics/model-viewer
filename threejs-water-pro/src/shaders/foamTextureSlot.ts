// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * A foam texture binding shared by the foam shader classes (surface, wave-crest,
 * shoreline).
 *
 * It owns the TSL `texture()` node the shader samples and resolves bundled foam
 * textures asynchronously: the node is only rebound once the image has decoded,
 * so the GPU never samples an empty texture. A "last request wins" guard means
 * rapid selections converge on the most recent one even if their decodes finish
 * out of order. Until the first decode resolves, the node keeps showing the
 * default foam texture, so there is no blank frame.
 */
import * as THREE from "three/webgpu";
import { texture } from "three/tsl";

import { createDefaultFoamTexture } from "./foamDefaults";
import {
  loadBuiltInFoamTexture,
  type BuiltInFoamName,
} from "./builtInFoamTextures";

export class FoamTextureSlot {
  /** The TSL texture node the foam shader samples. */
  readonly node = texture(createDefaultFoamTexture());

  /** Most recently requested bundled-foam name; guards against stale decodes. */
  private _pendingName: BuiltInFoamName | null = null;

  /** The currently bound texture. */
  get value(): THREE.Texture {
    return this.node.value;
  }

  /** Bind a caller-owned texture directly (bypasses the async bundled loader). */
  set value(tex: THREE.Texture) {
    this._pendingName = null;
    this.node.value = tex;
  }

  /**
   * Decode the named bundled foam texture, then bind it — unless a newer
   * request superseded it while decoding. Errors are reported, not thrown, so a
   * failed decode leaves the previous texture in place.
   */
  async load(name: BuiltInFoamName): Promise<void> {
    this._pendingName = name;
    try {
      const tex = await loadBuiltInFoamTexture(name);
      if (this._pendingName === name) {
        // Clone so each slot's node holds a texture with a unique UUID. TSL
        // shares one GPU binding across uniform nodes that hash equal, and a
        // texture node's hash is its texture's UUID — without the clone, two
        // slots loading the same bundled name would collapse onto a single
        // binding, so changing one slot's texture would silently change the
        // others. The clone shares the decoded source, so there is no re-decode.
        this.node.value = tex.clone();
      }
    } catch (err) {
      console.warn(`Failed to load foam texture "${name}":`, err);
    }
  }
}
