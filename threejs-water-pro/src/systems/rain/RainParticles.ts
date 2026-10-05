// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * World-space instanced billboard rain particles.
 *
 * Each rain streak is a quad billboard oriented along the fall direction —
 * right axis perpendicular to the camera ray, length axis along gravity+wind.
 * The vertex shader expands each instance into a billboard entirely in world
 * space; there is no geometry shader, no sorting, and no CPU→GPU position
 * upload cost beyond the position array itself.
 *
 * 1 draw call regardless of particle count.
 * CPU update (suitable up to ~50k particles; above that, prefer GPU compute).
 */

import * as THREE from "three/webgpu";
import {
  attribute,
  cameraPosition,
  cross,
  float,
  Fn,
  length,
  mix,
  normalize,
  smoothstep,
  uniform,
  uv,
  vec3,
} from "three/tsl";
// ============================================
// Types
// ============================================

/** Parameters for controlling rain streaks. Used by presets and the demo UI. */
export interface RainParams {
  /** Rain streak tint color (hex string). */
  color: string;
  /** Whether rain is enabled. */
  enabled: boolean;
  /** Distance (m) at which streaks begin fading out toward the domain boundary. */
  fadeDistance: number;
  /** Rain streak density (0–1). */
  intensity: number;
  /** Visual opacity of rain streaks (0–1). */
  opacity: number;
  /** Speed multiplier for rain fall animation (default 1.0). */
  speed: number;
  /** Maximum streak length in world units (default 1.0). */
  streakLength: number;
  /** Maximum streak width in world units (default 0.008). */
  streakWidth: number;
}

// ============================================
// Constants
// ============================================

/** XZ half-extent of the camera-relative rain domain (m). */
const DOMAIN_HALF_XZ = 60;
/** Domain top, relative to camera Y (m). */
const DOMAIN_TOP = 25;
/** Domain bottom, relative to camera Y (m). */
const DOMAIN_BOTTOM = -5;

/** Base fall speed in m/s (close to terminal velocity for raindrops). */
const FALL_SPEED_BASE = 9.0;
/** Maximum wind speed for tilt normalization (m/s). Matches Rain.ts. */
const WIND_SPEED_MAX = 50.0;
/** Maximum horizontal tilt at full wind speed. Matches Rain.ts. */
const WIND_TILT_MAX = 0.5;

/** Per-streak length range (m). Modulated by streakLength parameter. */
const STREAK_LENGTH_MIN = 0.08;
/** Width range (m). */
const STREAK_WIDTH_MIN = 0.002;
const STREAK_WIDTH_MAX = 0.01;

/** Near-distance fade: streaks within this radius of the camera fade to zero. */
const NEAR_FADE_START = 3.0;  // m — fully transparent at this distance
const NEAR_FADE_END = 10.0;   // m — fully opaque beyond this distance

/** Default distance (m) at which streak fade-out begins. */
const DEFAULT_FADE_DISTANCE = 40.0;

/** Default streak tint (matches screen-space Rain default). */
const DEFAULT_COLOR = "#b3bfcc";

/** Default maximum particle count (CPU-friendly at 60 fps). */
const DEFAULT_MAX_COUNT = 20_000;

// ============================================
// RainParticles
// ============================================

/**
 * World-space instanced billboard rain.
 *
 * Add the mesh returned by `getMesh()` to the scene. Call `tick()` each frame
 * to simulate particle physics and upload updated positions to the GPU.
 */
export class RainParticles {
  // GPU objects
  private _geometry: THREE.InstancedBufferGeometry;
  private _material: THREE.MeshBasicNodeMaterial;
  private _mesh: THREE.Mesh;

  // Per-instance CPU arrays (written each frame for positions)
  private _positions: Float32Array; // [x, y, z] × maxCount
  private _lengths: Float32Array;   // [0, 1] × maxCount — randomized at init
  private _widths: Float32Array;    // [0, 1] × maxCount — randomized at init

  // GPU attributes
  private _positionAttr: THREE.InstancedBufferAttribute;

