// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import {
  mix,
  smoothstep,
  texture,
  vec2,
  vec3,
  vec4,
  float,
  Fn,
  normalize,
  positionWorld,
  positionLocal,
  transformNormalToView,
  time,
  varying,
} from "three/tsl";
import { fbm2D } from "../../shaders/noise";
import { Caustics } from "../../shaders/caustics";
import { FloorDisplacementUniforms } from "../../uniforms";
import type { OceanFloorOptions } from "./types";
import type { IWaveSimulation } from "../../simulation/waves";

// Import bundled textures - sand
import sandColorUrl from "../../assets/sand_diff_1k.jpg";
import sandNormalUrl from "../../assets/sand_norm_1k.jpg";
import sandDispUrl from "../../assets/sand_disp_1k.jpg";
// Import bundled textures - rocky
import rockyColorUrl from "../../assets/rocky_diff_1k.jpg";
import rockyNormalUrl from "../../assets/rocky_norm_1k.jpg";
import rockyDispUrl from "../../assets/rocky_disp_1k.jpg";
import { RenderOrder } from "../../rendering/renderOrder";

// Re-export types for public API
export type { OceanFloorOptions };

/**
 * OceanFloor - Manages the ocean floor mesh with textures and caustics.
 *
 * Creates a large plane mesh positioned below the water surface with:
 * - Sand color and normal textures
 * - Animated caustics effect
 * - Procedural displacement for terrain variation (computed per-vertex)
 */
/** Texture set for a floor material (sand or rocky) */
interface FloorTextureSet {
  color: THREE.Texture;
  displacement: THREE.Texture;
  normal: THREE.Texture;
}

export class OceanFloor {
  private mesh: THREE.Mesh;
  private material: THREE.MeshStandardNodeMaterial;
  private geometry: THREE.PlaneGeometry;

  // Texture sets for blending
  private sandTextures: FloorTextureSet | null = null;
  private rockyTextures: FloorTextureSet | null = null;

  // Options reference (for updating uniforms)
  private options: OceanFloorOptions;

  // User-requested visibility (not overridden by underwater state)
  private _userVisible = true;

  // Shader classes
  public readonly caustics = new Caustics(time);

  // Displacement uniforms (terrain variation)
  private displacementUniforms = new FloorDisplacementUniforms();

  private constructor(
    mesh: THREE.Mesh,
    material: THREE.MeshStandardNodeMaterial,
    geometry: THREE.PlaneGeometry,
    sandTextures: FloorTextureSet,
    rockyTextures: FloorTextureSet,
    options: OceanFloorOptions,
  ) {
    this.mesh = mesh;
    this.material = material;
    this.geometry = geometry;
    this.sandTextures = sandTextures;
    this.rockyTextures = rockyTextures;
    this.options = options;
  }

  /**
   * Create and initialize an OceanFloor instance.
   *
   * @param options - Configuration options (flat structure)
   * @returns Promise resolving to the initialized OceanFloor
   */
  static async create(options: OceanFloorOptions): Promise<OceanFloor> {
    const { size, depth, meshResolution = 32, tileSize = 20 } = options;

    // Create geometry
    const geometry = new THREE.PlaneGeometry(
      size,
      size,
      meshResolution,
      meshResolution,
    );
    geometry.rotateX(-Math.PI / 2);
    geometry.computeTangents();

    // Create material
    const material = new THREE.MeshStandardNodeMaterial();
    material.roughness = 0.9;
    material.metalness = 0.0;

    // Load all textures for both sand and rocky
    const textureLoader = new THREE.TextureLoader();
    const [
      sandColor,
      sandNormal,
      sandDisp,
      rockyColor,
      rockyNormal,
      rockyDisp,
    ] = await Promise.all([
      textureLoader.loadAsync(sandColorUrl),
      textureLoader.loadAsync(sandNormalUrl),
      textureLoader.loadAsync(sandDispUrl),
      textureLoader.loadAsync(rockyColorUrl),
      textureLoader.loadAsync(rockyNormalUrl),
      textureLoader.loadAsync(rockyDispUrl),
    ]);

    // Configure texture wrapping and color spaces
    const configureTexture = (
      tex: THREE.Texture,
      isNormalOrDisp: boolean,
    ): void => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      if (isNormalOrDisp) {
        tex.colorSpace = THREE.NoColorSpace;
      }
    };

