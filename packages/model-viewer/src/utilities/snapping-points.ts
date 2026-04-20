import {
  Box3,
  Object3D,
  Vector3,
  Mesh,
  SphereGeometry,
  Group,
  RingGeometry,
  MeshBasicMaterial,
  Camera,
  Raycaster,
  Vector2,
} from 'three';
import type { SnapPoint } from '@london-dynamics/types/planner';

export const SNAP_POINT_DIAMETER = 0.1; // Diameter of snap point spheres in meters
export const DEFAULT_SNAP_RADIUS = SNAP_POINT_DIAMETER * 2;
export type SurfaceType = 'floor' | 'wall' | 'ceiling';

type SnapPointUsageChecker = (
  object: Object3D,
  snapPoint: SnapPoint
) => boolean;

const DEFAULT_LOCAL_POSITION: [number, number, number] = [0, 0, 0];
const DEFAULT_LOCAL_ROTATION: [number, number, number] = [0, 0, 0];

function getVerticalConstraintValue(
  snapPoint: SnapPoint,
  preferredKey: 'minFromFloor' | 'maxFromFloor',
  legacyKey: 'min' | 'max'
): number | undefined {
  const constraint = (snapPoint as any)?.verticalConstraint;
  if (!constraint) return undefined;
  const preferred = constraint[preferredKey];
  if (typeof preferred === 'number') return preferred;
  const legacy = constraint[legacyKey];
  return typeof legacy === 'number' ? legacy : undefined;
}

export function getSurfaceSnapPoints(object: Object3D): SnapPoint[] {
  const snapPoints = object.userData?.snapPoints as SnapPoint[] | undefined;
  if (!Array.isArray(snapPoints)) return [];
  return snapPoints.filter((snapPoint) => !!(snapPoint as any)?.surfaceSnap);
}

export function getPrimarySurfaceSnapPoint(object: Object3D): SnapPoint | null {
  const points = getSurfaceSnapPoints(object);
  return points.length > 0 ? points[0] : null;
}

export function requiresSurfaceSnap(object: Object3D): boolean {
  return getSurfaceSnapPoints(object).length > 0;
}

export function allowsSurfaceType(
  snapPoint: SnapPoint,
  surfaceType: SurfaceType
): boolean {
  const surfaces = (snapPoint as any)?.allowedSurfaces as
    | SurfaceType[]
    | undefined;
  if (!surfaces || surfaces.length === 0) return true;
  return surfaces.includes(surfaceType);
}

export function getSurfaceSnapOffset(snapPoint: SnapPoint): number {
  const offset = (snapPoint as any)?.surfaceSnap?.offset;
  if (typeof offset !== 'number' || !Number.isFinite(offset)) {
    return 0;
  }
  return Math.max(offset, 0);
}

export function getMinFromFloorConstraint(snapPoint: SnapPoint): number | undefined {
  return getVerticalConstraintValue(snapPoint, 'minFromFloor', 'min');
}

export function getMaxFromFloorConstraint(snapPoint: SnapPoint): number | undefined {
  return getVerticalConstraintValue(snapPoint, 'maxFromFloor', 'max');
}

function getSnapPointLocalPosition(snapPoint: SnapPoint): Vector3 {
  const [x, y, z] = snapPoint.transform?.position ?? DEFAULT_LOCAL_POSITION;
  return new Vector3(x, y, z);
}

function getSnapPointLocalRotation(snapPoint: SnapPoint): [number, number, number] {
  return snapPoint.transform?.rotation ?? DEFAULT_LOCAL_ROTATION;
}

/**
 * Generate default snap points on the middle of each side of the bounding box.
 * Creates snap points on front, back, left, and right sides (not top or bottom).
 */
