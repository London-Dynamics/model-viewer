import * as THREE from "three/webgpu";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface ClipmapConfig {
  levels: number; // Number of LOD levels (e.g., 4)
  segments: number; // Vertices per side for each level (e.g., 64)
  baseSize: number; // Size of innermost level in world units (e.g., 400)
  /**
   * World-space outer extent of the flat "infinity" ring that bridges the
   * outermost LOD to the horizon. Computed as `camera.far * 0.95` by
   * WaterSystem so the ring stays inside the camera frustum — setting this
   * directly is only appropriate when constructing WaterSurfaceGeometry
   * without a full WaterSystem.
   */
  infinityRingExtent: number;
}

/**
 * Traditional geometry clipmap for infinite terrain/water rendering.
 *
 * Each level is a uniform square grid where:
 * - Level 0 has size `baseSize` with vertex spacing `baseSize / segments`
 * - Level N has size `baseSize * 2^N` with vertex spacing `baseSize * 2^N / segments`
 *
 * Grid snapping prevents "swimming" artifacts by ensuring vertices stay
 * fixed relative to the wave field. Each level snaps to its own grid,
 * and the grids are hierarchically aligned (level N+1 grid points are
 * a subset of level N grid points).
 *
 * @see https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry
 * @see https://mikejsavage.co.uk/geometry-clipmaps/
 */
/**
 * Fired after every {@link WaterSurfaceGeometry.update} with the latest
 * grid-snapped centre position in world space. Consumers that need to
 * follow the clipmap (water material offset uniform, ocean floor mesh
 * position) subscribe instead of being poked by `WaterSystem`.
 */
export type SnappedPositionListener = (x: number, z: number) => void;

export class WaterSurfaceGeometry {
  private static readonly UNDERWATER_DEPTH = 1000;
  private elevation = 0;

  private config: ClipmapConfig;
  private container: THREE.Group;
  private snappedPosition: THREE.Vector2 = new THREE.Vector2();
  private surfaceMesh: THREE.Mesh | null = null;
  private underwaterMesh: THREE.Mesh | null = null;
  private underwaterMaterial: THREE.MeshBasicMaterial;
  private _snappedPositionListeners: SnappedPositionListener[] = [];

  constructor(config: ClipmapConfig, material: THREE.Material) {
    this.config = config;
    this.container = new THREE.Group();
    this.underwaterMaterial = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.createLevels(material);
  }

  private createLevels(material: THREE.Material) {
    const surfaceGeometries: THREE.BufferGeometry[] = [];

    // Collect level geometries
    for (let level = 0; level < this.config.levels; level++) {
      const outerSize = this.getLevelSize(level);
      const innerSize = level === 0 ? 0 : this.getLevelSize(level - 1);
      const spacing = this.getLevelVertexSpacing(level);

      let geometry: THREE.BufferGeometry;

      if (level === 0) {
        // Innermost level: full square with uniform grid
        geometry = new THREE.PlaneGeometry(outerSize, outerSize, this.config.segments, this.config.segments);
        geometry.rotateX(-Math.PI / 2);
      } else {
        // Outer levels: ring (square with square hole) using uniform grid
        geometry = this.createRingGeometry(innerSize, outerSize, spacing);
      }
      surfaceGeometries.push(geometry);

      // Collect skirt geometry to connect this level's outer edge to next level's inner edge
      if (level < this.config.levels - 1) {
        surfaceGeometries.push(this.createSkirtGeometry(level));
      }
    }

    // Append flat infinity ring — bridges the outermost LOD to the visual
    // horizon. Always at y=0; shares the water material so it renders with
    // the same fresnel/fog treatment as the rest of the surface.
    //
    // Skip when the outermost LOD already meets or exceeds the ring's outer
    // extent (e.g., large baseSize × levels): building it would produce an
    // inverted square-with-square-hole and the user would see the ring
    // silently vanish as they raise baseSize/levels past the extent.
    const outermostLOD = this.getLevelSize(this.config.levels - 1);
    if (this.config.infinityRingExtent > outermostLOD) {
      surfaceGeometries.push(
        this.createInfinityRingGeometry(
          outermostLOD,
          this.config.infinityRingExtent,
          this.getLevelVertexSpacing(this.config.levels - 1),
        ),
      );
    }

    // Merge surface geometries
    const mergedSurfaceGeometry = mergeGeometries(surfaceGeometries, false);
    for (const g of surfaceGeometries) {
      g.dispose();
    }

    const surfaceMesh = new THREE.Mesh(mergedSurfaceGeometry, material);
    surfaceMesh.frustumCulled = false;
    // Render water before other transparent objects so it writes depth first.
    // Other transparent objects (with depthWrite=false) then correctly
    // depth-test against the water surface.
    surfaceMesh.renderOrder = -1;
    this.container.add(surfaceMesh);
    this.surfaceMesh = surfaceMesh;

    // Underwater volume as a separate depth-only mesh to avoid running the
    // full water shader on geometry that only needs to populate the depth buffer
    const underwaterGeometries: THREE.BufferGeometry[] = [];
    this.collectUnderwaterGeometries(underwaterGeometries);
    const mergedUnderwaterGeometry = mergeGeometries(underwaterGeometries, false);
    for (const g of underwaterGeometries) {
      g.dispose();
    }

    const underwaterMesh = new THREE.Mesh(mergedUnderwaterGeometry, this.underwaterMaterial);
    underwaterMesh.frustumCulled = false;
    underwaterMesh.renderOrder = -1;
    this.container.add(underwaterMesh);
    this.underwaterMesh = underwaterMesh;
  }

