import {
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';

export class Cursor extends Object3D {
  needsRender: (() => void) | null = null;
  private element: HTMLElement | null = null;
  private scene: any = null;
  private targetObject: Object3D | null = null;
  private worldPlacementPosition: Vector3 = new Vector3();

  private dragOverHandler?: (event: DragEvent) => void;
  private mouseMoveHandler?: (event: MouseEvent) => void;

  constructor(scene: any, targetObject: Object3D) {
    super();
    this.name = 'cursor';
    this.visible = false;
    this.scene = scene;
    this.targetObject = targetObject;

    // default positoin outside window
    this.position.set(10000, 10000, 10000);

    // Add to target object and position at floor level
    targetObject.add(this);
    this.positionAtFloorLevel();
  }

  // Public API methods

  getPosition(): Vector3 {
    return this.worldPlacementPosition.clone();
  }

  setVisible(visible: boolean) {
    this.visible = visible;

    if (visible && this.element && this.needsRender) {
      // Enable mouse tracking when visible and tracking is configured
      this.startMouseTracking();
    } else {
      // Disable mouse tracking when not visible
      this.stopMouseTracking();
    }
  }

  setupMouseTracking(element: HTMLElement, needsRender: () => void) {
    this.element = element;
    this.needsRender = needsRender;
    console.log('Mouse tracking setup for cursor:', this.visible);
    // If cursor is already visible, start tracking immediately
    if (this.visible) {
      this.startMouseTracking();
    }
  }

  cleanup() {
    this.stopMouseTracking();
    this.visible = false;
    this.element = null;

    this.needsRender?.();
    this.needsRender = null;
  }

  private positionAtFloorLevel() {
    if (this.scene && this.scene.boundingBox) {
      // Position at the minimum Y of the bounding box (placement level)
      this.position.y = this.scene.boundingBox.min.y;
    }
  }

  private startMouseTracking() {
    if (!this.mouseMoveHandler && this.element) {
      this.mouseMoveHandler = (event: MouseEvent) => {
        this.updatePosition(
          event.clientX,
          event.clientY,
          this.element!,
          this.needsRender!
        );
      };

      this.dragOverHandler = (event: DragEvent) => {
        // Prevent default to allow drop
        event.preventDefault();
        this.updatePosition(
          event.clientX,
          event.clientY,
          this.element!,
          this.needsRender!
        );
      };

      this.element.addEventListener('mousemove', this.mouseMoveHandler);
      this.element.addEventListener('dragover', this.dragOverHandler);
    }
  }

  private stopMouseTracking() {
    if (this.mouseMoveHandler && this.element) {
      this.element.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = undefined;
    }

    if (this.dragOverHandler && this.element) {
      this.element.removeEventListener('dragover', this.dragOverHandler);
      this.dragOverHandler = undefined;
    }
  }

  private updatePosition(
    clientX: number,
    clientY: number,
    element: any,
    needsRender: () => void
  ) {
    if (!this.element || !this.scene) {
      console.warn(
        'Cursor element or scene is not set, cannot update position'
      );
      return;
    }
    if (!this.scene) return;

    // Convert raw client coordinates to element-relative coordinates
    const rect = element.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    // Convert to normalized device coordinates (-1 to 1)
    const x = (mouseX / rect.width) * 2 - 1;
    const y = -(mouseY / rect.height) * 2 + 1;

    // Comprehensive camera validation
    const camera = this.scene.camera;
    if (!camera) {
      console.error('No camera found in scene');
      return;
    }

    // Check camera position
    const pos = camera.position;
    if (
      !pos ||
      !pos.isVector3 ||
      !isFinite(pos.x) ||
      !isFinite(pos.y) ||
      !isFinite(pos.z) ||
      isNaN(pos.x) ||
      isNaN(pos.y) ||
      isNaN(pos.z)
    ) {
      console.error('Camera position is invalid:', pos);
      return;
    }

    // Check camera up vector
    const up = camera.up;
    if (
      !up ||
      !up.isVector3 ||
      !isFinite(up.x) ||
      !isFinite(up.y) ||
      !isFinite(up.z) ||
      isNaN(up.x) ||
      isNaN(up.y) ||
      isNaN(up.z) ||
      up.length() === 0
    ) {
      console.error('Camera up vector is invalid:', up);
      return;
    }

    // Force camera matrix update to ensure it's current
    camera.updateProjectionMatrix(); // Ensure projection matrix is up to date
    camera.updateMatrix();
    camera.updateMatrixWorld(true);

    // Validate camera matrices (both view and projection)
    const matrixValid = camera.matrix.elements.every(
      (n: number) => isFinite(n) && !isNaN(n)
    );
    const matrixWorldValid = camera.matrixWorld.elements.every(
      (n: number) => isFinite(n) && !isNaN(n)
    );
    const projMatrixValid = camera.projectionMatrix.elements.every(
      (n: number) => isFinite(n) && !isNaN(n)
    );

    if (!matrixValid || !matrixWorldValid || !projMatrixValid) {
      console.error(
        'Camera matrices are invalid (contains NaN/Infinity), cannot create ray'
      );

      if (!projMatrixValid) {
        // Try to fix the projection matrix
        if (camera instanceof PerspectiveCamera) {
          if (
            !camera.fov ||
            !isFinite(camera.fov) ||
            isNaN(camera.fov) ||
            camera.fov <= 0
          ) {
            camera.fov = 45;
          }
          if (
            !camera.aspect ||
            !isFinite(camera.aspect) ||
            isNaN(camera.aspect) ||
            camera.aspect <= 0
          ) {
            camera.aspect = 1;
          }
        }
        if (
          !camera.near ||
          !isFinite(camera.near) ||
          isNaN(camera.near) ||
          camera.near <= 0
        ) {
          camera.near = 0.1;
        }
        if (
          !camera.far ||
          !isFinite(camera.far) ||
          isNaN(camera.far) ||
          camera.far <= camera.near
        ) {
          camera.far = 1000;
        }

        // Force update projection matrix
        camera.updateProjectionMatrix();

        // Revalidate
        const newProjMatrixValid = camera.projectionMatrix.elements.every(
          (n: number) => isFinite(n) && !isNaN(n)
        );

        if (!newProjMatrixValid) {
          console.error(
            'Could not fix projection matrix, aborting ray creation'
          );
          return;
        }
      } else {
        return;
      }
    }

    // Create a raycaster from the camera
    const raycaster = new Raycaster();

    try {
      raycaster.setFromCamera(new Vector2(x, y), camera);
    } catch (error) {
      console.error('Failed to create raycaster from camera:', error);
      return;
    }

    // Validate the resulting ray
    const ray = raycaster.ray;
    if (!ray || !ray.direction || !ray.origin) {
      console.error('Ray is invalid after raycaster creation');
      return;
    }

    // Check ray direction for validity
    const dir = ray.direction;
    if (
      !dir.isVector3 ||
      !isFinite(dir.x) ||
      !isFinite(dir.y) ||
      !isFinite(dir.z) ||
      isNaN(dir.x) ||
      isNaN(dir.y) ||
      isNaN(dir.z) ||
      dir.length() === 0
    ) {
      console.error('Ray direction is invalid:', dir);
      return;
    }

    // Check ray origin for validity
    const origin = ray.origin;
    if (
      !origin.isVector3 ||
      !isFinite(origin.x) ||
      !isFinite(origin.y) ||
      !isFinite(origin.z) ||
      isNaN(origin.x) ||
      isNaN(origin.y) ||
      isNaN(origin.z)
    ) {
      console.error('Ray origin is invalid:', origin);
      return;
    }

    // Create a virtual placement plane at the scene's placement level
    const placementY = this.scene.boundingBox
      ? this.scene.boundingBox.min.y
      : 0;

    // Calculate intersection with the placement plane (Y = placementY)
    const directionY = ray.direction.y;

    if (Math.abs(directionY) > 0.0001) {
      // Avoid division by zero
      const t = (placementY - ray.origin.y) / directionY;

      if (t > 0) {
        // Ray hits the plane in front of camera (this is in world coordinates)
        const worldIntersectionPoint = ray.origin
          .clone()
          .add(ray.direction.clone().multiplyScalar(t));

        // Store the world position for placement purposes
        this.worldPlacementPosition.copy(worldIntersectionPoint);

        // For the cursor visual position, we need to consider its parent (target object)
        // If cursor is a child of target object, we need to position it relative to target
        if (this.targetObject) {
          // Convert world position to target's local space for cursor display
          const localPosition = worldIntersectionPoint.clone();
          this.targetObject.worldToLocal(localPosition);
          this.position.copy(localPosition);

          // Adjust Y position to be relative to target's local coordinate system
          const targetBoundingBoxMin = new Vector3(
            0,
            this.scene.boundingBox?.min.y || 0,
            0
          );
          this.targetObject.worldToLocal(targetBoundingBoxMin);
          this.position.y = targetBoundingBoxMin.y + 0.01;
        } else {
          // No target object, position in world space
          this.position.copy(worldIntersectionPoint);
          this.position.y = placementY + 0.01;
        }

        this.setVisible(true);
      } else {
        console.log(
          'Ray does not hit the placement plane in front of the camera, hiding cursor'
        );
        this.setVisible(false);
      }
    } else {
      console.warn(
        'Ray direction Y is zero, cannot calculate intersection with placement plane'
      );
      this.setVisible(false);
    }

    needsRender();
  }
}