    configureTexture(sandColor, false);
    configureTexture(sandNormal, true);
    configureTexture(sandDisp, true);
    configureTexture(rockyColor, false);
    configureTexture(rockyNormal, true);
    configureTexture(rockyDisp, true);

    const sandTextures: FloorTextureSet = {
      color: sandColor,
      displacement: sandDisp,
      normal: sandNormal,
    };

    const rockyTextures: FloorTextureSet = {
      color: rockyColor,
      displacement: rockyDisp,
      normal: rockyNormal,
    };

    // Create instance
    const instance = new OceanFloor(
      new THREE.Mesh(geometry, material),
      material,
      geometry,
      sandTextures,
      rockyTextures,
      options,
    );

    // Initialize uniforms from options
    instance.caustics.waterSize = tileSize;
    instance.initializeUniforms(options);

    // One-time wire: caustic stretch follows the wave wind direction.
    // Passed by reference, not cascade-coupled, so this is set once at
    // construction and stays correct for the life of the instance.
    if (options.windDirection) {
      instance.caustics.setWindDirection(options.windDirection);
    }

    // Apply material with textures
    instance.applyMaterial(sandTextures, rockyTextures);

    // Set mesh position and enable shadows
    instance.mesh.position.y = -depth;
    instance.mesh.renderOrder = RenderOrder.opaque.oceanFloor;
    instance.mesh.receiveShadow = true;

