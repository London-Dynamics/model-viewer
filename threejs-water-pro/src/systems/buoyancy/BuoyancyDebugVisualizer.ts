// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import type { BuoyancyDebugData, BuoyancyDebugConfig } from "./types";

const DEFAULT_CONFIG: BuoyancyDebugConfig = {
  markerSize: 2.0,
  arrowLength: 15,
  markerColor: 0x00ff00,
  arrowColor: 0xffff00,
  centerMarkerColor: 0xff0000,
};

/**
 * BuoyancyDebugVisualizer renders debug visualizations for the buoyancy system.
 *
 * Shows:
 * - Spheres at each sample point (center, bow, stern, port, starboard)
 * - Arrows indicating surface normals at each point
 * - Different colors for center vs. other sample points
 */
export class BuoyancyDebugVisualizer {
  private scene: THREE.Scene;
  private config: BuoyancyDebugConfig;
  private container: THREE.Group;
  private enabled: boolean = false;

  // Reusable geometry and materials
  private sphereGeometry: THREE.SphereGeometry;
  private centerMaterial: THREE.MeshBasicMaterial;
  private pointMaterial: THREE.MeshBasicMaterial;

  // Pool of visual helpers
  private markerPool: THREE.Mesh[] = [];
  private arrowPool: THREE.ArrowHelper[] = [];
  private activeMarkerCount: number = 0;
  private activeArrowCount: number = 0;

  constructor(scene: THREE.Scene, config: Partial<BuoyancyDebugConfig> = {}) {
    this.scene = scene;
    this.config = { ...DEFAULT_CONFIG, ...config };

    this.container = new THREE.Group();
    this.container.name = "BuoyancyDebugVisualizer";
    this.container.visible = false;
    this.scene.add(this.container);

    this.sphereGeometry = new THREE.SphereGeometry(this.config.markerSize, 8, 6);
    this.centerMaterial = new THREE.MeshBasicMaterial({
      color: this.config.centerMarkerColor,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.8,
    });
    this.pointMaterial = new THREE.MeshBasicMaterial({
      color: this.config.markerColor,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 0.8,
    });
  }

  /**
   * Enable or disable the debug visualization
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.container.visible = enabled;

    if (!enabled) {
      this.hideAllHelpers();
    }
  }

  /**
   * Update the scale of debug markers and arrows
   * @param scale Scale factor (1.0 = default size)
   */
  public setScale(scale: number): void {
    this.config.markerSize = 2.0 * scale;
    this.config.arrowLength = 15 * scale;

    // Recreate sphere geometry with new size
    this.sphereGeometry.dispose();
    this.sphereGeometry = new THREE.SphereGeometry(this.config.markerSize, 8, 6);

    for (const marker of this.markerPool) {
      marker.geometry = this.sphereGeometry;
    }

    for (const arrow of this.arrowPool) {
      arrow.setLength(this.config.arrowLength);
    }
  }

  /**
   * Check if visualization is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Update the debug visualization with current sample data
   * @param debugData Array of debug data for each buoyant object
   */
  public update(debugData: BuoyancyDebugData[]): void {
    if (!this.enabled) return;

    this.activeMarkerCount = 0;
    this.activeArrowCount = 0;

    for (const objData of debugData) {
      for (let i = 0; i < objData.samplePoints.length; i++) {
        const point = objData.samplePoints[i];
        const isCenter = point.label === "center";

        const marker = this.getMarker(this.activeMarkerCount);
        marker.position.set(point.position.x, point.height, point.position.z);
        marker.material = isCenter ? this.centerMaterial : this.pointMaterial;
        marker.visible = true;
        this.activeMarkerCount++;

        const arrow = this.getArrow(this.activeArrowCount);
        arrow.position.set(point.position.x, point.height, point.position.z);
        arrow.setDirection(point.normal.clone().normalize());
        arrow.setLength(this.config.arrowLength);
        arrow.visible = true;
        this.activeArrowCount++;
      }
    }

    for (let i = this.activeMarkerCount; i < this.markerPool.length; i++) {
      this.markerPool[i].visible = false;
    }
    for (let i = this.activeArrowCount; i < this.arrowPool.length; i++) {
      this.arrowPool[i].visible = false;
    }
  }

  /**
   * Get a marker from the pool, creating if necessary
   */
  private getMarker(index: number): THREE.Mesh {
    if (index >= this.markerPool.length) {
      const marker = new THREE.Mesh(this.sphereGeometry, this.pointMaterial);
      marker.renderOrder = 1000; // Render on top
      this.markerPool.push(marker);
      this.container.add(marker);
    }
    return this.markerPool[index];
  }

  /**
   * Get an arrow from the pool, creating if necessary
   */
  private getArrow(index: number): THREE.ArrowHelper {
    if (index >= this.arrowPool.length) {
      const arrow = new THREE.ArrowHelper(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(0, 0, 0),
        this.config.arrowLength,
        this.config.arrowColor
      );
      arrow.renderOrder = 1000; // Render on top
      this.arrowPool.push(arrow);
      this.container.add(arrow);
    }
    return this.arrowPool[index];
  }

  /**
   * Hide all helpers
   */
  private hideAllHelpers(): void {
    for (const marker of this.markerPool) {
      marker.visible = false;
    }
    for (const arrow of this.arrowPool) {
      arrow.visible = false;
    }
  }

  /**
   * Dispose of all resources
   */
  public dispose(): void {
    this.scene.remove(this.container);

    this.sphereGeometry.dispose();
    this.centerMaterial.dispose();
    this.pointMaterial.dispose();

    // Markers share the same sphereGeometry, which is disposed above.
    // Do not dispose marker.geometry individually to avoid double-dispose.
    for (const arrow of this.arrowPool) {
      arrow.dispose();
    }

    this.markerPool = [];
    this.arrowPool = [];
  }
}
