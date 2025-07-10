import {
  BufferGeometry,
  CircleGeometry,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  Vector2,
  Vector3,
} from 'three';

export class Cursor extends Object3D {
  private scene: any = null;
  private targetObject: Object3D | null = null;
  private radius: number = 0.1;
  private mesh: Mesh | null = null;
  private contourLine: LineLoop | null = null;
  private darkContourLine: LineLoop | null = null;
  private element: HTMLElement | null = null;
  private needsRender: (() => void) | null = null;
  private mouseMoveHandler?: (event: MouseEvent) => void;
  private dragOverHandler?: (event: DragEvent) => void;
  private worldPlacementPosition: Vector3 = new Vector3();
  private animationFrameId: number | null = null;
  private baseRadius: number = 0.1;
  private animationStartTime: number = 0;

  constructor(scene: any, targetObject: Object3D, radius: number = 0.1) {
    super();
    this.name = 'cursor';
    this.visible = false;
    this.scene = scene;
    this.targetObject = targetObject;
    this.radius = radius;
    this.baseRadius = radius;

    this.createCursorGeometry();

    // Add to target object and position at placement level
    targetObject.add(this);
    this.positionAtPlacementLevel();
  }

  // Public API methods
  setVisible(visible: boolean) {
    this.visible = visible;

    if (visible && this.element && this.needsRender) {
      // Enable mouse tracking when visible and tracking is configured
      this.startMouseTracking();
      this.startAnimation();
    } else {
      // Disable mouse tracking when not visible
      this.stopMouseTracking();
      this.stopAnimation();
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
    this.stopAnimation();
    this.element = null;
    this.needsRender = null;
  }

  setRadius(newRadius: number) {
    if (newRadius <= 0) {
      console.warn('Cursor radius must be greater than 0');
      return;
    }

    this.radius = newRadius;
    this.baseRadius = newRadius;
    this.createCursorGeometry();
  }

  getRadius(): number {
    return this.radius;
  }

  getWorldPlacementPosition(): Vector3 {
    return this.worldPlacementPosition.clone();
  }

  // Private implementation methods
  private createCursorGeometry() {
    // Clear existing geometry if any
    this.clear();

    /* this should be a flat circle, 0.2m in diameter, slightly darker than white, 50% transparent, placed at the origin */
    const geometry = new CircleGeometry(this.radius, 32);
    const material = new MeshBasicMaterial({
      color: 0xf5f5f5, // Slightly darker than white (WhiteSmoke)
      transparent: true,
      opacity: 0.5,
      depthTest: false,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2; // Rotate to face up
    this.mesh.position.set(0, 0.01, 0); // Slightly above ground level
    this.mesh.castShadow = false; // Cursor should not cast shadows
    this.add(this.mesh);

    /* Add contours around the circle - primary and high-contrast for dark backgrounds */
    const contourGeometry = new BufferGeometry();
    const contourPoints = [];
    const segments = 64; // Higher number for smoother circle

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      contourPoints.push(
        new Vector3(
          Math.cos(angle) * this.radius,
          0,
          Math.sin(angle) * this.radius
        )
      );
    }

    contourGeometry.setFromPoints(contourPoints);

    // Primary contour - slightly darker than the circle
    const contourMaterial = new LineBasicMaterial({
      color: 0xd3d3d3, // Light gray - slightly darker than the circle
      transparent: true,
      opacity: 0.8,
      depthTest: false,
    });

    this.contourLine = new LineLoop(contourGeometry, contourMaterial);
    this.contourLine.position.set(0, 0.011, 0); // Slightly above the circle
    this.contourLine.castShadow = false; // Cursor contours should not cast shadows
    this.add(this.contourLine);

    // High-contrast contour for dark backgrounds
    const darkContourMaterial = new LineBasicMaterial({
      color: 0x333333, // Dark gray for contrast against dark backgrounds
      transparent: true,
      opacity: 0.6,
      depthTest: false,
    });

    this.darkContourLine = new LineLoop(
      contourGeometry.clone(),
      darkContourMaterial
    );
    this.darkContourLine.position.set(0, 0.012, 0); // Slightly higher than primary contour
    this.darkContourLine.castShadow = false; // Cursor contours should not cast shadows
    this.add(this.darkContourLine);
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

  private startAnimation() {
    if (this.animationFrameId !== null) {
      return; // Animation already running
    }

    this.animationStartTime = performance.now();
    this.animate();
  }

  private stopAnimation() {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Reset to base radius
    this.radius = this.baseRadius;
    this.createCursorGeometry();
  }

  private animate() {
    if (!this.visible) {
      this.stopAnimation();
      return;
    }

    const currentTime = performance.now();
    const elapsed = currentTime - this.animationStartTime;

    const oscillationPeriod = 1500;
    const phase = (elapsed % oscillationPeriod) / oscillationPeriod;

    // Create a sine wave that oscillates between -0.1 and +0.1 (10% in each direction)
    const amplitude = 0.1;
    const oscillation = Math.sin(phase * 2 * Math.PI) * amplitude;

    // Apply the oscillation to the base radius
    this.radius = this.baseRadius * (1 + oscillation);
    this.createCursorGeometry();

    // Trigger a render if needed
    if (this.needsRender) {
      this.needsRender();
    }

    // Schedule the next frame
    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }
}
