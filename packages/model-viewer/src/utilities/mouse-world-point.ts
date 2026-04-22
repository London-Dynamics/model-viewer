import { Object3D, Raycaster, Vector2, Vector3 } from 'three';

type SceneLike = {
  camera?: any;
  target?: Object3D;
  boundingBox?: { min: { y: number } };
};

const SHARED_RAYCASTER = new Raycaster();
const SHARED_NDC = new Vector2();

export function getMouseWorldPointOnPlacementPlane(
  element: HTMLElement,
  scene: SceneLike,
  clientX: number,
  clientY: number
): Vector3 | null {
  if (!scene) return null;

  const camera = scene.camera;
  if (!camera) return null;

  const rect = element.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return null;

  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;

  SHARED_NDC.set((mouseX / rect.width) * 2 - 1, -(mouseY / rect.height) * 2 + 1);
  SHARED_RAYCASTER.setFromCamera(SHARED_NDC, camera);

  // Use scene.target's world Y position as the floor level.
  let placementY = 0;
  if (scene.target) {
    const targetWorldPos = new Vector3();
    scene.target.getWorldPosition(targetWorldPos);
    placementY = targetWorldPos.y;
  } else if (scene.boundingBox) {
    placementY = scene.boundingBox.min.y;
  }

  const dir = SHARED_RAYCASTER.ray.direction;
  const origin = SHARED_RAYCASTER.ray.origin;
  if (Math.abs(dir.y) <= 1e-6) return null;

  const t = (placementY - origin.y) / dir.y;
  if (t <= 0) return null;

  return origin.clone().addScaledVector(dir, t);
}