    return instance;
  }

  /**
   * Initialize uniforms from options.
   */
  private initializeUniforms(options: OceanFloorOptions): void {
    this.displacementUniforms.update(options);

    if (options.caustics) {
      this.caustics.update(options.caustics);
    }
  }

  /**
   * Calculate terrain displacement height at a given world position.
   * Uses inverted scale so larger values = larger features.
   */
  private calculateTerrainHeight = Fn(
    ([worldX, worldZ]: [
      ReturnType<typeof float>,
      ReturnType<typeof float>,
    ]) => {
      // Invert scale: divide by scale so larger scale = larger features
      const noisePos = vec2(worldX, worldZ).div(
        this.displacementUniforms.displacementScale,
      );
      const noiseValue = fbm2D(
        noisePos,
        float(2), // 2 octaves for performance
        this.displacementUniforms.lacunarity,
        this.displacementUniforms.persistence,
      );
      return noiseValue.mul(this.displacementUniforms.displacementStrength);
    },
  );

  /**
   * Calculate UV coordinates for texture sampling based on world position.
   */
  private calculateUV = Fn(
    ([worldX, worldZ]: [
      ReturnType<typeof float>,
      ReturnType<typeof float>,
    ]) => {
      return vec2(
        worldX
          .div(this.caustics.waterSize)
          .mul(this.displacementUniforms.textureScale),
        worldZ
          .div(this.caustics.waterSize)
          .mul(this.displacementUniforms.textureScale),
      );
    },
  );

  /**
   * Calculate raw FBM noise value (before strength scaling) for blend factor.
   * Returns value in approximately [-1, 1] range.
   */
  private calculateRawTerrainNoise = Fn(
    ([worldX, worldZ]: [
      ReturnType<typeof float>,
      ReturnType<typeof float>,
    ]) => {
      const noisePos = vec2(worldX, worldZ).div(
        this.displacementUniforms.displacementScale,
      );
      return fbm2D(
        noisePos,
        float(2),
        this.displacementUniforms.lacunarity,
        this.displacementUniforms.persistence,
      );
    },
  );

  /**
   * Calculate blend factor between sand (0) and rocky (1) based on terrain height.
   * Uses smoothstep for soft transition around threshold.
   */
  private calculateBlendFactor = Fn(
    ([rawNoise]: [ReturnType<typeof float>]) => {
      // Normalize noise from [-1,1] to [0,1]
      const normalizedHeight = rawNoise.add(1.0).mul(0.5);

      // Smoothstep transition around threshold
      const halfSoft = this.displacementUniforms.blendSoftness.mul(0.5);
      const edgeLow = this.displacementUniforms.blendThreshold.sub(halfSoft);
      const edgeHigh = this.displacementUniforms.blendThreshold.add(halfSoft);

      return smoothstep(edgeLow, edgeHigh, normalizedHeight);
    },
  );

  /**
   * Apply material with textures and per-vertex terrain displacement/normals.
   * Blends between sand and rocky textures based on terrain height.
   */
  private applyMaterial(
    sandTextures: FloorTextureSet,
    rockyTextures: FloorTextureSet,
  ): void {
    const causticsNode = this.caustics.build();

    this.material.transparent = false;

    // Compute terrain normal per-vertex and pass via varying
    const terrainNormalVarying = varying(
      Fn(() => {
        const worldPos = positionWorld;
        const worldX = worldPos.x;
        const worldZ = worldPos.z;

        const eps = float(0.5);

        // Sample heights at offset positions (per-vertex)
        const heightCenter = this.calculateTerrainHeight(worldX, worldZ);
        const heightX = this.calculateTerrainHeight(worldX.add(eps), worldZ);
        const heightZ = this.calculateTerrainHeight(worldX, worldZ.add(eps));

        // Calculate gradients
        const dhdx = heightX.sub(heightCenter).div(eps);
        const dhdz = heightZ.sub(heightCenter).div(eps);

        return normalize(vec3(dhdx.negate(), 1.0, dhdz.negate()));
      })(),
    );

    // Pass blend factor as varying (computed per-vertex from terrain noise)
    const blendFactorVarying = varying(
      Fn(() => {
        const worldPos = positionWorld;
        const rawNoise = this.calculateRawTerrainNoise(worldPos.x, worldPos.z);
        return this.calculateBlendFactor(rawNoise);
      })(),
    );

    // Apply displacement per-vertex (procedural + texture displacement)
    this.material.positionNode = Fn(() => {
      const pos = positionLocal;
      const worldPos = positionWorld;
      const uvCoord = this.calculateUV(worldPos.x, worldPos.z);

      // Procedural terrain displacement
      const proceduralDisp = this.calculateTerrainHeight(worldPos.x, worldPos.z);

      // Sample texture displacement maps and blend
      const sandDispValue = texture(sandTextures.displacement, uvCoord).r;
      const rockyDispValue = texture(rockyTextures.displacement, uvCoord).r;
      const blendFactor = blendFactorVarying;
      const textureDispValue = mix(sandDispValue, rockyDispValue, blendFactor);

      // Combine procedural and texture displacement
      const textureDisp = textureDispValue
        .sub(0.5)
        .mul(this.displacementUniforms.textureDisplacementStrength);
      const totalDisplacement = proceduralDisp.add(textureDisp);

      return vec3(pos.x, pos.y.add(totalDisplacement), pos.z);
    })();

    // Color node: blend textures + caustics
    this.material.colorNode = Fn(() => {
      const worldX = positionWorld.x;
      const worldZ = positionWorld.z;
      const uvCoord = this.calculateUV(worldX, worldZ);

      // Sample both color textures
      const sandColor = texture(sandTextures.color, uvCoord).xyz;
      const rockyColor = texture(rockyTextures.color, uvCoord).xyz;

      // Blend based on terrain height
      const blendFactor = blendFactorVarying;
      const blendedColor = mix(sandColor, rockyColor, blendFactor);

      return vec4(blendedColor.add(causticsNode), 1.0);
    })();

    // Normal node: blend terrain normal with blended texture normal maps
    this.material.normalNode = Fn(() => {
      const worldX = positionWorld.x;
      const worldZ = positionWorld.z;
      const uvCoord = this.calculateUV(worldX, worldZ);

      // Sample both normal maps and convert to [-1,1] range
      const sandNormal = texture(sandTextures.normal, uvCoord)
        .xyz.mul(2.0)
        .sub(1.0);
      const rockyNormal = texture(rockyTextures.normal, uvCoord)
        .xyz.mul(2.0)
        .sub(1.0);

      // Blend normals based on terrain height
      const blendFactor = blendFactorVarying;
      const blendedTextureNormal = mix(sandNormal, rockyNormal, blendFactor);

      // Get terrain normal from varying (computed per-vertex)
      const tN = terrainNormalVarying;

      // UDN blending: add XZ perturbations, keep Y from terrain
      const detailX = blendedTextureNormal.x.mul(
        this.displacementUniforms.normalScale,
      );
      const detailZ = blendedTextureNormal.y.mul(
        this.displacementUniforms.normalScale,
      );

      const combinedNormal = normalize(
        vec3(tN.x.add(detailX), tN.y, tN.z.add(detailZ)),
      );

      return transformNormalToView(combinedNormal);
    })();

    this.material.needsUpdate = true;
  }

  /** Get the Three.js mesh object */
  getMesh(): THREE.Mesh {
    return this.mesh;
  }

  /**
   * Position the floor to follow the camera, snapped to the floor's own
   * vertex grid.
   *
   * Terrain height, sand/rock blend, and normals are sampled per-vertex from
   * world-space noise. For that world-locked pattern to stay fixed while the
   * mesh moves, the floor must shift in whole-cell steps so its vertices
   * always land on the same world lattice. Snapping to the floor's own cell
   * size — rather than reusing the clipmap's coarser snap grid — keeps the
   * terrain stable at any mesh resolution. Reusing the clipmap grid only
   * stays stable when `meshResolution` is an integer multiple of the clipmap
   * segment count; otherwise each move lands the vertices mid-cell and the
   * terrain visibly pops.
   */
  setFollowPosition(x: number, z: number): void {
    const cell =
      this.geometry.parameters.width / this.geometry.parameters.widthSegments;
    this.mesh.position.x = Math.floor(x / cell) * cell;
    this.mesh.position.z = Math.floor(z / cell) * cell;
  }

  /** Update the ocean floor (call once per frame) */
  update(_time: number): void {
    // Wave-based caustics are driven by the wave simulation, no per-frame update needed
  }

  /** Set the depth (Y position) of the ocean floor */
  setDepth(depth: number): void {
    this.mesh.position.y = -depth;
  }

  /** Get the current depth of the ocean floor */
  getDepth(): number {
    return -this.mesh.position.y;
  }

  /** Set visibility of the ocean floor */
  setVisible(visible: boolean): void {
    this._userVisible = visible;
    this.mesh.visible = visible;
  }

  /** Check if ocean floor is visible */
  isVisible(): boolean {
    return this._userVisible;
  }

  /** @internal Resolve effective visibility from user setting and underwater state */
  resolveVisibility(underwaterEnabled: boolean): void {
    this.mesh.visible = underwaterEnabled && this._userVisible;
  }

  /**
   * Update displacement configuration.
   * Call this when UI params change to sync uniforms.
   */
  updateDisplacementConfig(config: Partial<OceanFloorOptions>): void {
    Object.assign(this.options, config);
    this.displacementUniforms.update(this.options);
  }

  /**
   * Update caustics configuration.
   * Call this when UI params change to sync uniforms.
   */
  updateCausticsConfig(config: OceanFloorOptions["caustics"]): void {
    if (config) {
      this.options.caustics = config;
      this.caustics.update(config);
    }
  }

  /**
   * Set the wave-normal texture used by wave-based caustics.
   * Must be called before the material is first rendered to take effect.
   */
  setWaveTexture(options: {
    normalTexture: THREE.Texture;
    scale: number;
  }): void {
    this.caustics.setWaveTexture(options);

    // Re-apply material to use wave-based caustics
    if (this.sandTextures && this.rockyTextures) {
      this.applyMaterial(this.sandTextures, this.rockyTextures);
    }
  }

  /**
   * Rebind to the wave simulation. Pulls the cascade-0 normal texture and
   * scale used to modulate the procedural caustic pattern with live waves.
   * Called whenever cascade configuration changes or the wave sim is
   * recreated.
   */
  onCascadeChanged(sim: IWaveSimulation): void {
    const scale = sim.getScale(0);
    const normalTexture = sim.getNormalTexture(0);

    if (normalTexture) {
      this.setWaveTexture({ normalTexture, scale });
    }
  }

  /** Dispose of all resources */
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.sandTextures?.color.dispose();
    this.sandTextures?.displacement.dispose();
    this.sandTextures?.normal.dispose();
    this.rockyTextures?.color.dispose();
    this.rockyTextures?.displacement.dispose();
    this.rockyTextures?.normal.dispose();
  }
}
