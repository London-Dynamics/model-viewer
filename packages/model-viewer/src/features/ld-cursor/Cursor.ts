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

    // Add to the root of the target's hierarchy (scene root) so cursor local Y
    // matches world Y regardless of intermediate parent translations.
    let rootParent: Object3D = targetObject;
    while (rootParent.parent) rootParent = rootParent.parent;
    rootParent.add(this);

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

    // Update radius and apply scale to existing geometries. Avoid
    // recreating geometry unless absolutely necessary — scaling is
    // significantly cheaper and keeps buffers stable.
    this.radius = newRadius;
    this.baseRadius = newRadius;
    this.updateScale();
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
    // Keep existing children intact and recreate only if there's no mesh
    // (first construction) or if required. We'll create unit geometries
    // (radius = 1) in the XZ plane and then scale them to the requested
    // radius. This makes radius changes and per-frame animation cheap.
    this.clear();

    // Create unit circle geometry (radius = 1) in XZ plane
    const geometry = new CircleGeometry(1, 32);
    geometry.rotateX(-Math.PI / 2);

    const material = new MeshBasicMaterial({
      color: this.colour,
      transparent: true,
      opacity: 0.1,
      depthTest: false,
      depthWrite: false,
    });

    this.mesh = new Mesh(geometry, material);
    this.mesh.castShadow = false;
    this.mesh.renderOrder = RENDER_ORDER;
    this.mesh.position.set(0, 0, 0);
    this.add(this.mesh);

    // Create unit contour positions for LineGeometry (unit circle in XZ)
    const segments = 64;
    const positions: number[] = [];
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      positions.push(Math.cos(angle), 0, Math.sin(angle));
    }
    // close loop
    positions.push(positions[0], positions[1], positions[2]);

    const lineGeo = new LineGeometry();
    lineGeo.setPositions(positions);

    const lineMat = new LineMaterial({
      color: this.colour,
      linewidth: this.lineWidth,
      dashed: false,
    });
    lineMat.resolution = new Vector2(window.innerWidth, window.innerHeight);
    lineMat.transparent = true;
    lineMat.opacity = 0.8;
    lineMat.depthTest = false;
    lineMat.depthWrite = false;
    lineMat.blending = NormalBlending;
    lineMat.needsUpdate = true;

    const line = new Line2(lineGeo, lineMat);
    line.position.set(0, 0, 0);
    line.computeLineDistances();
    line.renderOrder = RENDER_ORDER + 1;

    this.contourLine = line;
    this.contourLineMaterial = lineMat;
    this.add(this.contourLine);

    // Apply initial scale based on current radius
    this.updateScale();

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

  // Update runtime scales on mesh/line according to this.radius/baseRadius
  private updateScale() {
    // Unit geometry has radius = 1, so scale the mesh/line directly by the
    // desired radius to get world-space radius = this.radius.
    const scaleFactor = this.radius;
    if (this.mesh) this.mesh.scale.set(scaleFactor, 1, scaleFactor);
    if (this.contourLine)
      this.contourLine.scale.set(scaleFactor, 1, scaleFactor);
  }

  private positionAtFloorLevel() {
    if (
      this.scene &&
      this.scene.boundingBox &&
      !this.scene.boundingBox.isEmpty()
    ) {
      // Compute world-space floor Y and convert it into the cursor's parent's local space.
      const worldFloor = new Vector3(0, this.scene.boundingBox.min.y, 0);
      const parentForConversion = this.parent ?? this.targetObject ?? null;
      if (parentForConversion) {
        const localFloor = worldFloor.clone();
        parentForConversion.worldToLocal(localFloor);
        this.position.y = localFloor.y;
      } else {
        this.position.y = this.scene.boundingBox.min.y;
      }
    } else {
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

    // Compute world-space floor point at same X/Z
    // Use the bounding box if valid (not empty), otherwise fall back to intersection point
    let floorY = worldIntersectionPoint.y;
    if (this.scene?.boundingBox && !this.scene.boundingBox.isEmpty()) {
      floorY = this.scene.boundingBox.min.y;
    }

    const worldFloor = new Vector3(
      worldIntersectionPoint.x,
      floorY,
      worldIntersectionPoint.z
    );

    // Convert the world floor into the cursor's parent's local space (safer than forcing targetObject)
    const parentForConversion = this.parent ?? this.targetObject ?? null;
    if (parentForConversion) {
      const localFloor = worldFloor.clone();
      parentForConversion.worldToLocal(localFloor);
      // Update position, but importantly: always update Y to catch bounding box changes
      this.position.x = localFloor.x;
      this.position.y = localFloor.y;
      this.position.z = localFloor.z;
    } else {
      // no parent — place in world coords
      this.position.copy(worldFloor);
    }

    const worldPos = new Vector3();
    this.getWorldPosition(worldPos);

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
    // Update mesh/line scale directly; unit geometry has radius 1 so scale by
    // the desired world-space radius.
    const scaleFactor = this.radius;
    if (this.mesh) this.mesh.scale.set(scaleFactor, 1, scaleFactor);
    if (this.contourLine)
      this.contourLine.scale.set(scaleFactor, 1, scaleFactor);

    if (this.needsRender) this.needsRender();
  }

  private stopAnimation() {
    this.radius = this.baseRadius;
    this.elapsedTime = 0;
    // Reset any runtime scaling applied in tick() to match the baseRadius
    // (unit geometry scaled by world radius)
    if (this.mesh) this.mesh.scale.set(this.radius, 1, this.radius);
    if (this.contourLine)
      this.contourLine.scale.set(this.radius, 1, this.radius);
  }
}
