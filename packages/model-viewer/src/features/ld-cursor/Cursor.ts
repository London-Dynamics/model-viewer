import {
  Object3D,
  Vector2,
  Vector3,
  CircleGeometry,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
} from 'three';
// Fat-line helpers for consistent line thickness across platforms
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

const OSCILLATION_PERIOD = 1500; // 1.5 seconds for a full oscillation
// Very large render order to ensure the cursor renders after scene geometry
const RENDER_ORDER = 1000000;

export class Cursor extends Object3D {
  needsRender: (() => void) | null = null;
  private element: HTMLElement | null = null;
  private scene: any = null;
  private targetObject: Object3D | null = null;
  private worldPlacementPosition: Vector3 = new Vector3();

  private dragOverHandler?: (event: DragEvent) => void;
  private mouseMoveHandler?: (event: MouseEvent) => void;
  private _positionGetter?: (
    clientX: number,
    clientY: number
  ) => Vector3 | null;

  // Disc-specific state
  private baseRadius: number = 0.1;
  private contourLine: Line2 | null = null;
  private contourLineMaterial: LineMaterial | null = null;
  private _onResize?: () => void;
  private elapsedTime: number = 0;
  private mesh: Mesh | null = null;
  private radius: number = 0.1;
  private colour: string = '#165dfc';
  private lineWidth: number = 3;

  constructor(
    scene: any,
    targetObject: Object3D,
    radius: number = 0.1,
    colour: string = '#165dfc'
  ) {
    super();
    this.name = 'cursor';
    this.visible = false;
    this.scene = scene;
    this.targetObject = targetObject;

    // default position outside window
    this.position.set(10000, 10000, 10000);

    // Add to target object and position at floor level
    targetObject.add(this);
    this.positionAtFloorLevel();

    this.radius = radius;
    this.baseRadius = radius;
    this.colour = colour;

    this.createCursorGeometry();
  }

  // Public API methods

