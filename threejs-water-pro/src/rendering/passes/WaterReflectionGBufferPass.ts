// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * WaterReflectionGBufferPass renders the water surface at full resolution,
 * outputting `vec4(reflectDirWS.xyz, viewZ)` so the SSR ray-march pass can
 * reconstruct view-space ray origins and reflection directions without having
 * access to the water material's varyings.
 *
 * The G-buffer always runs at full resolution so the reflection direction
 * stays anti-aliased at distant grazing angles; only the SSR march resolution
 * scales.
 */
import * as THREE from "three/webgpu";
import {
  Fn,
  cameraPosition,
  float,
  normalize,
  positionView,
  positionWorld,
  reflect,
  vec4,
} from "three/tsl";
import type { Node, UniformNode } from "three/webgpu";
import type { IWaveSimulation } from "../../simulation/waves";
import type { RainRipples } from "../../simulation/ripples";
import {
  buildWaterVertexDisplacement,
  buildWaterSurfaceNormal,
  type CascadeSampler,
  type Fresnel,
} from "../../shaders";

export interface WaterReflectionGBufferPassOptions {
  cascadeSampler: CascadeSampler | null;
  clipmapOffset: UniformNode<THREE.Vector2>;
  fresnel: Fresnel;
  oceanSim: IWaveSimulation;
  rainRipples: RainRipples | null;
}

function createRenderTarget(width: number, height: number): THREE.RenderTarget {
  return new THREE.RenderTarget(width, height, {
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
  });
}

/**
 * Renders the water mesh at full resolution into a G-buffer storing the
 * world-space reflection direction (RGB) and view-space depth (A).
 */
export class WaterReflectionGBufferPass {
  private renderTarget: THREE.RenderTarget;
  private material: THREE.MeshBasicNodeMaterial;
  private camera: THREE.PerspectiveCamera;
  private waterObject: THREE.Object3D | null = null;
  private savedParent: THREE.Object3D | null = null;
  private options: WaterReflectionGBufferPassOptions;

  private tempScene = new THREE.Scene();

  constructor(
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    options: WaterReflectionGBufferPassOptions,
  ) {
    this.camera = camera;
    this.options = options;
    this.renderTarget = createRenderTarget(width, height);

    this.material = new THREE.MeshBasicNodeMaterial();
    this.material.side = THREE.FrontSide;
    this.material.blending = THREE.NoBlending;
    this.buildShaderGraph();
  }

  /** Set the water mesh to render. */
  public setWaterObject(obj: THREE.Object3D): void {
    this.waterObject = obj;
  }

  /** Update the camera. */
  public setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  /** Get the G-buffer texture (vec4(reflectDirWS, viewZ)). */
  public getTexture(): THREE.Texture {
    return this.renderTarget.texture;
  }

  /** Resize the render target. */
  public setSize(width: number, height: number): void {
    this.renderTarget = createRenderTarget(width, height);
  }

  /**
   * Rebuild the shader graph after a quality-level change swapped any of the
   * inputs (cascade sampler, rainRipples, etc.).
   */
  public rebuild(options: WaterReflectionGBufferPassOptions): void {
    this.options = options;
    this.buildShaderGraph();
  }

  /** Render the water mesh into the G-buffer. */
  public render(renderer: THREE.WebGPURenderer): void {
    if (!this.waterObject) return;

    const originalRenderTarget = renderer.getRenderTarget();
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.setClearAlpha(0);

    const meshes: {
      mesh: THREE.Mesh;
      original: THREE.Material | THREE.Material[];
    }[] = [];
    this.waterObject.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        meshes.push({ mesh: obj, original: obj.material });
      }
    });

    this.savedParent = this.waterObject.parent;
    this.tempScene.add(this.waterObject);

    for (const { mesh } of meshes) {
      mesh.material = this.material;
    }
    renderer.setRenderTarget(this.renderTarget);
    renderer.clear();
    renderer.render(this.tempScene, this.camera);
    renderer.setRenderTarget(originalRenderTarget);
    renderer.setClearAlpha(prevClearAlpha);

    this.tempScene.remove(this.waterObject);
    if (this.savedParent) {
      this.savedParent.add(this.waterObject);
    }
    this.savedParent = null;

    for (const { mesh, original } of meshes) {
      mesh.material = original;
    }
  }

  public dispose(): void {
    this.renderTarget.dispose();
    this.material.dispose();
  }

  private buildShaderGraph(): void {
    const {
      oceanSim,
      cascadeSampler,
      fresnel,
      rainRipples,
      clipmapOffset,
    } = this.options;

    const vertex = buildWaterVertexDisplacement({
      clipmapOffset,
      oceanSim,
      cascadeSampler,
      wakeFieldSampler: null,
    });
    this.material.positionNode = vertex.positionNode;

    // NodeMaterial.colorNode clamps RGB ≥0; the reflection direction can be
    // negative on any axis, so this writes through fragmentNode instead.
    const fragNode: Node = Fn(() => {
      const fragWorldX = vertex.vSampleCoords.x;
      const fragWorldZ = vertex.vSampleCoords.y;

      const viewDir = normalize(cameraPosition.sub(positionWorld));

      const normalResult = buildWaterSurfaceNormal({
        oceanSim,
        cascadeSampler,
        fragWorldX,
        fragWorldZ,
        wakeWorldX: positionWorld.x,
        wakeWorldZ: positionWorld.z,
        vHierarchicalCoords: vertex.vHierarchicalCoords,
        rainRipples,
        wakeFieldSampler: null,
        cameraPosition,
        frontFaceMultiplier: float(1.0),
      });

      const fresnelResult = fresnel.build({
        viewDir,
        interpolatedNormal: normalResult.interpolatedNormal,
        slopeVariance: normalResult.slopeVariance,
        worldX: vertex.worldX,
        worldZ: vertex.worldZ,
      });

      // Bent reflection normal: keeps grazing-angle rays from firing
      // downward into the water when the wave normal tilts past edge-on.
      const reflectDirWS: Node = reflect(
        viewDir.negate(),
        fresnelResult.reflectionNormal,
      );

      const viewZ: Node = positionView.z.negate();

      return vec4(reflectDirWS, viewZ);
    })();

    this.material.fragmentNode = fragNode;
    this.material.needsUpdate = true;
  }
}
