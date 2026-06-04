/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import { Color, Object3D, PerspectiveCamera, Vector2 } from 'three';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';

import type { ModelScene } from '../../three-components/ModelScene.js';

import type { LDSelectionOutlineState } from './types.js';

export const DEFAULT_SELECTION_HIGHLIGHT_COLOR = '#165dfc';
export const DEFAULT_SELECTION_OUTLINE_WIDTH = 5;
export const DEFAULT_SELECTION_OUTLINE_EDGE_STRENGTH = 15;

export class SelectionOutlineModule {
  outlinePass: OutlinePass | null = null;
  private state: LDSelectionOutlineState = {
    enabled: false,
    color: DEFAULT_SELECTION_HIGHLIGHT_COLOR,
    width: DEFAULT_SELECTION_OUTLINE_WIDTH,
    edgeStrength: DEFAULT_SELECTION_OUTLINE_EDGE_STRENGTH,
    selectedMeshes: [],
  };

  setSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      return;
    }
    this.outlinePass?.setSize(width, height);
  }

  setState(state: Partial<LDSelectionOutlineState>): void {
    this.state = { ...this.state, ...state };
    this.applyState();
  }

  attach(
    scene: ModelScene,
    camera: PerspectiveCamera,
    resolution: Vector2
  ): OutlinePass {
    this.dispose();
    const outlinePass = new OutlinePass(resolution, scene, camera);
    this.outlinePass = outlinePass;
    this.applyState();
    return outlinePass;
  }

  private applyState(): void {
    const pass = this.outlinePass;
    if (pass == null) {
      return;
    }

    const color = new Color(this.state.color);
    pass.visibleEdgeColor.copy(color);
    pass.hiddenEdgeColor.copy(color);
    pass.edgeThickness = this.state.width;
    pass.edgeStrength = this.state.edgeStrength;
    pass.edgeGlow = 0;
    pass.pulsePeriod = 0;

    if (this.state.enabled && this.state.selectedMeshes.length > 0) {
      pass.selectedObjects = this.state.selectedMeshes;
      pass.enabled = true;
    } else {
      pass.selectedObjects = [];
      pass.enabled = false;
    }
  }

  dispose(): void {
    this.outlinePass?.dispose();
    this.outlinePass = null;
  }
}

export const collectSelectionMeshes = (objects: Object3D[]): Object3D[] => {
  const meshes: Object3D[] = [];
  for (const obj of objects) {
    obj.traverse((child) => {
      if ((child as Object3D & { isMesh?: boolean }).isMesh) {
        meshes.push(child);
      }
    });
  }
  return meshes;
};
