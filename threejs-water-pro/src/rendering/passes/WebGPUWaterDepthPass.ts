// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import {
  Fn,
  float,
  frontFacing,
  positionView,
  cameraNear,
  cameraFar,
  vec4,
  uniform,
  texture,
} from "three/tsl";
import type { Node, UniformNode } from "three/webgpu";
import type { IWaterDepthPass } from "./IWaterDepthPass";

/**
 * Water-depth pre-pass for the WebGPU backend.
 *
 * Renders the water mesh once — double-sided, no depth test — with
 * MIN blending. A single RGBA render target encodes all four depth
 * channels per pixel:
 *
 *   R = unclipped depth (any face)
 *   G = clippedAny depth (behind clip, any face)
 *   B = clippedFront depth (behind clip, front-facing)
 *   A = unclippedFront depth (front-facing, ignoring clip)
 *
 * MIN blending across all fragments at a pixel keeps the closest value
 * per channel without needing a depth test. Consumers call the
 * `sampleX(uv)` methods to get TSL nodes; they receive the correct
 * channel swizzle automatically.
 */
export class WebGPUWaterDepthPass implements IWaterDepthPass {
  private _camera: THREE.PerspectiveCamera;
  private _clipDistanceUniform: UniformNode<number>;
  private _waterObject: THREE.Object3D | null = null;

  private _combinedTarget: THREE.RenderTarget;
  private _combinedMaterial: THREE.MeshBasicNodeMaterial;
  private _combinedTexNode: ReturnType<typeof texture>;

  private _tempScene = new THREE.Scene();

  constructor(
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    clipDistanceUniform?: UniformNode<number>,
  ) {
    this._camera = camera;
    this._clipDistanceUniform = clipDistanceUniform ?? uniform(0.5);

    this._combinedTarget = createRenderTarget(width, height);
    this._combinedTexNode = texture(this._combinedTarget.texture);

    this._combinedMaterial = new THREE.MeshBasicNodeMaterial();
    this._combinedMaterial.side = THREE.DoubleSide;
    this._combinedMaterial.colorNode = createCombinedDepthNode(
      this._clipDistanceUniform,
    );

    // MIN blending across every fragment that rasterizes to a pixel,
    // separately per channel. R/G/B/A end up as min over each channel's
    // contributing fragments.
    this._combinedMaterial.blending = THREE.CustomBlending;
    this._combinedMaterial.blendEquation = THREE.MinEquation;
    this._combinedMaterial.blendSrc = THREE.OneFactor;
    this._combinedMaterial.blendDst = THREE.OneFactor;

    // Without depth test all fragments contribute; with MIN blending we
    // still get the closest one per channel. With depth test enabled,
    // far fragments would be culled before they could contribute their
    // own channel's min (e.g. a closer front-face fragment would discard
    // a farther back-face fragment that would otherwise update R/G).
    this._combinedMaterial.depthTest = false;
    this._combinedMaterial.depthWrite = false;

    // Clear to (1, 1, 1, 1) — max depth, no water present.
    this._tempScene.background = new THREE.Color(1, 1, 1);
  }

  // ============= TSL Sample Builders =============

  sampleUnclippedDepth(uvNode: Node): Node {
    return this._combinedTexNode.sample(uvNode).x;
  }

  sampleUnclippedFrontDepth(uvNode: Node): Node {
    return this._combinedTexNode.sample(uvNode).w;
  }

  sampleClippedAnyDepth(uvNode: Node): Node {
    return this._combinedTexNode.sample(uvNode).y;
  }

  sampleClippedFrontDepth(uvNode: Node): Node {
    return this._combinedTexNode.sample(uvNode).z;
  }

  // ============= Configuration =============

  setWaterObject(obj: THREE.Object3D): void {
    this._waterObject = obj;
  }

  setPositionNode(node: Node): void {
    this._combinedMaterial.positionNode = node;
    this._combinedMaterial.needsUpdate = true;
  }

  setClipDistanceUniform(clipDistanceUniform: UniformNode<number>): void {
    this._clipDistanceUniform = clipDistanceUniform;
    this._combinedMaterial.colorNode = createCombinedDepthNode(
      this._clipDistanceUniform,
    );
    this._combinedMaterial.needsUpdate = true;
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this._camera = camera;
  }

  setSize(width: number, height: number): void {
    this._combinedTarget = createRenderTarget(width, height);
    this._combinedTexNode.value = this._combinedTarget.texture;
  }

  // ============= Render =============

  render(renderer: THREE.WebGPURenderer): void {
    if (!this._waterObject) return;

    const originalRenderTarget = renderer.getRenderTarget();

    const meshes: {
      mesh: THREE.Mesh;
      original: THREE.Material | THREE.Material[];
    }[] = [];
    this._waterObject.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        meshes.push({ mesh: obj, original: obj.material });
      }
    });

    const savedParent = this._waterObject.parent;
    this._tempScene.add(this._waterObject);

    for (const { mesh } of meshes) {
      mesh.material = this._combinedMaterial;
    }
    renderer.setRenderTarget(this._combinedTarget);
    renderer.clear();
    renderer.render(this._tempScene, this._camera);

    renderer.setRenderTarget(originalRenderTarget);

    this._tempScene.remove(this._waterObject);
    if (savedParent) {
      savedParent.add(this._waterObject);
    }

    for (const { mesh, original } of meshes) {
      mesh.material = original;
    }
  }

  dispose(): void {
    this._combinedTarget.dispose();
    this._combinedMaterial.dispose();
  }
}

// ============= Render target factory =============

function createRenderTarget(width: number, height: number): THREE.RenderTarget {
  return new THREE.RenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: false,
  });
}

// ============= Shader builder =============

/**
 * Single-draw combined depth output for MIN-blending.
 *
 *   R = depth — every fragment writes its own depth.
 *   G = depth if behind clip, else 1.0 — fragments in front of clip
 *       contribute 1.0, so after MIN the channel keeps the min behind-
 *       clip depth.
 *   B = depth if behind clip AND front-facing, else 1.0.
 *   A = depth if front-facing, else 1.0 — closest front-facing fragment
 *       regardless of clip, used to derive per-pixel camera-side from
 *       `A ≈ R` (front) vs `A > R` (back).
 */
function createCombinedDepthNode(
  clipDistanceUniform: UniformNode<number>,
): Node {
  return Fn(() => {
    const viewZ = positionView.z.negate();
    const depthRange = cameraFar.sub(cameraNear);
    const normalizedDepth = viewZ.sub(cameraNear).div(depthRange);
    const behindClip = viewZ.greaterThanEqual(clipDistanceUniform);

    const r = normalizedDepth;
    const g = behindClip.select(normalizedDepth, float(1.0));
    const b = behindClip
      .and(frontFacing)
      .select(normalizedDepth, float(1.0));
    const a = frontFacing.select(normalizedDepth, float(1.0));
    return vec4(r, g, b, a);
  })();
}