  getPosition(): Vector3 {
    return this.worldPlacementPosition.clone();
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

  setVisible(visible: boolean) {
    this.visible = visible;

    if (visible && this.element && this.needsRender) {
      // Enable mouse tracking when visible and tracking is configured
      this.startMouseTracking();
    } else {
      // Disable mouse tracking when not visible
      this.stopMouseTracking();
    }

    if (!visible) {
      // Stop animation when not visible
      this.stopAnimation();
    }
  }

  setupMouseTracking(
    element: HTMLElement,
    positionGetter: (clientX: number, clientY: number) => Vector3 | null,
    needsRender: () => void
  ) {
    this.element = element;
    this._positionGetter = positionGetter;
    this.needsRender = needsRender;
    // If cursor is already visible, start tracking immediately
    if (this.visible) {
      this.startMouseTracking();
    }
  }

  cleanup() {
    // Remove all geometry from the cursor
    this.clear();
    this.stopAnimation();
    this.stopMouseTracking();

    // Remove resize listener for line material
    if (this._onResize) {
      window.removeEventListener('resize', this._onResize);
      this._onResize = undefined;
    }

    // Dispose of line material and geometry
    if (this.contourLine) {
      // Line2 stores geometry and material differently
      // @ts-ignore - internal properties from examples
      const geom = this.contourLine.geometry as any;
      if (geom && geom.dispose) geom.dispose();
    }
    if (this.contourLineMaterial) {
      this.contourLineMaterial.dispose();
      this.contourLineMaterial = null;
    }

    this.visible = false;
    this.element = null;

    this.needsRender?.();
    this.needsRender = null;
  }

  private createCursorGeometry() {
    this.clear();

    const geometry = new CircleGeometry(this.radius, 32);
    const material = new MeshBasicMaterial({
      color: this.colour,
      transparent: true,
      opacity: 0.1,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set(0, 0.01, 0);
    this.mesh.castShadow = false;

    this.mesh.renderOrder = RENDER_ORDER;

    this.add(this.mesh);

    const contourPoints: Vector3[] = [];
    const segments = 64;

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

    // Convert contour points to a flat Float32 array for LineGeometry
    const positions: number[] = [];
    for (let i = 0; i < contourPoints.length; i++) {
      const p = contourPoints[i];
      positions.push(p.x, p.y, p.z);
    }

    const lineGeo = new LineGeometry();
    lineGeo.setPositions(positions);

    // Create LineMaterial - linewidth is in pixels
    const lineMat = new LineMaterial({
      color: this.colour,
      linewidth: this.lineWidth,
      dashed: false,
    });
    // Set initial resolution (required)
    lineMat.resolution = new Vector2(window.innerWidth, window.innerHeight);

    // Configure blending/transparency/depth so opacity works reliably
    lineMat.transparent = true;
    lineMat.opacity = 0.8;
    // Disable depth testing and writing so the outline is always visible on top
    lineMat.depthTest = false;
    lineMat.depthWrite = false;
    lineMat.blending = NormalBlending;
    // Force recompile/update of the material
    lineMat.needsUpdate = true;

    const line = new Line2(lineGeo, lineMat);
    line.position.set(0, 0, 0);
    line.computeLineDistances();
    // Ensure the outline is drawn after the disc mesh so it appears on top
    line.renderOrder = RENDER_ORDER + 1;
    // Also bump mesh renderOrder to the same high base so both render after scene
    if (this.mesh) this.mesh.renderOrder = RENDER_ORDER;

    this.contourLine = line;
    this.contourLineMaterial = lineMat;
    this.add(this.contourLine);

    // Keep lineMat resolution updated on resize
    if (!this._onResize) {
      this._onResize = () => {
        if (this.contourLineMaterial) {
          this.contourLineMaterial.resolution.set(
            window.innerWidth,
            window.innerHeight
          );
          if (this.needsRender) this.needsRender();
        }
      };
      window.addEventListener('resize', this._onResize);
    }
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
        if (!this._positionGetter) return;
        const world = this._positionGetter(event.clientX, event.clientY);
        if (world) {
          this.applyWorldIntersection(world);
          if (this.needsRender) this.needsRender();
        }
      };

      this.dragOverHandler = (event: DragEvent) => {
        // Prevent default to allow drop
        event.preventDefault();
        if (!this._positionGetter) return;
        const world = this._positionGetter(event.clientX, event.clientY);
        if (world) {
          this.applyWorldIntersection(world);
          if (this.needsRender) this.needsRender();
        }
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

  // Apply a world-space intersection point to the cursor's position
  applyWorldIntersection(worldIntersectionPoint: Vector3) {
    // Store the world position for placement purposes
    this.worldPlacementPosition.copy(worldIntersectionPoint);

    // For the cursor visual position, we need to consider its parent (target object)
    if (this.targetObject) {
      const localPosition = worldIntersectionPoint.clone();
      this.targetObject.worldToLocal(localPosition);
      this.position.copy(localPosition);

      const targetBoundingBoxMin = new Vector3(
        0,
        this.scene.boundingBox?.min.y || 0,
        0
      );
      this.targetObject.worldToLocal(targetBoundingBoxMin);
      this.position.y = targetBoundingBoxMin.y;
    } else {
      this.position.copy(worldIntersectionPoint);
      this.position.y =
        this.scene && this.scene.boundingBox
          ? this.scene.boundingBox.min.y
          : worldIntersectionPoint.y;
    }

    this.setVisible(true);
  }

  tick(_: number, delta: number) {
    if (!this.visible) return;

    this.elapsedTime += delta;

    const oscillationPeriod = OSCILLATION_PERIOD;
    const phase = (this.elapsedTime % oscillationPeriod) / oscillationPeriod;

    const amplitude = 0.1;
    const oscillation = Math.sin(phase * 2 * Math.PI) * amplitude;

    this.radius = this.baseRadius * (1 + oscillation);
    this.createCursorGeometry();

    if (this.needsRender) {
      this.needsRender();
    }
  }

  private stopAnimation() {
    this.radius = this.baseRadius;
    this.elapsedTime = 0;
  }
}
