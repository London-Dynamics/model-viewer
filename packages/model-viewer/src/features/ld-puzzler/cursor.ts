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

  constructor(scene: any, targetObject: Object3D, radius: number = 0.1) {
    super();
    this.name = 'cursor';
    this.visible = false;
    this.scene = scene;
    this.targetObject = targetObject;

    /* this should be a flat circle, 0.2m in diameter, slightly darker than white, 50% transparent, placed at the origin */
    const geometry = new CircleGeometry(radius, 32);
    const material = new MeshBasicMaterial({
      color: 0xf5f5f5, // Slightly darker than white (WhiteSmoke)
      transparent: true,
      opacity: 0.5,
      depthTest: false,
    });
    const mesh = new Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; // Rotate to face up
    mesh.position.set(0, 0.01, 0); // Slightly above ground level
    mesh.castShadow = false; // Cursor should not cast shadows
    this.add(mesh);

    /* Add contours around the circle - primary and high-contrast for dark backgrounds */
    const contourGeometry = new BufferGeometry();
    const contourPoints = [];
    const segments = 64; // Higher number for smoother circle

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      contourPoints.push(
        new Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
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

    const contourLine = new LineLoop(contourGeometry, contourMaterial);
    contourLine.position.set(0, 0.011, 0); // Slightly above the circle
    contourLine.castShadow = false; // Cursor contours should not cast shadows
    this.add(contourLine);

    // High-contrast contour for dark backgrounds
    const darkContourMaterial = new LineBasicMaterial({
      color: 0x333333, // Dark gray for contrast against dark backgrounds
      transparent: true,
      opacity: 0.6,
      depthTest: false,
    });

    const darkContourLine = new LineLoop(
      contourGeometry.clone(),
      darkContourMaterial
    );
    darkContourLine.position.set(0, 0.012, 0); // Slightly higher than primary contour
    darkContourLine.castShadow = false; // Cursor contours should not cast shadows
    this.add(darkContourLine);

    // Add to target object and position at placement level
    targetObject.add(this);
    this.positionAtPlacementLevel();
  }

  setVisible(visible: boolean) {
    this.visible = visible;
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
