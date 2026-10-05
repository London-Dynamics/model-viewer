// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Parameter interfaces for sky uniform classes.
 */
import * as THREE from "three/webgpu";

export interface SunDiskParams {
  radius: number;
  color: THREE.Color;
  emissiveColor?: THREE.Color;
  emissiveIntensity: number;
}