  // TSL uniforms
  private _fallDir = uniform(new THREE.Vector3(0, -1, 0));
  private _color = uniform(new THREE.Color(DEFAULT_COLOR));
  private _opacity = uniform(0.6);
  private _maxLength = uniform(0.4);
  private _maxWidth = uniform(STREAK_WIDTH_MAX);
  private _fadeDistance = uniform(DEFAULT_FADE_DISTANCE);

  // Simulation state
  private _maxCount: number;
  private _enabled = false;
  private _speed = 5.0;
  private _initialized = false;
  private _prevCameraPos = new THREE.Vector3();

  constructor(maxCount = DEFAULT_MAX_COUNT) {
    this._maxCount = maxCount;

    this._positions = new Float32Array(maxCount * 3);
    this._lengths = new Float32Array(maxCount);
    this._widths = new Float32Array(maxCount);

    // Randomize per-streak geometry seeds once — never change after init
    for (let i = 0; i < maxCount; i++) {
      this._lengths[i] = Math.random();
      this._widths[i] = Math.random();
    }

    // PlaneGeometry lies in the XY plane: x in [-0.5, 0.5], y in [-0.5, 0.5]
    const base = new THREE.PlaneGeometry(1, 1);
    this._geometry = new THREE.InstancedBufferGeometry();
    this._geometry.index = base.index;
    this._geometry.attributes.position = base.attributes.position;
    this._geometry.attributes.uv = base.attributes.uv;
    base.dispose();

    this._positionAttr = new THREE.InstancedBufferAttribute(
      this._positions,
      3,
    );
    this._positionAttr.setUsage(THREE.DynamicDrawUsage);
    this._geometry.setAttribute("instancePosition", this._positionAttr);

    const lengthAttr = new THREE.InstancedBufferAttribute(this._lengths, 1);
    lengthAttr.setUsage(THREE.StaticDrawUsage);
    this._geometry.setAttribute("instanceLen", lengthAttr);

    const widthAttr = new THREE.InstancedBufferAttribute(this._widths, 1);
    widthAttr.setUsage(THREE.StaticDrawUsage);
    this._geometry.setAttribute("instanceWid", widthAttr);

    this._geometry.instanceCount = 0;

    this._material = this._buildMaterial();

    this._mesh = new THREE.Mesh(this._geometry, this._material);
    this._mesh.frustumCulled = false;
    this._mesh.visible = false;
  }

  // ============================================
  // Material
  // ============================================