export function generateDefaultSnappingPoints(
  object: Object3D
): SnapPoint[] {
  const boundingBox = new Box3().setFromObject(object);
  const center = boundingBox.getCenter(new Vector3());
  const size = boundingBox.getSize(new Vector3());

  // Convert to local coordinates relative to object center
  const localCenter = object.worldToLocal(center.clone());

  return [
    // Front side (positive Z)
    {
      id: 'front',
      transform: {
        position: [localCenter.x, localCenter.y, localCenter.z + size.z / 2],
        rotation: [0, 0, 0],
      },
      snapRadius: DEFAULT_SNAP_RADIUS,
    },
    // Back side (negative Z)
    {
      id: 'back',
      transform: {
        position: [localCenter.x, localCenter.y, localCenter.z - size.z / 2],
        rotation: [0, Math.PI, 0],
      },
      snapRadius: DEFAULT_SNAP_RADIUS,
    },
    // Right side (positive X)
    {
      id: 'right',
      transform: {
        position: [localCenter.x + size.x / 2, localCenter.y, localCenter.z],
        rotation: [0, Math.PI / 2, 0],
      },
      snapRadius: DEFAULT_SNAP_RADIUS,
    },
    // Left side (negative X)
    {
      id: 'left',
      transform: {
        position: [localCenter.x - size.x / 2, localCenter.y, localCenter.z],
        rotation: [0, -Math.PI / 2, 0],
      },
      snapRadius: DEFAULT_SNAP_RADIUS,
    },
  ];
}

/**
 * Create snap point visualizations for a specific object.
 * @param object The object to add snap points to
 * @param cameraProvider Function that returns the current camera for lookAt functionality
 * @param sphereTracker Set to track all created sphere meshes
 */
export function createSnappingPointsForObject(
  object: Object3D,
  cameraProvider: () => Camera | null,
  sphereTracker: Set<Mesh>
) {
  if (!object.userData.snapPoints) return;

  const snappingPoints = object.userData.snapPoints as SnapPoint[];

  snappingPoints.forEach((snapPoint) => {
    // Create a group to hold both the base sphere and camera-facing outline circles
    const snapPointGroup = new Group();
    snapPointGroup.position.copy(getSnapPointLocalPosition(snapPoint));
    const [rx, ry, rz] = getSnapPointLocalRotation(snapPoint);
    snapPointGroup.rotation.set(rx, ry, rz);
    snapPointGroup.name = 'SnappingPointSphere';

    // Create main bright white sphere (base)
    const sphereGeometry = new SphereGeometry(SNAP_POINT_DIAMETER / 2, 16, 12);
    const sphereMaterial = new MeshBasicMaterial({
      color: 0xffffff, // Bright white
      transparent: true,
      opacity: 0.9,
      depthTest: false, // Always render on top
    });
    const sphere = new Mesh(sphereGeometry, sphereMaterial);
    sphere.renderOrder = 999; // High render order to ensure it renders on top
    snapPointGroup.add(sphere);

    // Create camera-facing dark outline circles for better visibility
    // These will always face the camera and provide clear contrast
    const outlineRadius = (SNAP_POINT_DIAMETER / 2) * 1.15; // Slightly larger than sphere
    const outlineRingGeometry = new RingGeometry(
      outlineRadius * 0.85, // Inner radius - creates a thin ring
      outlineRadius, // Outer radius
      16 // Segments for smooth circle
    );
    const outlineRingMaterial = new MeshBasicMaterial({
      color: 0x000000, // Black outline
      transparent: true,
      opacity: 0.7,
      side: 2, // DoubleSide to ensure visibility from any angle
      depthTest: false, // Always render on top
    });
    const outlineRing = new Mesh(outlineRingGeometry, outlineRingMaterial);
    outlineRing.renderOrder = 1000; // Slightly higher than sphere to render on top of it

    // Make the ring always face the camera with simple lookAt
    outlineRing.onBeforeRender = function (_renderer, _scene, camera) {
      try {
        // Get camera from provider or use the passed camera
        const activeCamera = cameraProvider() || camera;
        if (!activeCamera) return;
        if (!this.visible || !this.parent?.visible) return;

        // Get camera world position
        const cameraPosition = new Vector3();
        activeCamera.getWorldPosition(cameraPosition);

        // Make ring look at camera - simple and effective
        this.lookAt(cameraPosition);
      } catch (error) {
        // Silently handle any errors to prevent disrupting the render loop
      }
    };

    snapPointGroup.add(outlineRing);

    // Add group directly to the object so it moves with it
    object.add(snapPointGroup);
    sphereTracker.add(sphere);
    sphereTracker.add(outlineRing);
  });
}

/**
 * Remove snap point visualizations from a specific object.
 */
