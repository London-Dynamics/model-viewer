/**
 * Spray probe debug visualizer.
 *
 * For each registered probe, renders:
 *   - A wireframe sphere at the probe's world position. Sphere size is a
 *     fixed visualization constant (`config.sphereRadius`) — probes
 *     themselves don't carry a radius. Colour reflects the probe's
 *     lifecycle state:
 *         grey    — `disabled`   (probe's `enabled` flag is off)
 *         blue    — `inactive`   (not eligible to fire this frame)
 *         green   — `playing`    (a billboard's flipbook is on screen)
 *         yellow  — `respawning` (waiting for the cooldown to expire)
 *   - An arrow along the probe's instantaneous world velocity (rigid-body
 *     linear + angular). Length scales with speed; reads at a glance how
 *     fast each probe is moving relative to the world. Probes with
 *     near-zero velocity collapse to a stub. Note that the emission gate
 *     fires on probe-vs-surface convergence rate (impact speed), not
 *     probe speed, so a stationary probe can still fire when a wave
 *     rises onto it.
 *
 * Pool-based: meshes are reused frame-to-frame, only updated. Per-frame
 * cost is small even with many probes; debug-only.
 *
 * Mirrors the `BuoyancyDebugVisualizer` pattern. Owned by the demo (or any
 * external caller); the spray library exposes `getProbeDebugData()` and
 * the visualizer renders the snapshot.
 */

import * as THREE from "three/webgpu";
import type { ProbeDebugSnapshot, ProbeState } from "./EmitterRegistry";

export interface SprayDebugConfig {
  /** Arrow length (m) per 1 m/s of probe speed. Default `0.3`. */
  arrowLengthPerSpeed: number;
  /**
   * Maximum arrow length (m). Caps the velocity-driven length so arrows
   * stay readable on probes moving at extreme speeds. Default `12.0`.
   */
  arrowMaxLength: number;
  /** Colour when probe's `enabled` flag is off. */
  disabledColor: number;
  /** Colour when probe is inactive (not firing). */
  inactiveColor: number;
  /** Colour when a billboard's flipbook is currently playing. */
  playingColor: number;
  /** Colour when probe is in the respawn cooldown. */
  respawningColor: number;
  /** Wireframe sphere radius (m). Visualization-only constant. Default `0.6`. */
  sphereRadius: number;
  /** Sphere wireframe segment count (low = ugly, high = expensive). Default 8. */
  sphereSegments: number;
}

const DEFAULT_CONFIG: SprayDebugConfig = {
  arrowLengthPerSpeed: 0.3,
  arrowMaxLength: 12.0,
  disabledColor: 0x666666,
  inactiveColor: 0x4488ff,
  playingColor: 0x44ff44,
  respawningColor: 0xffcc00,
  sphereRadius: 0.6,
  sphereSegments: 8,
};

export class SprayDebugVisualizer {
  private _scene: THREE.Scene;
  private _config: SprayDebugConfig;
  private _container: THREE.Group;
  private _enabled = false;

  private _spherePool: THREE.Mesh[] = [];
  private _arrowPool: THREE.ArrowHelper[] = [];
  private _activeCount = 0;

  private _sphereGeometry: THREE.SphereGeometry;
  private _stateMaterials: Record<ProbeState, THREE.MeshBasicMaterial>;
  private _stateColors: Record<ProbeState, THREE.Color>;

  constructor(scene: THREE.Scene, config: Partial<SprayDebugConfig> = {}) {
    this._scene = scene;
    this._config = { ...DEFAULT_CONFIG, ...config };

    this._container = new THREE.Group();
    this._container.name = "SprayDebugVisualizer";
    this._container.visible = false;
    this._scene.add(this._container);

    this._sphereGeometry = new THREE.SphereGeometry(
      1.0,
      this._config.sphereSegments,
      this._config.sphereSegments,
    );

    const makeMaterial = (color: number, opacity: number) =>
      new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        depthTest: true,
        depthWrite: false,
        transparent: true,
        opacity,
      });

    this._stateMaterials = {
      disabled: makeMaterial(this._config.disabledColor, 0.4),
      inactive: makeMaterial(this._config.inactiveColor, 0.6),
      playing: makeMaterial(this._config.playingColor, 0.9),
      respawning: makeMaterial(this._config.respawningColor, 0.8),
    };
    this._stateColors = {
      disabled: new THREE.Color(this._config.disabledColor),
      inactive: new THREE.Color(this._config.inactiveColor),
      playing: new THREE.Color(this._config.playingColor),
      respawning: new THREE.Color(this._config.respawningColor),
    };
  }

  /** Whether the debug visualization is enabled. */
  isEnabled(): boolean {
    return this._enabled;
  }

  /** Enable or disable the visualization. */
  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this._container.visible = enabled;
    if (!enabled) this._hideAll();
  }

  /**
   * Push a fresh snapshot of probe states into the visualizer. Typically
   * called once per frame from the demo's render loop with
   * `water.spray.getProbeDebugData()`.
   */
  update(snapshots: ProbeDebugSnapshot[]): void {
    if (!this._enabled) return;

    const need = snapshots.length;

    while (this._spherePool.length < need) {
      const mesh = new THREE.Mesh(
        this._sphereGeometry,
        this._stateMaterials.inactive,
      );
      this._container.add(mesh);
      this._spherePool.push(mesh);
    }
    while (this._arrowPool.length < need) {
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 0),
        1,
        this._config.inactiveColor,
        0.3,
        0.2,
      );
      this._container.add(arrow);
      this._arrowPool.push(arrow);
    }

    const arrowDir = new THREE.Vector3();
    for (let i = 0; i < need; i++) {
      const s = snapshots[i];
      const sphere = this._spherePool[i];
      const arrow = this._arrowPool[i];

      sphere.position.copy(s.worldPosition);
      sphere.scale.setScalar(this._config.sphereRadius);
      sphere.material = this._stateMaterials[s.state];
      sphere.visible = true;

      arrow.position.copy(s.worldPosition);
      if (s.speed > 1e-4) {
        arrowDir.copy(s.worldVelocity).divideScalar(s.speed);
      } else {
        arrowDir.set(0, 1, 0);
      }
      arrow.setDirection(arrowDir);
      const length = Math.min(
        this._config.arrowMaxLength,
        s.speed * this._config.arrowLengthPerSpeed,
      );
      arrow.setLength(length, length * 0.25, length * 0.18);
      arrow.setColor(this._stateColors[s.state]);
      arrow.visible = true;
    }

    for (let i = need; i < this._activeCount; i++) {
      this._spherePool[i].visible = false;
      this._arrowPool[i].visible = false;
    }
    this._activeCount = need;
  }

  /** Free GPU resources. */
  dispose(): void {
    this._scene.remove(this._container);
    for (const m of this._spherePool) {
      this._container.remove(m);
    }
    for (const a of this._arrowPool) {
      this._container.remove(a);
    }
    this._spherePool.length = 0;
    this._arrowPool.length = 0;
    this._sphereGeometry.dispose();
    for (const mat of Object.values(this._stateMaterials)) {
      mat.dispose();
    }
  }

  private _hideAll(): void {
    for (const m of this._spherePool) m.visible = false;
    for (const a of this._arrowPool) a.visible = false;
    this._activeCount = 0;
  }
}
