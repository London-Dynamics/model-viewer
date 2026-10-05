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
import { type BuiltInFoamName } from "./builtInFoamTextures";
export declare class FoamTextureSlot {
    /** The TSL texture node the foam shader samples. */
    readonly node: THREE.TextureNode;
    /** Most recently requested bundled-foam name; guards against stale decodes. */
    private _pendingName;
    /** The currently bound texture. */
    get value(): THREE.Texture;
    /** Bind a caller-owned texture directly (bypasses the async bundled loader). */
    set value(tex: THREE.Texture);
    /**
     * Decode the named bundled foam texture, then bind it — unless a newer
     * request superseded it while decoding. Errors are reported, not thrown, so a
     * failed decode leaves the previous texture in place.
     */
    load(name: BuiltInFoamName): Promise<void>;
}
//# sourceMappingURL=foamTextureSlot.d.ts.map