export function removeSnappingPointsFromObject(
  object: Object3D,
  sphereTracker: Set<Mesh>
) {
  const groupsToRemove: Group[] = [];

  object.traverse((child) => {
    if (child.name === 'SnappingPointSphere' && child instanceof Group) {
      groupsToRemove.push(child);
    }
  });

  groupsToRemove.forEach((group) => {
    // Dispose of all meshes in the group
    group.traverse((child) => {
      if (child instanceof Mesh) {
        sphereTracker.delete(child);
        child.geometry.dispose();
        if (child.material instanceof MeshBasicMaterial) {
          child.material.dispose();
        }
      }
    });
    object.remove(group);
  });
}

/**
 * Set visibility of snap points for a specific object.
 */
export function setSnappingPointsVisibility(
  object: Object3D,
  visible: boolean
) {
  object.traverse((child) => {
    if (child.name === 'SnappingPointSphere' && child instanceof Group) {
      child.visible = visible;
    }
  });
}

/**
 * Refresh the camera-facing orientation of snapping points for an object.
 * This ensures the rings properly face the camera after being shown/hidden.
 */
export function refreshSnappingPointOrientation(
  object: Object3D,
  camera: Camera
) {
  if (!camera) return;

  const cameraPosition = new Vector3();
  camera.getWorldPosition(cameraPosition);

  object.traverse((child) => {
    if (child.name === 'SnappingPointSphere' && child instanceof Group) {
      child.traverse((grandchild) => {
        if (
          grandchild instanceof Mesh &&
          grandchild.geometry instanceof RingGeometry
        ) {
          // Force the ring to face the camera immediately using lookAt
          try {
            grandchild.lookAt(cameraPosition);
          } catch (error) {
            // Silently handle errors
          }
        }
      });
    }
  });
}

/**
 * Check if an object has snapping point visualizations.
 */
export function hasSnappingPointVisualizations(object: Object3D): boolean {
  let hasSnappingPoints = false;
  object.traverse((child) => {
    if (child.name === 'SnappingPointSphere') {
      hasSnappingPoints = true;
    }
  });
  return hasSnappingPoints;
}

/**
 * Show snap points for all objects that have snap points.
 */
export function showAllSnappingPoints(
  rootObject: Object3D,
  cameraProvider: () => Camera | null,
  sphereTracker: Set<Mesh>
) {
  if (!rootObject) return;

  // Find all objects with snap points and create visualization spheres if they don't exist
  rootObject.traverse((child) => {
    if (child.userData.isPlacedObject && child.userData.snapPoints) {
      // Only create snapping points if they don't already exist
      if (!hasSnappingPointVisualizations(child)) {
        createSnappingPointsForObject(child, cameraProvider, sphereTracker);
      } else {
        // Make existing snapping points visible and refresh camera-facing logic
        setSnappingPointsVisibility(child, true);
        const camera = cameraProvider();
        if (camera) {
          refreshSnappingPointOrientation(child, camera);
        }
      }
    }
  });
}

/**
 * Hide all snap point visualizations.
 */
export function hideAllSnappingPoints(rootObject: Object3D) {
  if (!rootObject) return;

  // Hide snap points from all objects instead of removing them
  rootObject.traverse((child) => {
    if (child.userData.isPlacedObject) {
      setSnappingPointsVisibility(child, false);
    }
  });
}

/**
 * Get world position of a snapping point on an object
 */
export function getSnappingPointWorldPosition(
  object: Object3D,
  snapPoint: SnapPoint
): Vector3 {
  return object.localToWorld(getSnapPointLocalPosition(snapPoint));
}

// Private function to check if two snapping points are compatible (accepts/provides)
function snappingPointsAreCompatible(
  draggedPoint: SnapPoint,
  targetPoint: SnapPoint
): boolean {
  // If targetPoint.accepts is empty or not defined, accept anything
  if (!targetPoint.accepts || targetPoint.accepts.length === 0) {
    return true;
  }
  // draggedPoint.provides must have at least one value in targetPoint.accepts
  if (!draggedPoint.provides || draggedPoint.provides.length === 0) {
    return false;
  }
  return draggedPoint.provides.some((type) =>
    targetPoint.accepts!.includes(type)
  );
}

/**
 * Find potential snapping connections between two objects
 */
