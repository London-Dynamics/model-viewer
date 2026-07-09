import * as THREE from "three/webgpu";
import {
  attribute,
  cameraPosition,
  Discard,
  dot,
  float,
  Fn,
  length,
  mix,
  positionWorld,
  screenUV,
  smoothstep,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import type { TSLUniformNode } from "../../types/tsl";
import type { IWaterDepthPass } from "../../rendering/passes/IWaterDepthPass";
import type { RenderPassManager } from "../../rendering/RenderPassManager";
import type { WaterSubsystem } from "../types";
import { PARTICLE_DEFAULTS, type ParticleParams } from "./types";

/** Internal options for clip plane uniforms (shared with water material). */
export interface ParticlesInternalOptions {
  clipDistance: TSLUniformNode;
  cameraForward: TSLUniformNode;
}

/**
 * UnderwaterParticles - Ambient particle system for underwater scenes.
 *
 * Renders small particles (sediment, plankton, dust) in a spherical shell
 * around the camera. Particles are static in world space — apparent
 * movement comes from underwater distortion.
 *
 * Visibility is per-fragment, not per-camera-state: the opacity node
 * fades each fragment to zero above the sea level so particles that
 * happen to be above water (a particle's world Y exceeded sea level
 * because it spawned high or the camera moved up) disappear smoothly
 * without any global submersion switch. The pass therefore always runs;
 * fragments that fall above water just discard themselves.
 *
 * Features:
 * - World-space positioning (particles stay in place as camera moves)
 * - Uniform distribution within spherical shell (nearDistance to farDistance)
 * - Distance-based opacity fade (fade out toward far distance)
 * - Circular particle shapes (soft falloff)
 * - Per-fragment waterline fade (no `cameraSubmerged` dependency)
 * - Size variation per particle
 *
 * Uses SpriteNodeMaterial for WebGPU compatibility.
 */
export class UnderwaterParticles implements WaterSubsystem {
  private mesh: THREE.Mesh;
  private geometry: THREE.InstancedBufferGeometry;
  private material: THREE.SpriteNodeMaterial;

  // Instance data (world-space positions, per-instance alpha, per-instance size)
  private positions: Float32Array;
  private alphas: Float32Array;
  private sizes: Float32Array;
  private positionAttr: THREE.InstancedBufferAttribute;
  private alphaAttr: THREE.InstancedBufferAttribute;
  private sizeAttr: THREE.InstancedBufferAttribute;

  // Uniforms
  private minSizeUniform = uniform(0.1);
  private maxSizeUniform = uniform(0.5);
  private colorUniform = uniform(new THREE.Color("#a0c8d0"));
  private opacityUniform = uniform(0.6);

  // Clip plane uniforms (shared with water material)
  private clipDistanceUniform: TSLUniformNode | null = null;
  private cameraForwardUniform: TSLUniformNode | null = null;

  // Water depth pass for per-pixel underwater masking
  private _waterDepthPass: IWaterDepthPass | null = null;

  // Configuration
  private maxParticles: number;
  private activeCount: number;
  private nearDistance: number;
  private farDistance: number;

  private _enabled: boolean;
  private _initialized = false;

  constructor(
    params?: Partial<ParticleParams>,
    internalOptions?: ParticlesInternalOptions,
  ) {
    const config = { ...PARTICLE_DEFAULTS, ...params };

    // Store clip plane uniform references (shared with water material)
    if (internalOptions) {
      this.clipDistanceUniform = internalOptions.clipDistance;
      this.cameraForwardUniform = internalOptions.cameraForward;
    }

    this.maxParticles = config.count;
    this.activeCount = config.count;
    this.nearDistance = config.nearDistance;
    this.farDistance = config.farDistance;
    this._enabled = config.enabled;

    // Set uniform values
    this.minSizeUniform.value = config.minSize;
    this.maxSizeUniform.value = config.maxSize;
    this.colorUniform.value.set(config.color);
    this.opacityUniform.value = config.opacity;

    // Allocate instance data
    this.positions = new Float32Array(this.maxParticles * 3);
    this.alphas = new Float32Array(this.maxParticles);
    this.sizes = new Float32Array(this.maxParticles);

    // Initialize alphas to 0 (invisible until properly spawned)
    this.alphas.fill(0.0);
    // Initialize sizes with random 0-1 values (interpolates between min/max in shader)
    for (let i = 0; i < this.maxParticles; i++) {
      this.sizes[i] = Math.random();
    }

    // Create instanced geometry from plane
    const baseGeometry = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = baseGeometry.index;
    this.geometry.attributes.position = baseGeometry.attributes.position;
    this.geometry.attributes.uv = baseGeometry.attributes.uv;

    this.positionAttr = new THREE.InstancedBufferAttribute(this.positions, 3);
    this.positionAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("particlePosition", this.positionAttr);

    this.alphaAttr = new THREE.InstancedBufferAttribute(this.alphas, 1);
    this.alphaAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute("particleAlpha", this.alphaAttr);

    this.sizeAttr = new THREE.InstancedBufferAttribute(this.sizes, 1);
    this.sizeAttr.setUsage(THREE.StaticDrawUsage);
    this.geometry.setAttribute("particleSize", this.sizeAttr);

    this.geometry.instanceCount = this.activeCount;

    // Create material using SpriteNodeMaterial
    this.material = this.createMaterial();

    // Create mesh
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = this._enabled;
  }

  private _buildOpacityNode() {
    const opacityU = this.opacityUniform;
    const clipDistanceU = this.clipDistanceUniform;
    const cameraForwardU = this.cameraForwardUniform;
    const waterDepthPass = this._waterDepthPass;

    return Fn(() => {
      // Clip particles in the surface-material's near-camera "hole" so
      // sprites don't draw in front of the water surface when the
      // camera is partially submerged.
      if (clipDistanceU && cameraForwardU) {
        const camToFrag = positionWorld.sub(cameraPosition);
        const depthAlongView = dot(camToFrag, cameraForwardU);
        Discard(depthAlongView.lessThan(clipDistanceU));
      }

      // Per-pixel underwater detection: discard fragments that are not
      // classified as underwater. A pixel is underwater when the closest
      // behind-clip fragment is a back face (clippedAny < clippedFront),
      // matching the classification used by the Underwater post-pass.
      if (waterDepthPass) {
        const clippedFront = waterDepthPass.sampleClippedFrontDepth(screenUV);
        const clippedAny = waterDepthPass.sampleClippedAnyDepth(screenUV);
        Discard(clippedAny.greaterThanEqual(clippedFront));
      }

      // Per-fragment waterline fade for particles near the surface boundary.
      const waterlineFade = smoothstep(float(0.0), float(-0.2), positionWorld.y);

      const uvCoord = uv();
      const centeredUV = uvCoord.sub(0.5).mul(2.0);
      const dist = length(centeredUV);
      const circleFalloff = smoothstep(1.0, 0.5, dist);

      const instanceAlpha = attribute("particleAlpha");

      return opacityU.mul(circleFalloff).mul(instanceAlpha).mul(waterlineFade);
    })();
  }

  private createMaterial(): THREE.SpriteNodeMaterial {
    const minSizeU = this.minSizeUniform;
    const maxSizeU = this.maxSizeUniform;
    const colorU = this.colorUniform;

    const positionNode = Fn(() => {
      const pos = attribute("particlePosition");
      return vec3(pos.x, pos.y, pos.z);
    })();

    const scaleNode = Fn(() => {
      const sizeFactor = attribute("particleSize");
      return mix(minSizeU, maxSizeU, sizeFactor);
    })();

    const colorNode = Fn(() => {
      return vec3(colorU);
    })();

    const material = new THREE.SpriteNodeMaterial();
    material.positionNode = positionNode;
    material.scaleNode = scaleNode;
    material.colorNode = colorNode;
    material.opacityNode = this._buildOpacityNode();
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = true;

    return material;
  }

  /** {@link WaterSubsystem} hook — delegates to {@link bindWaterDepthPass}. */
  bindDepthTextures(rp: RenderPassManager): void {
    this.bindWaterDepthPass(rp.waterDepth);
  }

  /**
   * Wire the water depth pass for per-pixel underwater masking. Particles
   * are discarded at pixels not classified as underwater (clippedAny >= clippedFront),
   * preventing them from rendering through the water surface when viewed from above.
   */
  bindWaterDepthPass(pass: IWaterDepthPass): void {
    this._waterDepthPass = pass;
    this.material.opacityNode = this._buildOpacityNode();
    this.material.needsUpdate = true;
  }

  /**
   * Spawn a particle at a random position uniformly distributed within a spherical
   * shell around the camera, constrained to be below the water surface (y < 0).
   * Returns true if successfully spawned, false if no valid position found.
   */
  private spawnParticle(index: number, camera: THREE.Camera): boolean {
    const i3 = index * 3;

    // Try to spawn a valid underwater particle (max attempts to avoid infinite loop)
    for (let attempt = 0; attempt < 20; attempt++) {
      // Generate uniform random direction on unit sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const dirX = Math.sin(phi) * Math.cos(theta);
      const dirY = Math.sin(phi) * Math.sin(theta);
      const dirZ = Math.cos(phi);

      // Generate random radius with uniform volume distribution in spherical shell
      const nearCubed = this.nearDistance ** 3;
      const farCubed = this.farDistance ** 3;
      const radius = Math.cbrt(
        nearCubed + Math.random() * (farCubed - nearCubed),
      );

      // Calculate world position
      const x = camera.position.x + dirX * radius;
      const y = camera.position.y + dirY * radius;
      const z = camera.position.z + dirZ * radius;

      // Only accept if below water surface (with margin for waves)
      if (y < -0.5) {
        this.positions[i3] = x;
        this.positions[i3 + 1] = y;
        this.positions[i3 + 2] = z;
        return true;
      }
    }

    // Failed to find valid position
    return false;
  }

  /**
   * Get the mesh for adding to scene.
   */
  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /**
   * Whether particles are enabled.
   */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this.mesh.visible = value;
  }

  /**
   * Update particles. Call once per frame.
   * Respawns particles that have left the distance range or are above water.
   */
  update(_deltaTime: number, camera: THREE.Camera): void {
    if (!this._enabled) return;

    const nearSq = this.nearDistance * this.nearDistance;
    const farSq = this.farDistance * this.farDistance;
    const distanceRange = this.farDistance - this.nearDistance;

    for (let i = 0; i < this.activeCount; i++) {
      const i3 = i * 3;

      let x = this.positions[i3];
      let y = this.positions[i3 + 1];
      let z = this.positions[i3 + 2];

      // Check distance from camera
      let dx = x - camera.position.x;
      let dy = y - camera.position.y;
      let dz = z - camera.position.z;
      let distSq = dx * dx + dy * dy + dz * dz;

      // Check if particle needs respawning
      const tooFar = distSq > farSq;
      const tooNear = distSq < nearSq;
      const aboveWater = y > -0.5;
      const notInitialized = !this._initialized;

      if (tooFar || tooNear || aboveWater || notInitialized) {
        const spawned = this.spawnParticle(i, camera);
        if (!spawned) {
          this.alphas[i] = 0;
          continue;
        }

        // Recalculate distance from new position
        x = this.positions[i3];
        y = this.positions[i3 + 1];
        z = this.positions[i3 + 2];
        dx = x - camera.position.x;
        dy = y - camera.position.y;
        dz = z - camera.position.z;
        distSq = dx * dx + dy * dy + dz * dz;
      }

      // Calculate distance-based alpha (fade from 1 at near to 0 at far)
      const dist = Math.sqrt(distSq);
      const tFade = Math.max(
        0,
        Math.min(1, (dist - this.nearDistance) / distanceRange),
      );
      this.alphas[i] = 1.0 - tFade * tFade;
    }

    this._initialized = true;
    this.positionAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  /**
   * Update parameters at runtime.
   */
  updateParams(params: Partial<ParticleParams>): void {
    if (params.enabled !== undefined) {
      this.enabled = params.enabled;
    }
    if (params.color !== undefined) {
      this.colorUniform.value.set(params.color);
    }
    if (params.opacity !== undefined) {
      this.opacityUniform.value = params.opacity;
    }
    if (params.minSize !== undefined) {
      this.minSizeUniform.value = params.minSize;
    }
    if (params.maxSize !== undefined) {
      this.maxSizeUniform.value = params.maxSize;
    }

    // Track if we need to regenerate particles
    let needsRegenerate = false;

    if (params.nearDistance !== undefined) {
      this.nearDistance = params.nearDistance;
      needsRegenerate = true;
    }
    if (params.farDistance !== undefined) {
      this.farDistance = params.farDistance;
      needsRegenerate = true;
    }
    if (params.count !== undefined && params.count !== this.activeCount) {
      this.activeCount = Math.min(params.count, this.maxParticles);
      this.geometry.instanceCount = this.activeCount;
      needsRegenerate = true;
    }

    if (needsRegenerate) {
      this._initialized = false;
    }
  }

  /**
   * Dispose of GPU resources.
   */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