  private _buildMaterial(): THREE.MeshBasicNodeMaterial {
    const fallDirU = this._fallDir;
    const colorU = this._color;
    const opacityU = this._opacity;
    const maxLenU = this._maxLength;
    const maxWidU = this._maxWidth;
    const fadeDistanceU = this._fadeDistance;

    /**
     * Vertex: expand each instance center into a billboard quad.
     *
     * Right axis = normalize(cross(fallDir, toCam)) — perpendicular to both
     * the fall direction and the camera ray, so the face always points at the
     * camera regardless of wind tilt.
     *
     * Length axis = -fallDir — the quad stretches opposite to fall so the tip
     * hangs below the center and the tail extends above.
     */
    const positionNode = Fn(() => {
      const instancePos = attribute("instancePosition", "vec3");
      const instanceLen = attribute("instanceLen", "float");
      const instanceWid = attribute("instanceWid", "float");

      // Raw vertex position from the base PlaneGeometry (local XY space)
      const vtxX = attribute("position", "vec3").x;
      const vtxY = attribute("position", "vec3").y;

      const fall = vec3(fallDirU); // normalized fall direction (downward + wind)
      const toCam = normalize(cameraPosition.sub(instancePos));
      const right = normalize(cross(fall, toCam));

      // World-space streak half-extents
      const halfLen = mix(float(STREAK_LENGTH_MIN), maxLenU, instanceLen).mul(0.5);
      const halfWid = mix(float(STREAK_WIDTH_MIN), maxWidU, instanceWid).mul(0.5);

      // Clamp to a minimum world-space width so streaks never go sub-pixel at
      // distance. Factor 0.0003 ≈ tan(30°) / (2 × screenHeight) for ~0.5px min coverage
      // at 60° FOV / 1080p; small enough to leave close-range streaks unaffected.
      const distToCam = length(cameraPosition.sub(instancePos));
      const effectiveHalfWid = halfWid.max(distToCam.mul(0.0003));

      // Expand the quad around the instance center:
      //   vtxX ∈ [-0.5, 0.5] → spread along right axis
      //   vtxY ∈ [-0.5, 0.5] → spread along -fall (tail up, tip down)
      return instancePos
        .add(right.mul(vtxX).mul(effectiveHalfWid.mul(2.0)))
        .add(fall.negate().mul(vtxY).mul(halfLen.mul(2.0)));
    })();

    /**
     * Fragment: taper alpha at tip/tail, and fade out particles close to the
     * camera so overlapping near quads don't form bright additive sheets.
     */
    const opacityNode = Fn(() => {
      const instancePos = attribute("instancePosition", "vec3");
      const uvCoord = uv();

      // uv.y = 0 → top of quad (tail of streak)
      // uv.y = 1 → bottom of quad (tip of streak)
      const taperTail = smoothstep(float(0.0), float(0.2), uvCoord.y);
      const taperTip = smoothstep(float(1.0), float(0.75), uvCoord.y);

      const distToCam = length(instancePos.sub(cameraPosition));

      // Fade out streaks very close to the camera — near particles are large on
      // screen and additive-blend into solid bright sheets without this.
      const nearFade = smoothstep(float(NEAR_FADE_START), float(NEAR_FADE_END), distToCam);

      // Fade out streaks approaching the domain boundary so they dissolve
      // rather than wrap abruptly.
      const farFade = smoothstep(float(DOMAIN_HALF_XZ), fadeDistanceU, distToCam);

      return opacityU.mul(taperTail).mul(taperTip).mul(nearFade).mul(farFade);
    })();

    const material = new THREE.MeshBasicNodeMaterial();
    material.positionNode = positionNode;
    material.colorNode = vec3(colorU);
    material.opacityNode = opacityNode;
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    material.depthTest = false;
    material.side = THREE.DoubleSide;

    return material;
  }

  // ============================================
  // Public API
  // ============================================

  /** @internal The mesh to add to the scene. */
  getMesh(): THREE.Mesh {
    return this._mesh;
  }