export function findSnappingConnections(
  draggedObject: Object3D,
  targetObject: Object3D,
  isPointUsed?: SnapPointUsageChecker
): Array<{
  draggedPoint: SnapPoint;
  targetPoint: SnapPoint;
  distance: number;
}> {
  if (!draggedObject.userData.snapPoints || !targetObject.userData.snapPoints) {
    return [];
  }

  const draggedPoints = draggedObject.userData.snapPoints as SnapPoint[];
  const targetPoints = targetObject.userData.snapPoints as SnapPoint[];
  const connections: Array<{
    draggedPoint: SnapPoint;
    targetPoint: SnapPoint;
    distance: number;
  }> = [];

  draggedPoints.forEach((draggedPoint) => {
    if (isPointUsed?.(draggedObject, draggedPoint)) return;

    targetPoints.forEach((targetPoint) => {
      if (isPointUsed?.(targetObject, targetPoint)) return;

      // Check if accepts/provides match
      if (!snappingPointsAreCompatible(draggedPoint, targetPoint)) return;

      const draggedWorldPos = getSnappingPointWorldPosition(
        draggedObject,
        draggedPoint
      );
      const targetWorldPos = getSnappingPointWorldPosition(
        targetObject,
        targetPoint
      );
      const distance = draggedWorldPos.distanceTo(targetWorldPos);

      const draggedAttraction = draggedPoint.snapRadius ?? DEFAULT_SNAP_RADIUS;
      const targetAttraction = targetPoint.snapRadius ?? DEFAULT_SNAP_RADIUS;
      const maxAttraction = Math.max(draggedAttraction, targetAttraction);

      if (distance <= maxAttraction) {
        connections.push({
          draggedPoint,
          targetPoint,
          distance,
        });
      }
    });
  });

  // Sort by distance (closest first)
  return connections.sort((a, b) => a.distance - b.distance);
}

export function findCompatibleSnappingPoints(
  snapPoint: SnapPoint,
  targetObject: Object3D,
  isPointUsed?: (snapPoint: SnapPoint) => boolean
): SnapPoint[] {
  if (!targetObject.userData.snapPoints) {
    return [];
  }
  const targetSnappingPoints = targetObject.userData.snapPoints as SnapPoint[];
  return targetSnappingPoints.filter(
    (targetSnapPoint) =>
      !isPointUsed?.(targetSnapPoint) &&
      snappingPointsAreCompatible(snapPoint, targetSnapPoint)
  );
}

export function findSnappingPointUnderMouse(
  mouseX: number,
  mouseY: number,
  camera: Camera,
  rootObject: Object3D,
  viewport?: { width: number; height: number; left: number; top: number },
  isPointUsed?: SnapPointUsageChecker
): [SnapPoint, Object3D] | null {
  const raycaster = new Raycaster();

  // If viewport is provided, use it; otherwise fall back to window dimensions
  let normalizedX: number;
  let normalizedY: number;

  if (viewport) {
    // Convert mouse coordinates relative to the viewport
    normalizedX = ((mouseX - viewport.left) / viewport.width) * 2 - 1;
    normalizedY = -((mouseY - viewport.top) / viewport.height) * 2 + 1;
  } else {
    // Fallback to window dimensions (original behavior)
    normalizedX = (mouseX / window.innerWidth) * 2 - 1;
    normalizedY = -(mouseY / window.innerHeight) * 2 + 1;
  }

  const mouse = new Vector2(normalizedX, normalizedY);

  raycaster.setFromCamera(mouse, camera);
  const ray = raycaster.ray;

  let closestSnapPoint: SnapPoint | null = null;
  let closestDistance = Infinity;
  let obj: Object3D | null = null;

  // Traverse all objects with snapping points
  rootObject.traverse((c) => {
    if (c.userData && c.userData.snapPoints) {
      const snappingPoints = c.userData.snapPoints as SnapPoint[];
      snappingPoints.forEach((snapPoint) => {
        if (isPointUsed?.(c, snapPoint)) return;

        // Get world position of the snap point
        const worldPos = getSnappingPointWorldPosition(c, snapPoint);
        // Compute distance from ray to point
        // Formula: |(rayOrigin - point) x rayDirection| / |rayDirection|
        const toPoint = new Vector3().subVectors(worldPos, ray.origin);
        const cross = new Vector3().crossVectors(toPoint, ray.direction);
        const distance = cross.length() / ray.direction.length();
        const snapRadius = snapPoint.snapRadius ?? DEFAULT_SNAP_RADIUS;

        if (distance <= snapRadius && distance < closestDistance) {
          closestDistance = distance;
          closestSnapPoint = snapPoint;
          obj = c;
        }
      });
    }
  });

  return closestSnapPoint && obj ? [closestSnapPoint, obj] : null;
}

