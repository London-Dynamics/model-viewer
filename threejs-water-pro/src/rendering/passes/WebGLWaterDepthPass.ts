// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import {
  Discard,
  Fn,
  float,
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
 * Water-depth pre-pass for the WebGL backend.
 *
 * MIN blending is unreliable on WebGL, so this renders four separate
 * draw calls into four render targets — one per depth channel. Standard
 * depth testing keeps the closest fragment per draw.
 *
 *   _frontTarget        — clippedFront: behind-clip, front-facing  (R)
 *   _backTarget         — clippedBack:  behind-clip, back-facing   (R)
 *   _unclippedTarget    — unclipped:    any face, no clip          (R)
 *   _unclippedFrontTarget — unclippedFront: front-facing, no clip  (R)
 *
 * `sampleClippedAnyDepth` derives the min of front and back on the CPU
 * side by combining the two nodes; no extra pass is needed.
 *
 * Consumers call the `sampleX(uv)` methods to get TSL nodes; the
 * four-pass detail stays hidden behind the interface.
 */
export class WebGLWaterDepthPass implements IWaterDepthPass {
  private _camera: THREE.PerspectiveCamera;
  private _clipDistanceUniform: UniformNode<number>;
  private _waterObject: THREE.Object3D | null = null;

  private _frontTarget: THREE.RenderTarget;
  private _backTarget: THREE.RenderTarget;
  private _unclippedTarget: THREE.RenderTarget;
  private _unclippedFrontTarget: THREE.RenderTarget;

  private _frontMaterial: THREE.MeshBasicNodeMaterial;
  private _backMaterial: THREE.MeshBasicNodeMaterial;
  private _unclippedMaterial: THREE.MeshBasicNodeMaterial;
  private _unclippedFrontMaterial: THREE.MeshBasicNodeMaterial;

  private _frontTexNode: ReturnType<typeof texture>;
  private _backTexNode: ReturnType<typeof texture>;
  private _unclippedTexNode: ReturnType<typeof texture>;
  private _unclippedFrontTexNode: ReturnType<typeof texture>;

  private _tempScene = new THREE.Scene();

  constructor(
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    clipDistanceUniform?: UniformNode<number>,
  ) {
    this._camera = camera;
    this._clipDistanceUniform = clipDistanceUniform ?? uniform(0.5);

    this._frontTarget = createRenderTarget(width, height);
    this._backTarget = createRenderTarget(width, height);
    this._unclippedTarget = createRenderTarget(width, height);
    this._unclippedFrontTarget = createRenderTarget(width, height);

    this._frontTexNode = texture(this._frontTarget.texture);
    this._backTexNode = texture(this._backTarget.texture);
    this._unclippedTexNode = texture(this._unclippedTarget.texture);
    this._unclippedFrontTexNode = texture(this._unclippedFrontTarget.texture);

    const clipped = createClippedDepthNode(this._clipDistanceUniform);
    const unclipped = createUnclippedDepthNode();

    this._frontMaterial = new THREE.MeshBasicNodeMaterial();
    this._frontMaterial.side = THREE.FrontSide;
    this._frontMaterial.colorNode = clipped;

    this._backMaterial = new THREE.MeshBasicNodeMaterial();
    this._backMaterial.side = THREE.BackSide;
    this._backMaterial.colorNode = clipped;

    this._unclippedMaterial = new THREE.MeshBasicNodeMaterial();
    this._unclippedMaterial.side = THREE.DoubleSide;
    this._unclippedMaterial.colorNode = unclipped;

    // Front-facing only, no Discard. Gives us the closest *front-facing*
    // water-mesh hit regardless of the clip plane, so the post-pass can
    // compare against `unclipped` to determine the camera's side of the
    // surface at each pixel without consulting any global flag.
    this._unclippedFrontMaterial = new THREE.MeshBasicNodeMaterial();
    this._unclippedFrontMaterial.side = THREE.FrontSide;
    this._unclippedFrontMaterial.colorNode = unclipped;

    // Clear to (1, 1, 1, 1) — max depth, no water present.
    this._tempScene.background = new THREE.Color(1, 1, 1);
  }

  // ============= TSL Sample Builders =============

  sampleUnclippedDepth(uvNode: Node): Node {
    return this._unclippedTexNode.sample(uvNode).x;
  }

  sampleUnclippedFrontDepth(uvNode: Node): Node {
    return this._unclippedFrontTexNode.sample(uvNode).x;
  }

  sampleClippedAnyDepth(uvNode: Node): Node {
    return this._frontTexNode.sample(uvNode).x.min(
      this._backTexNode.sample(uvNode).x,
    );
  }