  /**
   * Collect geometries to enclose the underwater volume:
   * - A ground plane at -UNDERWATER_DEPTH
   * - Vertical skirts on all 4 outer edges extending past the ground plane
   *
   * The volume is sized to the outermost LOD regardless of whether the flat
   * infinity ring is enabled: downstream systems (underwater fog, depth
   * readback, masking) depend on the "curtain" sitting at a predictable
   * world-space distance from the camera, and growing it with the infinity
   * ring would push it far enough that fog saturates before reaching it.
   */
  private collectUnderwaterGeometries(geometries: THREE.BufferGeometry[]): void {
    const totalSize = this.getTotalSize();
    const halfExtent = totalSize / 2;
    const depth = WaterSurfaceGeometry.UNDERWATER_DEPTH;

    // Ground plane — single quad at fixed depth, faces upward into the volume
    const groundGeometry = new THREE.PlaneGeometry(totalSize, totalSize, 1, 1);
    groundGeometry.rotateX(Math.PI / 2);
    groundGeometry.translate(0, -depth, 0);
    geometries.push(groundGeometry);

    // Edge skirts extend past the floor to prevent gaps at the seams
    const skirtDepth = depth + 1000;
    geometries.push(this.createEdgeSkirtGeometry("north", totalSize, skirtDepth, halfExtent));
    geometries.push(this.createEdgeSkirtGeometry("south", totalSize, skirtDepth, halfExtent));
    geometries.push(this.createEdgeSkirtGeometry("east", totalSize, skirtDepth, halfExtent));
    geometries.push(this.createEdgeSkirtGeometry("west", totalSize, skirtDepth, halfExtent));
  }

  /**
   * Create a vertical skirt geometry on one edge of the clipmap.
   * Top edge vertices match the outermost clipmap level's edge exactly.
   * Normals face inward (back-facing when viewed from inside the volume).
   */
  private createEdgeSkirtGeometry(
    edge: "north" | "south" | "east" | "west",
    totalSize: number,
    depth: number,
    halfExtent: number,
  ): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    const spacing = this.getLevelVertexSpacing(this.config.levels - 1);
    const numVerts = Math.round(totalSize / spacing) + 1;