  /** Whether particle rain is enabled. */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this._mesh.visible = value;
  }

  /** Rain streak tint color. */
  get color(): THREE.Color {
    return this._color.value;
  }

  set color(value: THREE.Color | string) {
    if (typeof value === "string") {
      this._color.value.set(value);
    } else {
      this._color.value.copy(value);
    }
  }

  /** Visual opacity of streaks (0–1). */
  get opacity(): number {
    return this._opacity.value;
  }

  set opacity(value: number) {
    this._opacity.value = value;
  }

  /** Fall speed multiplier (default 5.0). */
  get speed(): number {
    return this._speed;
  }

  set speed(value: number) {
    this._speed = value;
  }

  /** Maximum streak length in world units. */
  get streakLength(): number {
    return this._maxLength.value;
  }

  set streakLength(value: number) {
    this._maxLength.value = value;
  }

  /** Maximum streak width in world units. */
  get streakWidth(): number {
    return this._maxWidth.value;
  }

  set streakWidth(value: number) {
    this._maxWidth.value = value;
  }

  /** Distance (m) at which streaks begin fading toward the domain boundary. */
  get fadeDistance(): number {
    return this._fadeDistance.value;
  }

  set fadeDistance(value: number) {
    this._fadeDistance.value = value;
  }

  /** @internal Bulk-set parameters from a preset or params object. */
  update(params: RainParams): void {
    this.color = params.color;
    this.enabled = params.enabled;
    this.fadeDistance = params.fadeDistance;
    this.intensity = params.intensity;
    this.opacity = params.opacity;
    this.speed = params.speed;
    this.streakLength = params.streakLength;
    this.streakWidth = params.streakWidth;
  }

  /** Rain density (0–1). Maps linearly to active instance count. */
  get intensity(): number {
    return this._geometry.instanceCount / this._maxCount;
  }

  set intensity(value: number) {
    this._geometry.instanceCount = Math.round(
      Math.min(Math.max(value, 0), 1) * this._maxCount,
    );
  }

  // ============================================
  // Per-frame simulation
  // ============================================

  /**
   * @internal Simulate one frame: integrate positions, wrap domain, upload to GPU.
   */
  tick(
    deltaTime: number,
    camera: THREE.Camera,
    windDirection: number,
    windSpeed: number,
  ): void {
    if (!this._enabled) return;

    const windFactor =
      Math.min(windSpeed / WIND_SPEED_MAX, 1.0) * WIND_TILT_MAX;
    const fallSpeed = FALL_SPEED_BASE * this._speed;

    const vx = Math.cos(windDirection) * windFactor * fallSpeed;
    const vy = -fallSpeed;
    const vz = Math.sin(windDirection) * windFactor * fallSpeed;

    // Keep the fall-direction uniform in sync (normalized)
    const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
    this._fallDir.value.set(vx / len, vy / len, vz / len);

    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    // Clamp domain floor to the water surface so particles never go underwater.
    const domainMinY = Math.max(cy + DOMAIN_BOTTOM, 0);
    const domainMaxY = cy + DOMAIN_TOP;
    const domainRange = domainMaxY - domainMinY;

    // Scatter all particles uniformly within the domain on the first tick
    if (!this._initialized) {
      for (let i = 0; i < this._maxCount; i++) {
        const i3 = i * 3;
        this._positions[i3] = cx + (Math.random() * 2 - 1) * DOMAIN_HALF_XZ;
        this._positions[i3 + 1] = domainMinY + Math.random() * domainRange;
        this._positions[i3 + 2] = cz + (Math.random() * 2 - 1) * DOMAIN_HALF_XZ;
      }
      this._prevCameraPos.copy(camera.position);
      this._initialized = true;
    }

    // Cancel out camera translation so the distribution stays camera-relative
    // in all axes. Without this, camera movement leaves gaps that fill in
    // slowly via boundary wrapping, creating visible density bands.
    const dcx = cx - this._prevCameraPos.x;
    const dcy = cy - this._prevCameraPos.y;
    const dcz = cz - this._prevCameraPos.z;
    this._prevCameraPos.copy(camera.position);

    const activeCount = this._geometry.instanceCount;
    const dxDt = vx * deltaTime;
    const dyDt = vy * deltaTime;
    const dzDt = vz * deltaTime;

    for (let i = 0; i < activeCount; i++) {
      const i3 = i * 3;
      // Apply rain velocity minus camera displacement so particles stay
      // uniformly distributed around the camera in all axes.
      this._positions[i3]     += dxDt - dcx;
      this._positions[i3 + 1] += dyDt - dcy;
      this._positions[i3 + 2] += dzDt - dcz;

      if (this._positions[i3 + 1] < domainMinY) {
        // Wrap at domain bottom. Randomize Y across the full domain height so
        // particles that exit on the same frame don't stay in phase and create
        // visible horizontal density waves.
        this._positions[i3] = cx + (Math.random() * 2 - 1) * DOMAIN_HALF_XZ;
        this._positions[i3 + 1] = domainMinY + Math.random() * domainRange;
        this._positions[i3 + 2] = cz + (Math.random() * 2 - 1) * DOMAIN_HALF_XZ;
      } else {
        // Wrap XZ: particle has drifted outside horizontal domain
        const dx = this._positions[i3] - cx;
        const dz = this._positions[i3 + 2] - cz;
        if (Math.abs(dx) > DOMAIN_HALF_XZ || Math.abs(dz) > DOMAIN_HALF_XZ) {
          this._positions[i3] = cx + (Math.random() * 2 - 1) * DOMAIN_HALF_XZ;
          this._positions[i3 + 1] = domainMinY + Math.random() * domainRange;
          this._positions[i3 + 2] = cz + (Math.random() * 2 - 1) * DOMAIN_HALF_XZ;
        }
      }
    }

    this._positionAttr.needsUpdate = true;
  }

  /** Dispose GPU resources. */
  dispose(): void {
    this._geometry.dispose();
    this._material.dispose();
  }
}
