import { Object3D, Raycaster, Vector2, Vector3 } from 'three';

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

    // Add to target object and position at placement level
    targetObject.add(this);
    this.positionAtPlacementLevel();
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

    // If cursor is already visible, start tracking immediately
    if (this.visible) {
      this.startMouseTracking();
    }
  }

  cleanup() {
    this.stopMouseTracking();
    this.visible = false;
    this.element = null;
    this.needsRender = null;
  }

  private positionAtPlacementLevel() {
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
    if (!this.scene) return;

    // Convert raw client coordinates to element-relative coordinates
    const rect = element.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    // Convert to normalized device coordinates (-1 to 1)
    const x = (mouseX / rect.width) * 2 - 1;
    const y = -(mouseY / rect.height) * 2 + 1;

    // Create a raycaster from the camera
    const raycaster = new Raycaster();
    raycaster.setFromCamera(new Vector2(x, y), this.scene.camera);

    // Create a virtual placement plane at the scene's placement level
    const placementY = this.scene.boundingBox
      ? this.scene.boundingBox.min.y
      : 0;

    // Calculate intersection with the placement plane (Y = placementY)
    const ray = raycaster.ray;
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
        this.setVisible(false);
      }
    } else {
      this.setVisible(false);
    }

    needsRender();
  }
}
