import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  positionView,
  cameraNear,
  cameraFar,
  vec4,
  texture,
  uv,
  If,
  Discard,
} from "three/tsl";

/**
 * Creates the opaque depth output node.
 * R = normalized linear depth; G is unused; B and A are 1.0.
 */
const createDepthOutputNode = /*@__PURE__*/ Fn(() => {
  const viewZ = positionView.z.negate();
  const normalizedDepth = viewZ.sub(cameraNear).div(cameraFar.sub(cameraNear));
  return vec4(normalizedDepth, float(0.0), float(1.0), float(1.0));
});

/**
 * Creates a depth output node with alpha test support.
 * R = normalized linear depth; G is unused; B and A are 1.0.
 */
const createAlphaDepthOutputNode = (
  alphaMap: THREE.Texture,
  alphaThreshold: number,
) => {
  const alphaTexture = texture(alphaMap);
  const threshold = float(alphaThreshold);

  return Fn(() => {
    // Sample alpha from the texture at current UV
    const alpha = alphaTexture.sample(uv()).a;

    // Discard fragment if alpha below threshold
    If(alpha.lessThan(threshold), () => {
      Discard();
    });

    const viewZ = positionView.z.negate();
    const normalizedDepth = viewZ
      .sub(cameraNear)
      .div(cameraFar.sub(cameraNear));
    return vec4(normalizedDepth, float(0.0), float(1.0), float(1.0));
  });
};

/**
 * Depth output node for transparent objects, written to a dedicated target.
 * B = normalized depth, A = object opacity; R/G are unused (the target carries
 * only the transparent channels, so no MIN blend is needed to preserve opaques).
 */
const createTransparentDepthOutputNode = (opacity: number) => {
  const opacityVal = float(opacity);
  return Fn(() => {
    const viewZ = positionView.z.negate();
    const normalizedDepth = viewZ
      .sub(cameraNear)
      .div(cameraFar.sub(cameraNear));
    return vec4(float(0.0), float(0.0), normalizedDepth, opacityVal);
  });
};

/**
 * SceneDepthPass renders the scene depth to a color texture for use in water depth calculations.
 * This allows the water shader to know the actual depth to the sea floor at each pixel.
 *
 * We render depth to a color texture (not a depth texture) because TSL's texture()
 * function works more reliably with color textures.
 *
 * Main depth target layout:
 *   R = opaque depth (normalized linear)
 *   G = unused
 *
 * Transparent objects' depth and alpha live in a separate target
 * ({@link getTransparentDepthTexture}): B = depth, A = opacity (1.0 = none).
 * Keeping them apart means the pass needs no per-channel MIN blend (which the
 * WebGL backend cannot map). Render passes:
 *   1. Opaque/alpha-tested objects → main target R, G.
 *   2. Transparent objects → transparent-depth target B, A (no blend; occlusion
 *      against opaques is resolved in the consumer).
 *   3. Transparent objects' premultiplied colour → transparent-colour target.
 */
export class SceneDepthPass {
  private renderTarget: THREE.RenderTarget;
  private transparentColorTarget: THREE.RenderTarget;
  /** Transparent objects' depth (B) and alpha (A) — its own target so no MIN
   * blend is needed to preserve the opaque R/G (MIN is unsupported on WebGL). */
  private transparentDepthTarget: THREE.RenderTarget;
  private depthMaterial: THREE.MeshBasicNodeMaterial;
  private camera: THREE.PerspectiveCamera;
  private scene: THREE.Scene;
  private excludedObjects: Set<THREE.Object3D> = new Set();

  // Store original visibility for restoration
  private originalVisibility: Map<THREE.Object3D, boolean> = new Map();

  // Cache for alpha-tested depth materials (keyed by texture uuid)
  private alphaDepthMaterials: Map<string, THREE.MeshBasicNodeMaterial> =
    new Map();

  // Cache for transparent depth materials (keyed by opacity)
  private transparentDepthMaterials: Map<string, THREE.MeshBasicNodeMaterial> =
    new Map();