/**
 * Create a snapped group from two objects
 */
export function createSnappedGroup(
  object1: Object3D,
  object2: Object3D,
  snapPoint1: SnapPoint,
  snapPoint2: SnapPoint
): Object3D {
  // Create a new group to contain both objects - use Group type for proper recognition
  const group = new Group();
  group.name = `SnappedGroup_${Date.now()}`;
  group.userData.isSnappedGroup = true;
  group.userData.snapConnections = [
    {
      object1,
      object2,
      snapPoint1: { ...snapPoint1 },
      snapPoint2: { ...snapPoint2 },
    },
  ];

  // Calculate the midpoint of the two objects' positions to set as group position
  // Do this BEFORE any reparenting operations
  const groupPosition = new Vector3()
    .addVectors(object1.position, object2.position)
    .multiplyScalar(0.5);

  // Add group to parent first
  const parent = object1.parent;
  if (parent) {
    parent.add(group);
  }

  // Set the group's position in the parent's coordinate space
  group.position.copy(groupPosition);

  // Update matrix so attach() works correctly
  group.updateMatrixWorld(true);

  // Use attach() to move objects to the group while preserving world transforms
  // attach() automatically removes objects from their current parent
  object1.updateMatrixWorld(true);
  object2.updateMatrixWorld(true);
  group.attach(object1);
  group.attach(object2);

  // Keep source snap point data immutable; runtime usage is inferred from
  // connection records instead of mutating SnapPoint payloads.

  // Copy userData from one of the objects to maintain properties, but exclude snapping points
  group.userData = { ...object1.userData, ...group.userData };
  group.userData.isPlacedObject = true;

  try {
    console.debug('[snapping] createSnappedGroup', {
      groupName: group.name,
      object1: object1.name || object1.uuid,
      object2: object2.name || object2.uuid,
      snapConnections: group.userData.snapConnections,
    });
  } catch (e) {}

  // Ensure the group itself doesn't have snapping points - only its children should
  delete group.userData.snapPoints;

  // Mark child objects to not be treated as standalone placed objects in snapping point visualization
  // but preserve their snapping points for after ungrouping
  object1.userData.isInGroup = true;
  object2.userData.isInGroup = true;

  // Cache meshes for outline system performance
  group.userData.meshes = [];
  group.traverse((child) => {
    if (child.type === 'Mesh' && !isSnappingPointMesh(child)) {
      group.userData.meshes.push(child);
    }
  });

  return group;
}

/**
 * Check if a mesh is part of a snapping point visualization
 */
function isSnappingPointMesh(mesh: Object3D): boolean {
  // Check if the mesh itself is named as a snapping point
  if (mesh.name === 'SnappingPointSphere') {
    return true;
  }

  // Check if the mesh is a child of a snapping point group
  let parent = mesh.parent;
  while (parent) {
    if (parent.name === 'SnappingPointSphere') {
      return true;
    }
    parent = parent.parent;
  }

  return false;
}

/**
 * Check if an object is part of a snapped group
 */
export function isInSnappedGroup(object: Object3D): boolean {
  const parent = object.parent;
  if (!parent || !parent.userData) return false;
  return (
    parent.userData.isSnappedGroup === true || parent.userData.isGroup === true
  );
}

/**
 * Get the snapped group containing an object, if any
 */
export function getSnappedGroup(object: Object3D): Object3D | null {
  if (object.userData) {
    if (object.userData.isSnappedGroup || object.userData.isGroup)
      return object;
  }
  if (object.parent && object.parent.userData) {
    if (
      object.parent.userData.isSnappedGroup === true ||
      object.parent.userData.isGroup === true
    )
      return object.parent;
  }
  return null;
}
