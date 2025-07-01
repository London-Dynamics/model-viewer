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

  constructor(scene: any, targetObject: Object3D, radius: number = 0.1) {
    super();
    this.name = 'cursor';
    this.visible = false;
    this.scene = scene;
    this.targetObject = targetObject;
    this.radius = radius;

    this.createCursorGeometry();

    // Add to target object and position at placement level
    targetObject.add(this);
    this.positionAtPlacementLevel();
  }

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
      this.element.addEventListener('mousemove', this.mouseMoveHandler);
    }
  }

  private stopMouseTracking() {
    if (this.mouseMoveHandler && this.element) {
      this.element.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = undefined;
    }
  }

  cleanup() {
    this.stopMouseTracking();
    this.element = null;
    this.needsRender = null;
  }

  setRadius(newRadius: number) {
    if (newRadius <= 0) {
      console.warn('Cursor radius must be greater than 0');
      return;
    }

    this.radius = newRadius;
    this.createCursorGeometry();
  }

  getRadius(): number {
    return this.radius;
  }

  // Method to position the cursor at the placement level of the scene
  positionAtPlacementLevel() {
    if (this.scene && this.scene.boundingBox) {
      // Position at the minimum Y of the bounding box (placement level)
      this.position.y = this.scene.boundingBox.min.y;
    }
  }

  // Update cursor position based on mouse coordinates
  updatePosition(
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
        // Ray hits the plane in front of camera
        const intersectionPoint = ray.origin
          .clone()
          .add(ray.direction.clone().multiplyScalar(t));

        // Position the cursor at the intersection point
        this.position.copy(intersectionPoint);
        this.position.y = placementY + 0.01; // Slightly above the placement surface

        this.setVisible(true);
      } else {
        this.setVisible(false);
      }
    } else {
      this.setVisible(false);
    }

    needsRender();
  }

  resetPosition() {
    if (this.targetObject) {
      this.positionAtPlacementLevel();
    }
  }
}