  // Store original materials for meshes that need alpha-aware depth
  private originalMaterials: Map<
    THREE.Mesh,
    THREE.Material | THREE.Material[]
  > = new Map();

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
  ) {
    this.scene = scene;
    this.camera = camera;

    // Create render target with float texture to store linear depth
    this.renderTarget = new THREE.RenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });

    // Transparent object color (premultiplied alpha in RGB).
    // Used by the underwater fog shader to decompose scene into transparent
    // and background layers for independent fogging.
    this.transparentColorTarget = new THREE.RenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });

    // Transparent object depth (B) and alpha (A), on its own target. NEAREST so
    // the per-pixel flag matches the rasterized silhouette; no depth buffer
    // since occlusion against opaques is resolved in the consumer (it compares
    // the transparent depth against the opaque depth it already samples).
    this.transparentDepthTarget = new THREE.RenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });

    // Create default depth material for opaque objects
    this.depthMaterial = new THREE.MeshBasicNodeMaterial();
    this.depthMaterial.side = THREE.DoubleSide;
    this.depthMaterial.colorNode = createDepthOutputNode();
  }

  /**
   * Get or create a depth material that respects alpha testing for a given texture
   */
  private getAlphaDepthMaterial(
    map: THREE.Texture,
    alphaTest: number,
  ): THREE.MeshBasicNodeMaterial {
    const key = `${map.uuid}_${alphaTest}`;

    if (!this.alphaDepthMaterials.has(key)) {
      const mat = new THREE.MeshBasicNodeMaterial();
      mat.side = THREE.DoubleSide;
      // Use custom depth node that samples alpha and discards fragments
      mat.colorNode = createAlphaDepthOutputNode(map, alphaTest)();

      this.alphaDepthMaterials.set(key, mat);
    }

    return this.alphaDepthMaterials.get(key)!;
  }

  /**
   * Get or create a transparent depth material that writes straight through
   * (no blend) to its own target. Outputs depth to B and opacity to A.
   */
  private getTransparentDepthMaterial(
    opacity: number,
  ): THREE.MeshBasicNodeMaterial {
    // Quantize opacity to reduce material variants
    const quantized = Math.round(opacity * 100) / 100;
    const key = `${quantized}`;

    if (!this.transparentDepthMaterials.has(key)) {
      const mat = new THREE.MeshBasicNodeMaterial();
      mat.side = THREE.DoubleSide;
      mat.colorNode = createTransparentDepthOutputNode(quantized)();

      // Dedicated target: write depth/alpha straight through (no blend, so it is
      // WebGL-safe — MIN blending is unsupported there). The target has no depth
      // buffer; occlusion against opaques is resolved in the consumer, which
      // compares the transparent depth against the opaque depth it already reads.
      mat.blending = THREE.NoBlending;
      mat.depthWrite = false;
      mat.depthTest = false;

      this.transparentDepthMaterials.set(key, mat);
    }

    return this.transparentDepthMaterials.get(key)!;
  }

  /**
   * Update the camera used for depth rendering.
   */
  public setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  /**
   * Add an object to be excluded from depth rendering (e.g., the water surface)
   */
  public excludeObject(object: THREE.Object3D) {
    this.excludedObjects.add(object);
  }

  /**
   * Remove an object from the exclusion list
   */
  public includeObject(object: THREE.Object3D) {
    this.excludedObjects.delete(object);
  }

  /**
   * Clear all excluded objects
   */
  public clearExcludedObjects() {
    this.excludedObjects.clear();
  }

  /**
   * Get the depth texture for use in other materials
   */
  public getDepthTexture(): THREE.Texture {
    return this.renderTarget.texture;
  }

  /**
   * Get the transparent object color texture (premultiplied alpha in RGB).
   * Standard alpha blending over black yields RGB = alpha * objectColor.
   */
  public getTransparentColorTexture(): THREE.Texture {
    return this.transparentColorTarget.texture;
  }

  /**
   * Get the transparent object depth/alpha texture (B = depth, A = opacity),
   * written to its own target so no MIN blend is needed.
   */
  public getTransparentDepthTexture(): THREE.Texture {
    return this.transparentDepthTarget.texture;
  }

  /**
   * Get camera near plane value
   */
  public getCameraNear(): number {
    return this.camera.near;
  }

  /**
   * Get camera far plane value
   */
  public getCameraFar(): number {
    return this.camera.far;
  }

  /**
   * Resize the depth render target.
   * Old render target is not explicitly disposed - it will be garbage collected.
   * This avoids "destroyed texture used in submit" errors from in-flight GPU work.
   */
  public setSize(width: number, height: number) {
    this.renderTarget = new THREE.RenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
    this.transparentColorTarget = new THREE.RenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
    this.transparentDepthTarget = new THREE.RenderTarget(width, height, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
    });
  }

  /**
   * Render the scene depth in three passes:
   * 1. Opaque/alpha-tested objects → main target R (depth); G is unused.
   * 2. Transparent objects → the dedicated transparent-depth target B (depth),
   *    A (opacity), no blend; occlusion against opaques is resolved in consumers.
   * 3. Transparent objects' premultiplied colour + per-pixel alpha → the
   *    transparent-colour target, consumed by both fog passes.
   */
  public render(renderer: THREE.WebGPURenderer) {
    // Store and hide excluded objects
    for (const obj of this.excludedObjects) {
      this.originalVisibility.set(obj, obj.visible);
      obj.visible = false;
    }

    // Store original state
    const originalRenderTarget = renderer.getRenderTarget();
    const originalBackground = this.scene.background;
    const originalAutoClear = renderer.autoClear;

    // Collect transparent meshes for the second pass
    const transparentMeshes: Array<{
      mesh: THREE.Mesh;
      opacity: number;
    }> = [];

    // Pass 1: Swap materials for all visible opaque meshes
    this.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || !obj.visible) return;
      if (this.excludedObjects.has(obj)) return;

      const materials = Array.isArray(obj.material)
        ? obj.material
        : [obj.material];

      // Identify alpha-blended transparent objects for the second pass.
      // Alpha-tested materials (alphaTest > 0) are handled in the opaque pass.
      const isAlphaBlended = materials.every((mat) => {
        const stdMat = mat as THREE.MeshStandardMaterial;
        return stdMat.transparent && !(stdMat.alphaTest > 0);
      });

      if (isAlphaBlended) {
        // Hide for opaque pass, collect for transparent pass
        this.originalVisibility.set(obj, obj.visible);
        obj.visible = false;

        // Extract opacity from the first material
        const firstMat = materials[0] as THREE.MeshStandardMaterial;
        const opacity = firstMat.opacity ?? 0.5;
        transparentMeshes.push({ mesh: obj, opacity });
        return;
      }

      this.originalMaterials.set(obj, obj.material);

      const depthMaterials: THREE.Material[] = [];
      for (const mat of materials) {
        const stdMat = mat as THREE.MeshStandardMaterial;
        if (stdMat.map && stdMat.alphaTest > 0) {
          depthMaterials.push(
            this.getAlphaDepthMaterial(stdMat.map, stdMat.alphaTest),
          );
        } else if (stdMat.alphaMap && stdMat.alphaTest > 0) {
          depthMaterials.push(
            this.getAlphaDepthMaterial(stdMat.alphaMap, stdMat.alphaTest),
          );
        } else {
          depthMaterials.push(this.depthMaterial);
        }
      }

      obj.material = Array.isArray(obj.material)
        ? depthMaterials
        : depthMaterials[0];
    });

    // Background: R=1 (far depth), G=0, B=1, A=1
    this.scene.background = new THREE.Color(1, 0, 1);

    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    // Restore opaque materials
    for (const [mesh, material] of this.originalMaterials) {
      mesh.material = material;
    }
    this.originalMaterials.clear();

    // The transparent-depth target is its own buffer (not reset by the opaque
    // pass), so sentinel-clear it every frame — B=1 ("no transparent"), A=1 — so
    // a frame with no transparent objects reads clean rather than stale.
    renderer.autoClear = false;
    renderer.setRenderTarget(this.transparentDepthTarget);
    renderer.setClearColor(0x0000ff, 1);
    renderer.clear();

    // Pass 2 & 3: transparent depth, then premultiplied colour.
    if (transparentMeshes.length > 0) {
      // Hide all opaque meshes, show only transparent ones
      const opaqueVisibility: Map<THREE.Object3D, boolean> = new Map();
      this.scene.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh) || this.excludedObjects.has(obj)) {
          return;
        }
        if (obj.visible) {
          opaqueVisibility.set(obj, true);
          obj.visible = false;
        }
      });

      for (const { mesh } of transparentMeshes) {
        mesh.visible = true;
      }

      this.scene.background = null;

      // Pass 2: transparent depth (B) + alpha (A) onto the cleared dedicated
      // target. No MIN blend → WebGL-safe.
      for (const { mesh, opacity } of transparentMeshes) {
        this.originalMaterials.set(mesh, mesh.material);
        mesh.material = this.getTransparentDepthMaterial(opacity);
      }
      renderer.setRenderTarget(this.transparentDepthTarget);
      renderer.render(this.scene, this.camera);

      // Restore original materials for Pass 3
      for (const [mesh, material] of this.originalMaterials) {
        mesh.material = material;
      }
      this.originalMaterials.clear();

      // Pass 3: transparent objects' premultiplied colour (RGB) + true per-pixel
      // alpha (A). Consumed by both fog passes — the underwater decomposition and
      // the above-water own-depth fog — so it always runs when transparent
      // objects are present.
      renderer.setRenderTarget(this.transparentColorTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(this.scene, this.camera);

      // Restore opaque visibility
      for (const [obj] of opaqueVisibility) {
        obj.visible = true;
      }
    }

    // The sentinel clear used a non-zero clear colour; normalise to transparent
    // black so it can't leak into a later pass that clears.
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = originalAutoClear;

    renderer.setRenderTarget(originalRenderTarget);

    // Restore background
    this.scene.background = originalBackground;

    // Restore visibility of excluded and transparent objects
    for (const [obj, visible] of this.originalVisibility) {
      obj.visible = visible;
    }
    this.originalVisibility.clear();
  }

  /**
   * Dispose of resources
   */
  public dispose() {
    this.renderTarget.dispose();
    this.transparentColorTarget.dispose();
    this.transparentDepthTarget.dispose();
    this.depthMaterial.dispose();
    for (const mat of this.alphaDepthMaterials.values()) {
      mat.dispose();
    }
    this.alphaDepthMaterials.clear();
    for (const mat of this.transparentDepthMaterials.values()) {
      mat.dispose();
    }
    this.transparentDepthMaterials.clear();
  }
}
