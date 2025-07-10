import {
  BufferGeometry,
  CircleGeometry,
  LineBasicMaterial,
  LineLoop,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from 'three';
import { Cursor as CursorBase } from './Cursor';

export class Cursor extends CursorBase {
  private baseRadius: number = 0.1;
  private contourLine: LineLoop | null = null;
  private darkContourLine: LineLoop | null = null;
  private elapsedTime: number = 0;
  private mesh: Mesh | null = null;
  private radius: number = 0.1;

  constructor(scene: any, targetObject: Object3D, radius: number = 0.1) {
    super(scene, targetObject);

    this.radius = radius;
    this.baseRadius = radius;

    this.createCursorGeometry();
  }

  // Public API methods

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

  private createCursorGeometry() {
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
    super.setVisible(visible);

    if (!visible) {
      // Stop animation when not visible
      this.stopAnimation();
    }
  }

  tick(_: any, delta: number) {
    if (this.visible) {
      this.elapsedTime += delta;

      const oscillationPeriod = 1500;
      const phase = (this.elapsedTime % oscillationPeriod) / oscillationPeriod;

      // Create a sine wave that oscillates between -0.1 and +0.1 (10% in each direction)
      const amplitude = 0.1;
      const oscillation = Math.sin(phase * 2 * Math.PI) * amplitude;

      // Apply the oscillation to the base radius
      this.radius = this.baseRadius * (1 + oscillation);
      this.createCursorGeometry();

      // Tell the renderer that we need it to update
      if (this.needsRender) {
        this.needsRender();
      }
    }
  }

  private stopAnimation() {
    // Reset to base radius
    this.radius = this.baseRadius;
    this.elapsedTime = 0;
    this.createCursorGeometry();
  }
}
