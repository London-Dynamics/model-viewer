// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import type { WakeDebugConfig, WakeDebugData } from "./index";

const DEFAULT_CONFIG: WakeDebugConfig = {
  markerSize: 1.5,
  activeColor: 0x00ccff,
  inactiveColor: 0x888888,
  ringSegments: 48,
};

/** Vertical struts joining the cylinder's two cap rings. Enough to read it as a
 * volume without crowding the curved cap rings. */
const CYLINDER_STRUTS = 16;

/** One generator's indicator: a centre marker and a footprint cylinder. */
interface WakeIndicator {
  group: THREE.Group;
  marker: THREE.Mesh;
  cylinder: THREE.LineSegments;
}

/**
 * Renders debug indicators for wake generators. For each generator it draws:
 *
 * - a marker sphere at the injection point, and
 * - a wireframe cylinder whose XZ radius is the footprint `radius` and whose
 *   height is the hull push-down `depth`, hanging from the waterline.
 *
 * The cylinder's top cap ring is the footprint disk; its height is how far the
 * hull pushes the water down — the two parameters read off as orthogonal axes.
 *
 * Active generators draw in the active colour, inactive ones dimmed. Mirrors
 * {@link BuoyancyDebugVisualizer}: pooled helpers driven each frame by
 * {@link WakeSystem.getDebugData}. The cylinder is a unit primitive scaled per
 * generator, so radius/depth changes show without rebuilding geometry.
 */
export class WakeDebugVisualizer {
  private scene: THREE.Scene;
  private config: WakeDebugConfig;
  private container: THREE.Group;
  private enabled = false;

  // Shared unit geometry, scaled per generator.
  private sphereGeometry: THREE.SphereGeometry;
  private cylinderGeometry: THREE.BufferGeometry; // unit cylinder, top ring at y=0, bottom at y=−1

  // One material per state; the marker reuses the line colour.
  private activeMaterial: THREE.MeshBasicMaterial;
  private inactiveMaterial: THREE.MeshBasicMaterial;
  private activeLineMaterial: THREE.LineBasicMaterial;
  private inactiveLineMaterial: THREE.LineBasicMaterial;

  private pool: WakeIndicator[] = [];

  constructor(scene: THREE.Scene, config: Partial<WakeDebugConfig> = {}) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.container = new THREE.Group();
    this.container.name = "WakeDebugVisualizer";
    this.container.visible = false;
    this.scene.add(this.container);

    this.sphereGeometry = new THREE.SphereGeometry(this.config.markerSize, 8, 6);
    this.cylinderGeometry = this.buildCylinderGeometry(
      this.config.ringSegments,
      CYLINDER_STRUTS,
    );

    // Always render on top — depth-testing off so generators stay visible
    // through the hull and water surface.
    this.activeMaterial = new THREE.MeshBasicMaterial({
      color: this.config.activeColor,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    this.inactiveMaterial = new THREE.MeshBasicMaterial({
      color: this.config.inactiveColor,
      depthTest: false,
      transparent: true,
      opacity: 0.6,
    });
    this.activeLineMaterial = new THREE.LineBasicMaterial({
      color: this.config.activeColor,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    this.inactiveLineMaterial = new THREE.LineBasicMaterial({
      color: this.config.inactiveColor,
      depthTest: false,
      transparent: true,
      opacity: 0.6,
    });
  }

  /** Enable or disable the debug visualization. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.container.visible = enabled;
    if (!enabled) {
      for (const ind of this.pool) ind.group.visible = false;
    }
  }

  /** Whether the visualization is currently enabled. */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update the indicators from the current generator snapshot.
   *
   * @param debugData - Per-generator data from {@link WakeSystem.getDebugData}.
   */
  update(debugData: WakeDebugData[]): void {
    if (!this.enabled) return;

    for (let i = 0; i < debugData.length; i++) {
      const gen = debugData[i];
      const ind = this.getIndicator(i);

      ind.group.position.copy(gen.position);
      // Unit cylinder hangs from y=0 to y=−1; scale XZ to the footprint radius
      // and Y to the push-down depth.
      ind.cylinder.scale.set(gen.radius, gen.depth, gen.radius);

      const fillMat = gen.active ? this.activeMaterial : this.inactiveMaterial;
      const lineMat = gen.active
        ? this.activeLineMaterial
        : this.inactiveLineMaterial;
      ind.marker.material = fillMat;
      ind.cylinder.material = lineMat;
      ind.group.visible = true;
    }

    for (let i = debugData.length; i < this.pool.length; i++) {
      this.pool[i].group.visible = false;
    }
  }

  /** Get an indicator from the pool, creating it if necessary. */
  private getIndicator(index: number): WakeIndicator {
    if (index < this.pool.length) return this.pool[index];

    const group = new THREE.Group();
    group.renderOrder = 1000;

    const marker = new THREE.Mesh(this.sphereGeometry, this.activeMaterial);
    marker.renderOrder = 1000;

    const cylinder = new THREE.LineSegments(
      this.cylinderGeometry,
      this.activeLineMaterial,
    );
    cylinder.renderOrder = 1000;

    group.add(marker, cylinder);
    this.container.add(group);

    const indicator: WakeIndicator = { group, marker, cylinder };
    this.pool.push(indicator);
    return indicator;
  }

  /**
   * Build a unit wireframe cylinder for a generator footprint: a cap ring at the
   * waterline (y = 0) and one at unit depth (y = −1), joined by vertical struts.
   * Radius 1 in XZ; scaling (radius, depth, radius) maps it to the generator's
   * footprint and push-down depth.
   */
  private buildCylinderGeometry(
    ringSegments: number,
    struts: number,
  ): THREE.BufferGeometry {
    const points: THREE.Vector3[] = [];

    // Cap rings at y=0 and y=−1, emitted as discrete segments (LineSegments).
    for (let i = 0; i < ringSegments; i++) {
      const a0 = (i / ringSegments) * Math.PI * 2;
      const a1 = ((i + 1) / ringSegments) * Math.PI * 2;
      const x0 = Math.cos(a0);
      const z0 = Math.sin(a0);
      const x1 = Math.cos(a1);
      const z1 = Math.sin(a1);
      points.push(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 0, z1));
      points.push(new THREE.Vector3(x0, -1, z0), new THREE.Vector3(x1, -1, z1));
    }

    // Vertical struts joining the two cap rings.
    for (let i = 0; i < struts; i++) {
      const a = (i / struts) * Math.PI * 2;
      const x = Math.cos(a);
      const z = Math.sin(a);
      points.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, -1, z));
    }

    return new THREE.BufferGeometry().setFromPoints(points);
  }

  /** Dispose of all GPU resources and detach from the scene. */
  dispose(): void {
    this.scene.remove(this.container);
    this.sphereGeometry.dispose();
    this.cylinderGeometry.dispose();
    this.activeMaterial.dispose();
    this.inactiveMaterial.dispose();
    this.activeLineMaterial.dispose();
    this.inactiveLineMaterial.dispose();
    this.pool = [];
  }
}
