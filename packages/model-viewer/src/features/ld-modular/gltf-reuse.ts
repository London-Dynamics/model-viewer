import type {Object3D} from 'three';

/**
 * Future: return a deep-cloned scene node for `src` if an identical model
 * is already in the scene, avoiding a network fetch.
 * Currently always returns null (always load).
 */
export function tryCloneExistingGltfScene(
  _src: string,
  _scene: Object3D,
  _options?: {partId?: string}
): Object3D | null {
  return null;
}
