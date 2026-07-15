import type {Object3D} from 'three';

/** Legacy layer scrubbed from clipboard clones (formerly used by pmndrs OutlineEffect). */
export const SELECTION_OUTLINE_LAYER = 10;

/**
 * Remove the selection-outline render layer from a tree.
 *
 * Three.js `clone()` copies `layers.mask`, so clipboard prototypes and pasted
 * clones inherit layer 10 when the source was highlighted. The outline pass
 * renders every mesh on this layer, not only the current selection set.
 */
export function scrubSelectionOutlineLayers(
  root: Object3D,
  layer: number = SELECTION_OUTLINE_LAYER
): void {
  root.traverse((child) => {
    child.layers.disable(layer);
    child.layers.enable(0);
  });
}
