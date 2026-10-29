import {Vector3} from 'three';

/** Convert a world-space look-at point to model (pivot) space. */
export function worldTargetToModelSpace(scene: any, worldTarget: Vector3):
    Vector3 {
  const modelTarget = worldTarget.clone();
  if (scene?.modelPivot && typeof scene.modelPivot.worldToLocal === 'function') {
    scene.updateMatrixWorld(true);
    scene.modelPivot.worldToLocal(modelTarget);
  }
  return modelTarget;
}

/** Convert a model-space orbit center to world space. */
export function modelTargetToWorldSpace(scene: any, modelTarget: Vector3):
    Vector3 {
  const worldTarget = modelTarget.clone();
  if (scene?.modelPivot && typeof scene.modelPivot.localToWorld === 'function') {
    scene.updateMatrixWorld(true);
    scene.modelPivot.localToWorld(worldTarget);
  }
  return worldTarget;
}
