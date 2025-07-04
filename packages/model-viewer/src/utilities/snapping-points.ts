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
} from 'three';

export const SNAP_POINT_DIAMETER = 0.1; // Diameter of snap point spheres in meters

export type SnappingPoint = {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  attraction?: number;
  attracts?: string[];
  isAttractedTo?: string[];
  isUsed?: boolean; // Track if this snap point is already connected
};

export const DEFAULT_SNAP_ATTRACTION = SNAP_POINT_DIAMETER * 2;

/**
 * Generate default snap points on the middle of each side of the bounding box.
 * Creates snap points on front, back, left, and right sides (not top or bottom).
 */
export function generateDefaultSnappingPoints(
  object: Object3D
): SnappingPoint[] {
  const boundingBox = new Box3().setFromObject(object);
  const center = boundingBox.getCenter(new Vector3());
  const size = boundingBox.getSize(new Vector3());

  // Convert to local coordinates relative to object center
  const localCenter = object.worldToLocal(center.clone());

  return [
    // Front side (positive Z)
    {
      position: {
        x: localCenter.x,
        y: localCenter.y,
        z: localCenter.z + size.z / 2,
      },
      rotation: { x: 0, y: 0, z: 0 },
      attraction: DEFAULT_SNAP_ATTRACTION,
    },
    // Back side (negative Z)
    {
      position: {
        x: localCenter.x,
        y: localCenter.y,
        z: localCenter.z - size.z / 2,
      },
      rotation: { x: 0, y: Math.PI, z: 0 },
      attraction: DEFAULT_SNAP_ATTRACTION,
    },
    // Right side (positive X)
    {
      position: {
        x: localCenter.x + size.x / 2,
        y: localCenter.y,
        z: localCenter.z,
      },
      rotation: { x: 0, y: Math.PI / 2, z: 0 },
      attraction: DEFAULT_SNAP_ATTRACTION,
    },
    // Left side (negative X)
    {
      position: {
        x: localCenter.x - size.x / 2,
        y: localCenter.y,
        z: localCenter.z,
      },
      rotation: { x: 0, y: -Math.PI / 2, z: 0 },
      attraction: DEFAULT_SNAP_ATTRACTION,
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
  if (!object.userData.snappingPoints) return;

  const snappingPoints = object.userData.snappingPoints as SnappingPoint[];

  snappingPoints.forEach((snapPoint) => {
    // Create a group to hold both the base sphere and camera-facing outline circles
    const snapPointGroup = new Group();
    snapPointGroup.position.set(
      snapPoint.position.x,
      snapPoint.position.y,
      snapPoint.position.z
    );
    snapPointGroup.rotation.set(
      snapPoint.rotation.x,
      snapPoint.rotation.y,
      snapPoint.rotation.z
    );
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
        console.warn('Error in snapping point camera-facing logic:', error);
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
            console.warn('Error refreshing snapping point orientation:', error);
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
    if (child.userData.isPlacedObject && child.userData.snappingPoints) {
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
  snapPoint: SnappingPoint
): Vector3 {
  const localPos = new Vector3(
    snapPoint.position.x,
    snapPoint.position.y,
    snapPoint.position.z
  );
  return object.localToWorld(localPos);
}

/**
 * Find potential snapping connections between two objects
 */
export function findSnappingConnections(
  draggedObject: Object3D,
  targetObject: Object3D
): Array<{
  draggedPoint: SnappingPoint;
  targetPoint: SnappingPoint;
  distance: number;
}> {
  if (
    !draggedObject.userData.snappingPoints ||
    !targetObject.userData.snappingPoints
  ) {
    return [];
  }

  const draggedPoints = draggedObject.userData
    .snappingPoints as SnappingPoint[];
  const targetPoints = targetObject.userData.snappingPoints as SnappingPoint[];
  const connections: Array<{
    draggedPoint: SnappingPoint;
    targetPoint: SnappingPoint;
    distance: number;
  }> = [];

  draggedPoints.forEach((draggedPoint) => {
    // Skip already used snap points
    if (draggedPoint.isUsed) return;

    targetPoints.forEach((targetPoint) => {
      // Skip already used snap points
      if (targetPoint.isUsed) return;

      const draggedWorldPos = getSnappingPointWorldPosition(
        draggedObject,
        draggedPoint
      );
      const targetWorldPos = getSnappingPointWorldPosition(
        targetObject,
        targetPoint
      );
      const distance = draggedWorldPos.distanceTo(targetWorldPos);

      const draggedAttraction =
        draggedPoint.attraction ?? DEFAULT_SNAP_ATTRACTION;
      const targetAttraction =
        targetPoint.attraction ?? DEFAULT_SNAP_ATTRACTION;
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

/**
 * Create a snapped group from two objects
 */
export function createSnappedGroup(
  object1: Object3D,
  object2: Object3D,
  snapPoint1: SnappingPoint,
  snapPoint2: SnappingPoint
): Object3D {
  // Create a new group to contain both objects
  const group = new Object3D();
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

  // Remove objects from their current parent and add to group
  const parent = object1.parent;
  if (parent) {
    parent.remove(object1);
    parent.remove(object2);
    parent.add(group);
  }

  group.add(object1);
  group.add(object2);

  // Mark the snap points as used
  snapPoint1.isUsed = true;
  snapPoint2.isUsed = true;

  // Copy userData from one of the objects to maintain properties
  group.userData = { ...object1.userData, ...group.userData };
  group.userData.isPlacedObject = true;

  return group;
}

/**
 * Check if an object is part of a snapped group
 */
export function isInSnappedGroup(object: Object3D): boolean {
  return object.parent?.userData.isSnappedGroup === true;
}

/**
 * Get the snapped group containing an object, if any
 */
export function getSnappedGroup(object: Object3D): Object3D | null {
  if (object.userData.isSnappedGroup) {
    return object;
  }
  if (object.parent?.userData.isSnappedGroup) {
    return object.parent;
  }
  return null;
}
