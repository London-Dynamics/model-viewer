import {Camera, Color, Object3D, Scene, Vector2} from 'three';
import {OutlinePass} from 'three/examples/jsm/postprocessing/OutlinePass.js';

export interface SelectionOutlineStyle {
  color: string;
  thickness: number;
}

export const DEFAULT_SELECTION_OUTLINE_STYLE: SelectionOutlineStyle = {
  color: '#165dfc',
  thickness: 1.5,
};

/** Clamp thickness to the same 0–5 range previously used by selection-outline-effect width. */
export function clampSelectionOutlineThickness(thickness: number): number {
  if (!Number.isFinite(thickness)) {
    return DEFAULT_SELECTION_OUTLINE_STYLE.thickness;
  }
  return Math.max(0, Math.min(5, thickness));
}

/**
 * Map LD thickness (0–5) onto OutlinePass edgeThickness / edgeStrength.
 * Values are calibrated to feel close to the old pmndrs blur kernelSize mapping.
 */
export function applySelectionOutlineStyle(
  pass: OutlinePass,
  style: SelectionOutlineStyle
): void {
  const thickness = clampSelectionOutlineThickness(style.thickness);
  const edgeColor = new Color(style.color || DEFAULT_SELECTION_OUTLINE_STYLE.color);
  pass.visibleEdgeColor.copy(edgeColor);
  pass.hiddenEdgeColor.copy(edgeColor);
  pass.edgeThickness = Math.max(0.5, thickness);
  pass.edgeStrength = 2 + thickness * 2;
  pass.edgeGlow = 0;
  pass.pulsePeriod = 0;
}

export function createSelectionOutlinePass(
  resolution: Vector2,
  scene: Scene,
  camera: Camera,
  style: SelectionOutlineStyle = DEFAULT_SELECTION_OUTLINE_STYLE
): OutlinePass {
  const pass = new OutlinePass(resolution, scene, camera, []);
  applySelectionOutlineStyle(pass, style);
  pass.enabled = false;
  return pass;
}

export function setSelectionOutlineObjects(
  pass: OutlinePass,
  objects: Object3D[]
): void {
  pass.selectedObjects = objects;
  pass.enabled = objects.length > 0;
}

/** Composers that can host a selection OutlinePass. */
export interface SelectionOutlineCapable {
  setSelectionOutlineSelection(objects: Object3D[]): void;
  setSelectionOutlineStyle(style: SelectionOutlineStyle): void;
  setSelectionOutlineEnabled(enabled: boolean): void;
}

export function isSelectionOutlineCapable(
  value: unknown
): value is SelectionOutlineCapable {
  return value != null &&
      typeof (value as SelectionOutlineCapable).setSelectionOutlineSelection ===
          'function' &&
      typeof (value as SelectionOutlineCapable).setSelectionOutlineStyle ===
          'function' &&
      typeof (value as SelectionOutlineCapable).setSelectionOutlineEnabled ===
          'function';
}