  sampleClippedFrontDepth(uvNode: Node): Node {
    return this._frontTexNode.sample(uvNode).x;
  }

  // ============= Configuration =============

  setWaterObject(obj: THREE.Object3D): void {
    this._waterObject = obj;
  }

  setPositionNode(node: Node): void {
    this._frontMaterial.positionNode = node;
    this._backMaterial.positionNode = node;
    this._unclippedMaterial.positionNode = node;
    this._unclippedFrontMaterial.positionNode = node;
    this._frontMaterial.needsUpdate = true;
    this._backMaterial.needsUpdate = true;
    this._unclippedMaterial.needsUpdate = true;
    this._unclippedFrontMaterial.needsUpdate = true;
  }

  setClipDistanceUniform(clipDistanceUniform: UniformNode<number>): void {
    this._clipDistanceUniform = clipDistanceUniform;
    const clipped = createClippedDepthNode(this._clipDistanceUniform);
    this._frontMaterial.colorNode = clipped;
    this._backMaterial.colorNode = clipped;
    this._frontMaterial.needsUpdate = true;
    this._backMaterial.needsUpdate = true;
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this._camera = camera;
  }

  setSize(width: number, height: number): void {
    this._frontTarget = createRenderTarget(width, height);
    this._backTarget = createRenderTarget(width, height);
    this._unclippedTarget = createRenderTarget(width, height);
    this._unclippedFrontTarget = createRenderTarget(width, height);
    this._frontTexNode.value = this._frontTarget.texture;
    this._backTexNode.value = this._backTarget.texture;
    this._unclippedTexNode.value = this._unclippedTarget.texture;
    this._unclippedFrontTexNode.value = this._unclippedFrontTarget.texture;
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

    // Pass 1: front-face clipped depth.
    for (const { mesh } of meshes) {
      mesh.material = this._frontMaterial;
    }
    renderer.setRenderTarget(this._frontTarget);
    renderer.clear();
    renderer.render(this._tempScene, this._camera);

    // Pass 2: back-face clipped depth.
    for (const { mesh } of meshes) {
      mesh.material = this._backMaterial;
    }
    renderer.setRenderTarget(this._backTarget);
    renderer.clear();
    renderer.render(this._tempScene, this._camera);

    // Pass 3: unclipped depth (any face, no Discard) — closest water
    // hit ignoring the clip plane. Drives the post-pass column.
    for (const { mesh } of meshes) {
      mesh.material = this._unclippedMaterial;
    }
    renderer.setRenderTarget(this._unclippedTarget);
    renderer.clear();
    renderer.render(this._tempScene, this._camera);

    // Pass 4: unclipped front-face depth — closest front-facing hit,
    // again ignoring the clip plane. Compared against Pass 3 per pixel
    // in the post-pass to derive camera-side.
    for (const { mesh } of meshes) {
      mesh.material = this._unclippedFrontMaterial;
    }
    renderer.setRenderTarget(this._unclippedFrontTarget);
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
    this._frontTarget.dispose();
    this._backTarget.dispose();
    this._unclippedTarget.dispose();
    this._unclippedFrontTarget.dispose();
    this._frontMaterial.dispose();
    this._backMaterial.dispose();
    this._unclippedMaterial.dispose();
    this._unclippedFrontMaterial.dispose();
  }
}

// ============= Render target factory =============

function createRenderTarget(width: number, height: number): THREE.RenderTarget {
  return new THREE.RenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
  });
}

// ============= Shader builders =============

/**
 * Clipped depth output. Fragments closer than the clip plane are
 * discarded; everything else writes its normalized depth in R.
 */
function createClippedDepthNode(
  clipDistanceUniform: UniformNode<number>,
): Node {
  return Fn(() => {
    const viewZ = positionView.z.negate();
    const depthRange = cameraFar.sub(cameraNear);
    const normalizedDepth = viewZ.sub(cameraNear).div(depthRange);
    Discard(viewZ.lessThan(clipDistanceUniform));
    return vec4(normalizedDepth, float(0.0), float(0.0), float(1.0));
  })();
}

/**
 * Unclipped depth output. Every fragment writes its normalized depth in
 * R; the standard depth test keeps the closest one.
 */
function createUnclippedDepthNode(): Node {
  return Fn(() => {
    const viewZ = positionView.z.negate();
    const depthRange = cameraFar.sub(cameraNear);
    const normalizedDepth = viewZ.sub(cameraNear).div(depthRange);
    return vec4(normalizedDepth, float(0.0), float(0.0), float(1.0));
  })();
}