    const vertices: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];

    // Create vertices: top row at y=0, bottom row at y=-depth
    for (let i = 0; i < numVerts; i++) {
      const t = -halfExtent + i * spacing;
      let x: number, z: number;

      switch (edge) {
        case "north":
          x = t;
          z = halfExtent;
          break;
        case "south":
          x = t;
          z = -halfExtent;
          break;
        case "east":
          x = halfExtent;
          z = t;
          break;
        case "west":
          x = -halfExtent;
          z = t;
          break;
      }

      // Top vertex (at water surface)
      vertices.push(x, 0, z);
      uvs.push(i / (numVerts - 1), 1);

      // Bottom vertex (at depth)
      vertices.push(x, -depth, z);
      uvs.push(i / (numVerts - 1), 0);
    }

    // Create triangles with correct winding for inward-facing normals
    // (back-facing when viewed from inside the underwater volume)
    for (let i = 0; i < numVerts - 1; i++) {
      const topLeft = i * 2;
      const bottomLeft = i * 2 + 1;
      const topRight = (i + 1) * 2;
      const bottomRight = (i + 1) * 2 + 1;

      // Winding order reversed from outward-facing to create inward-facing normals
      switch (edge) {
        case "north":
          // Normal faces -Z (inward)
          indices.push(topLeft, bottomLeft, topRight);
          indices.push(bottomLeft, bottomRight, topRight);
          break;
        case "south":
          // Normal faces +Z (inward)
          indices.push(topLeft, topRight, bottomLeft);
          indices.push(bottomLeft, topRight, bottomRight);
          break;
        case "east":
          // Normal faces -X (inward)
          indices.push(topLeft, topRight, bottomLeft);
          indices.push(bottomLeft, topRight, bottomRight);
          break;
        case "west":
          // Normal faces +X (inward)
          indices.push(topLeft, bottomLeft, topRight);
          indices.push(bottomLeft, bottomRight, topRight);
          break;
      }
    }

    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Create transition strip geometry that connects level N's outer edge to level N+1's interior.
   * The strip has fine spacing on its inner edge (matching level N) and coarse spacing on its
   * outer edge (matching level N+1's interior grid).
   *
   * This handles T-junctions where 2 fine vertices connect to 1 coarse vertex.
   */
  private createSkirtGeometry(level: number): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();

    const fineSize = this.getLevelSize(level);
    const fineSpacing = this.getLevelVertexSpacing(level);
    const coarseSpacing = this.getLevelVertexSpacing(level + 1);
    const outerSize = this.getLevelSize(level + 1);

    const halfInner = fineSize / 2;  // Inner edge = level N's outer edge
    const halfOuter = outerSize / 2; // For UV calculation

    const vertices: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];

    const vertexMap = new Map<string, number>();

    const getOrCreateVertex = (x: number, z: number): number => {
      const key = `${x.toFixed(6)},${z.toFixed(6)}`;
      if (vertexMap.has(key)) {
        return vertexMap.get(key)!;
      }
      const index = vertices.length / 3;
      vertices.push(x, 0, z);
      uvs.push((x + halfOuter) / outerSize, (z + halfOuter) / outerSize);
      vertexMap.set(key, index);
      return index;
    };

    // Create transition strip for each edge
    // Inner edge uses fine spacing, outer edge (1 coarse cell out) uses coarse spacing
    const numFineVerts = Math.round(fineSize / fineSpacing) + 1;

    const createEdgeTransition = (
      innerPos: number,      // Position of inner edge (±halfInner)
      outerPos: number,      // Position of outer edge (±halfInner ± coarseSpacing)
      startParallel: number, // Start position along the edge
      dirParallel: number,   // Direction along the edge (+1 or -1)
      isHorizontal: boolean, // true for top/bottom edges, false for left/right
      flip: boolean          // Flip winding order for opposite edges
    ) => {
      for (let i = 0; i < numFineVerts - 1; i++) {
        // Fine edge vertices (inner edge at halfInner)
        const p0 = startParallel + i * fineSpacing * dirParallel;
        const p1 = startParallel + (i + 1) * fineSpacing * dirParallel;

        // Coarse edge vertices (outer edge, snapped to coarse grid)
        const cp0 = Math.round(p0 / coarseSpacing) * coarseSpacing;
        const cp1 = Math.round(p1 / coarseSpacing) * coarseSpacing;

        let vInner0: number, vInner1: number, vOuter0: number, vOuter1: number;

        if (isHorizontal) {
          // Top/bottom edges: X varies, Z is fixed
          vInner0 = getOrCreateVertex(p0, innerPos);
          vInner1 = getOrCreateVertex(p1, innerPos);
          vOuter0 = getOrCreateVertex(cp0, outerPos);
          vOuter1 = getOrCreateVertex(cp1, outerPos);
        } else {
          // Left/right edges: Z varies, X is fixed
          vInner0 = getOrCreateVertex(innerPos, p0);
          vInner1 = getOrCreateVertex(innerPos, p1);
          vOuter0 = getOrCreateVertex(outerPos, cp0);
          vOuter1 = getOrCreateVertex(outerPos, cp1);
        }

        // Create triangles - handle T-junction when coarse vertices collapse
        // All triangles use consistent winding so normals point same direction
        if (vOuter0 === vOuter1) {
          // Single triangle: two inner vertices to one outer vertex
          if (flip) {
            indices.push(vInner0, vOuter0, vInner1);
          } else {
            indices.push(vInner0, vOuter0, vInner1);
          }
        } else {
          // Quad: two triangles
          if (flip) {
            indices.push(vInner0, vOuter0, vInner1);
            indices.push(vInner1, vOuter0, vOuter1);
          } else {
            indices.push(vInner0, vOuter0, vInner1);
            indices.push(vInner1, vOuter0, vOuter1);
          }
        }
      }
    };

    // Top edge (positive Z): inner at +halfInner, outer at +halfInner + coarseSpacing
    createEdgeTransition(halfInner, halfInner + coarseSpacing, -halfInner, 1, true, false);
    // Bottom edge (negative Z): inner at -halfInner, outer at -halfInner - coarseSpacing
    createEdgeTransition(-halfInner, -halfInner - coarseSpacing, halfInner, -1, true, true);
    // Right edge (positive X): inner at +halfInner, outer at +halfInner + coarseSpacing
    createEdgeTransition(halfInner, halfInner + coarseSpacing, halfInner, -1, false, true);
    // Left edge (negative X): inner at -halfInner, outer at -halfInner - coarseSpacing
    createEdgeTransition(-halfInner, -halfInner - coarseSpacing, -halfInner, 1, false, false);

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Create ring geometry (square with square hole) using uniform vertex spacing.
   * All vertices lie on a regular grid aligned with the spacing.
   */
  private createRingGeometry(innerSize: number, outerSize: number, spacing: number): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();

    const halfInner = innerSize / 2;
    const halfOuter = outerSize / 2;

    const vertices: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];

    // Generate vertices on a uniform grid, but only in the ring region
    // Ring region: |x| > halfInner OR |z| > halfInner (outside inner square)
    //              AND |x| <= halfOuter AND |z| <= halfOuter (inside outer square)

    const vertexMap = new Map<string, number>(); // "x,z" -> vertex index

    const getOrCreateVertex = (x: number, z: number): number => {
      const key = `${x.toFixed(6)},${z.toFixed(6)}`;
      if (vertexMap.has(key)) {
        return vertexMap.get(key)!;
      }
      const index = vertices.length / 3;
      vertices.push(x, 0, z);
      // UV based on position within outer bounds
      uvs.push((x + halfOuter) / outerSize, (z + halfOuter) / outerSize);
      vertexMap.set(key, index);
      return index;
    };

    // Iterate over grid cells and create triangles for cells in the ring region
    const numCells = Math.round(outerSize / spacing);
    const eps = spacing * 0.001;

    for (let iz = 0; iz < numCells; iz++) {
      for (let ix = 0; ix < numCells; ix++) {
        // Cell corners in world space
        const x0 = -halfOuter + ix * spacing;
        const z0 = -halfOuter + iz * spacing;
        const x1 = x0 + spacing;
        const z1 = z0 + spacing;

        // Check if this cell is in the ring region (not entirely inside inner square)
        const cellInInner =
          x0 >= -halfInner && x1 <= halfInner &&
          z0 >= -halfInner && z1 <= halfInner;

        if (cellInInner) {
          continue; // Skip cells entirely inside the inner square
        }

        // Check if this cell is in the transition strip zone (handled by skirt geometry)
        // The transition strip covers cells adjacent to the inner boundary that are within
        // the inner level's extent (from -halfInner to +halfInner)
        const inTopTransition = Math.abs(z0 - halfInner) < eps && x0 >= -halfInner - eps && x1 <= halfInner + eps;
        const inBottomTransition = Math.abs(z1 + halfInner) < eps && x0 >= -halfInner - eps && x1 <= halfInner + eps;
        const inRightTransition = Math.abs(x0 - halfInner) < eps && z0 >= -halfInner - eps && z1 <= halfInner + eps;
        const inLeftTransition = Math.abs(x1 + halfInner) < eps && z0 >= -halfInner - eps && z1 <= halfInner + eps;

        if (inTopTransition || inBottomTransition || inRightTransition || inLeftTransition) {
          continue; // Skip cells handled by transition strip
        }

        // Create two triangles for this cell
        const v00 = getOrCreateVertex(x0, z0);
        const v10 = getOrCreateVertex(x1, z0);
        const v01 = getOrCreateVertex(x0, z1);
        const v11 = getOrCreateVertex(x1, z1);

        // Triangle 1
        indices.push(v00, v01, v10);
        // Triangle 2
        indices.push(v10, v01, v11);
      }
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }

  /**
   * Build the flat "infinity" ring — a square ring whose inner edge is
   * coincident with the outermost LOD's outer edge and whose outer edge
   * reaches to `outerSize`.
   *
   * The inner edge is tessellated at `innerSpacing` so its vertex positions
   * line up one-for-one with the outermost LOD's outer-edge vertices. This
   * eliminates the T-junction gap that would otherwise appear where the
   * fine outer LOD meets a coarse ring on a shared seam. Each inner vertex
   * gets a radially-projected partner on the outer boundary (scaled by
   * outer/inner so ring corners map to corners), producing a uniform strip
   * of quads per side.
   */
  private createInfinityRingGeometry(
    innerSize: number,
    outerSize: number,
    innerSpacing: number,
  ): THREE.BufferGeometry {
    const halfI = innerSize / 2;
    const halfO = outerSize / 2;
    const outerScale = halfO / halfI;
    const numSegmentsPerSide = Math.max(1, Math.round(innerSize / innerSpacing));

    const vertices: number[] = [];
    const indices: number[] = [];
    const uvs: number[] = [];
    const vertexMap = new Map<string, number>();

    const getOrCreate = (x: number, z: number): number => {
      const key = `${x.toFixed(4)},${z.toFixed(4)}`;
      const existing = vertexMap.get(key);
      if (existing !== undefined) return existing;
      const idx = vertices.length / 3;
      vertices.push(x, 0, z);
      uvs.push((x + halfO) / outerSize, (z + halfO) / outerSize);
      vertexMap.set(key, idx);
      return idx;
    };

    /**
     * Emit the strip for one compass side. `innerPos`/`outerPos` are the
     * fixed perpendicular-axis coordinates (inner at ±halfI, outer at
     * ±halfO). `isHorizontal` is true for N/S sides (x varies along the
     * strip); `flipWinding` flips each quad's winding so every triangle
     * ends up +Y-facing given the side's orientation.
     */
    const buildSide = (
      innerPos: number,
      outerPos: number,
      isHorizontal: boolean,
      flipWinding: boolean,
    ): void => {
      for (let i = 0; i < numSegmentsPerSide; i++) {
        const t0 = -halfI + i * innerSpacing;
        const t1 =
          i === numSegmentsPerSide - 1
            ? halfI
            : -halfI + (i + 1) * innerSpacing;
        const s0 = t0 * outerScale;
        const s1 = t1 * outerScale;

        let vInnerA: number, vInnerB: number, vOuterA: number, vOuterB: number;
        if (isHorizontal) {
          vInnerA = getOrCreate(t0, innerPos);
          vInnerB = getOrCreate(t1, innerPos);
          vOuterA = getOrCreate(s0, outerPos);
          vOuterB = getOrCreate(s1, outerPos);
        } else {
          vInnerA = getOrCreate(innerPos, t0);
          vInnerB = getOrCreate(innerPos, t1);
          vOuterA = getOrCreate(outerPos, s0);
          vOuterB = getOrCreate(outerPos, s1);
        }

        if (flipWinding) {
          indices.push(vInnerA, vInnerB, vOuterB);
          indices.push(vInnerA, vOuterB, vOuterA);
        } else {
          indices.push(vInnerA, vOuterA, vOuterB);
          indices.push(vInnerA, vOuterB, vInnerB);
        }
      }
    };

    buildSide(+halfI, +halfO, true, false);   // N (z = +halfI → +halfO)
    buildSide(-halfI, -halfO, true, true);    // S (z = -halfI → -halfO)
    buildSide(+halfI, +halfO, false, true);   // E (x = +halfI → +halfO)
    buildSide(-halfI, -halfO, false, false);  // W (x = -halfI → -halfO)

    const normals = new Float32Array(vertices.length);
    for (let i = 1; i < normals.length; i += 3) {
      normals[i] = 1;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    return geometry;
  }

  /**
   * Get the world size of a clipmap level.
   * Each level is 2x the size of the previous level.
   */
  public getLevelSize(level: number): number {
    return this.config.baseSize * Math.pow(2, level);
  }

  /**
   * Get the vertex spacing for a clipmap level.
   * Each level has 2x the spacing of the previous level.
   */
  public getLevelVertexSpacing(level: number): number {
    return this.getLevelSize(level) / this.config.segments;
  }

  /**
   * Update clipmap position with hierarchical grid snapping.
   *
   * Each level snaps to its own grid (multiples of its vertex spacing).
   * This prevents vertices from "swimming" as the camera moves.
   *
   * For simplicity, we snap all levels to the finest (level 0) grid.
   * Since each coarser level's grid is a subset of the finer grid,
   * this ensures all levels stay aligned.
   */

  public update(cameraPosition: THREE.Vector3): void {
    // Snap to the COARSEST level's grid spacing
    // This ensures all finer grids also align (since they're power-of-2 subdivisions)
    const coarsestSpacing = this.getLevelVertexSpacing(this.config.levels - 1);

    const snappedX = Math.floor(cameraPosition.x / coarsestSpacing) * coarsestSpacing;
    const snappedZ = Math.floor(cameraPosition.z / coarsestSpacing) * coarsestSpacing;

    this.snappedPosition.set(snappedX, snappedZ);

    // All levels share the same center position
    this.container.position.set(snappedX, this.elevation, snappedZ);

    for (const fn of this._snappedPositionListeners) {
      fn(snappedX, snappedZ);
    }
  }

  /**
   * Get the current snapped position of the clipmap.
   */
  public getSnappedPosition(): THREE.Vector2 {
    return this.snappedPosition.clone();
  }

  /** Set the world-space Y elevation for the ocean surface. */
  public setElevation(elevation: number): void {
    this.elevation = elevation;
    this.container.position.y = elevation;
  }

  /**
   * Register a callback that fires after every {@link update} with the
   * latest grid-snapped centre. Use this to keep follower objects (water
   * material offset, ocean floor mesh) in sync without poking them from
   * `WaterSystem`.
   */
  public addSnappedPositionListener(fn: SnappedPositionListener): void {
    this._snappedPositionListeners.push(fn);
  }

  /**
   * Get the vertex spacing for the finest (innermost) level.
   */
  public getVertexSpacing(): number {
    return this.getLevelVertexSpacing(0);
  }

  /**
   * Get the Three.js group containing all clipmap meshes.
   */
  public getObject(): THREE.Group {
    return this.container;
  }

  /**
   * Rebuild the clipmap with new configuration.
   * Disposes existing geometry and creates new levels.
   */
  public rebuild(config: Partial<ClipmapConfig>, material: THREE.Material): void {
    // Dispose existing geometry but keep the underwater material for reuse
    this.dispose(false);

    // Update config with new values
    if (config.levels !== undefined) this.config.levels = config.levels;
    if (config.segments !== undefined) this.config.segments = config.segments;
    if (config.baseSize !== undefined) this.config.baseSize = config.baseSize;
    if (config.infinityRingExtent !== undefined) {
      this.config.infinityRingExtent = config.infinityRingExtent;
    }

    // Create new levels
    this.createLevels(material);
  }

  /**
   * Get the current clipmap configuration.
   */
  public getConfig(): Readonly<ClipmapConfig> {
    return this.config;
  }

  /**
   * Dispose of all geometry and materials.
   * @param full - When true, also disposes the underwater material.
   *   Pass false (or omit) when the object will be reused (e.g., rebuild).
   */
  public dispose(full: boolean = true) {
    if (this.surfaceMesh) {
      this.surfaceMesh.geometry.dispose();
      this.surfaceMesh = null;
    }
    if (this.underwaterMesh) {
      this.underwaterMesh.geometry.dispose();
      this.underwaterMesh = null;
    }
    if (full) {
      this.underwaterMaterial.dispose();
    }
    this.container.clear();
  }

  /**
   * Get total vertex count of the merged geometry.
   */
  public getVertexCount(): number {
    if (!this.surfaceMesh) return 0;
    const pos = this.surfaceMesh.geometry.getAttribute("position");
    return pos ? pos.count : 0;
  }

  /**
   * Get the outermost size of the clipmap.
   */
  public getTotalSize(): number {
    return this.getLevelSize(this.config.levels - 1);
  }

  /**
   * Get number of levels.
   */
  public getLevelCount(): number {
    return this.config.levels;
  }

  /**
   * Set the material for the water surface mesh.
   */
  public setMaterial(material: THREE.Material): void {
    if (this.surfaceMesh) {
      this.surfaceMesh.material = material;
    }
  }
}
