import {
  Box3,
  Camera,
  CircleGeometry,
  Color,
  DoubleSide,
  Material,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Plane,
  Ray,
  ShaderMaterial,
  Sphere,
  Vector3,
} from 'three';

const ROTATION_DISC_RENDER_ORDER = 9800;
const DEFAULT_MINOR_STEP_DEG = 15;
const DEFAULT_MAJOR_STEP_DEG = 45;
const TAU = Math.PI * 2;
const MIN_DISC_RADIUS_PX = 96;
const MAX_VIEWPORT_RATIO = 0.8;
const INNER_RADIUS_FROM_BOUNDING_SPHERE = 0.8;
const OUTER_RADIUS_SCALE_FROM_INNER = 1.25;
const MINOR_TICK_LENGTH_RATIO = 0.5;
const MAJOR_TICK_LENGTH_RATIO = 0.8;
const CIRCLE_STROKE_THICKNESS_NORM = 0.01;
const TICK_RADIAL_THICKNESS_NORM = 0.003;
const MINOR_TICK_ANGULAR_THICKNESS_RAD = 0.01;
const MAJOR_TICK_ANGULAR_THICKNESS_RAD = 0.008;
const ARC_EDGE_SOFTNESS_NORM = 0.002;
const BASE_ARC_OPACITY = 0.1;
const ARC_OPACITY = 1.0;
const TICK_CONTRAST_LUMA_THRESHOLD = 0.45;
const DISC_SURFACE_OFFSET_M = 0.003;
const MIN_STEP_EPSILON = 1e-5;
const PLANE_NORMAL = new Vector3(0, 1, 0);
const TMP_BOX = new Box3();
const TMP_SPHERE = new Sphere();
const TMP_EDGE = new Vector3();
const TMP_INTERSECTION = new Vector3();
const TMP_LOCAL_CENTER = new Vector3();
const TMP_FLOOR_WORLD = new Vector3();
const TMP_OBJECT_WORLD_POS = new Vector3();
const TMP_OBJECT_WORLD_DELTA = new Vector3();

function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

export type RotationDiscUpdateArgs = {
  selectedObject: Object3D;
  camera: Camera;
  viewportWidth: number;
  viewportHeight: number;
  floorY: number;
  highlightColor: string;
  stepDegrees: number;
  /** When true, recompute disc radius from the object bounding sphere. */
  lockSize?: boolean;
};

export type RotationDiscHit = {
  point: Vector3;
  angleRad: number;
  distance: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeDegrees(stepDegrees: number): number {
  if (
    !Number.isFinite(stepDegrees) ||
    Math.abs(stepDegrees) < MIN_STEP_EPSILON
  ) {
    return 0;
  }
  return Math.min(360, Math.max(MIN_STEP_EPSILON, Math.abs(stepDegrees)));
}

function worldUnitsPerPixelAtDepth(
  camera: Camera,
  depth: number,
  viewportHeight: number
): number {
  if (camera instanceof PerspectiveCamera) {
    const fovRad = (camera.fov * Math.PI) / 180;
    const worldHeight = 2 * Math.max(depth, 0.001) * Math.tan(fovRad * 0.5);
    return worldHeight / Math.max(1, viewportHeight);
  }
  const ortho = camera as any;
  const worldHeight = Math.abs((ortho.top - ortho.bottom) / (ortho.zoom || 1));
  return worldHeight / Math.max(1, viewportHeight);
}

export class RotationControlDisc extends Object3D {
  private readonly _mesh: Mesh;
  private readonly _material: ShaderMaterial;
  private readonly _plane: Plane = new Plane(PLANE_NORMAL.clone(), 0);
  private readonly _centerWorld: Vector3 = new Vector3();
  private readonly _lockedCenterWorld: Vector3 = new Vector3();
  private readonly _lockedObjectWorldPosition: Vector3 = new Vector3();
  private _anchorObject: Object3D | null = null;
  private _floorYLocal = 0;
  private _lockedInnerRadiusWorld: number | null = null;
  private _outerRadiusWorld = 0;
  private _innerRadiusWorld = 0;

  constructor() {
    super();
    this.name = 'ld-rotation-control-disc';
    this.userData.skipShadow = true;

    const geometry = new CircleGeometry(1, 128);
    geometry.rotateX(-Math.PI / 2);
    this._material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color(0x000000) },
        uOpacity: { value: 1.0 },
        uHighlightColor: { value: new Color(0x3b82f6) },
        uBaseArcOpacity: { value: BASE_ARC_OPACITY },
        uArcOpacity: { value: ARC_OPACITY },
        uMinorStepRad: { value: (DEFAULT_MINOR_STEP_DEG * Math.PI) / 180 },
        uMajorStepRad: { value: (DEFAULT_MAJOR_STEP_DEG * Math.PI) / 180 },
        uUseCustomStep: { value: 0 },
        uInnerRadius: { value: 0.75 },
        uMinorTickLength: { value: MINOR_TICK_LENGTH_RATIO },
        uMajorTickLength: { value: MAJOR_TICK_LENGTH_RATIO },
        uArcActive: { value: 0 },
        uArcStartRad: { value: 0 },
        uArcSweepRad: { value: 0 },
        uArcDirection: { value: 1 },
      },
      vertexShader: `
        varying vec2 vLocal;
        void main() {
          vLocal = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vLocal;
        uniform vec3 uColor;
        uniform vec3 uHighlightColor;
        uniform float uOpacity;
        uniform float uBaseArcOpacity;
        uniform float uArcOpacity;
        uniform float uMinorStepRad;
        uniform float uMajorStepRad;
        uniform float uUseCustomStep;
        uniform float uInnerRadius;
        uniform float uMinorTickLength;
        uniform float uMajorTickLength;
        uniform float uArcActive;
        uniform float uArcStartRad;
        uniform float uArcSweepRad;
        uniform float uArcDirection;

        float angleDistance(float angle, float step) {
          if (step <= 0.0) return 10.0;
          float wrapped = mod(angle + step * 0.5, step) - step * 0.5;
          return abs(wrapped);
        }

        void main() {
          float radius = length(vLocal);
          if (radius > 1.02 || radius < uInnerRadius - 0.02) {
            discard;
          }

          float angle = atan(vLocal.y, vLocal.x);
          if (angle < 0.0) angle += 6.28318530718;

          float minorDistance = angleDistance(angle, uMinorStepRad);
          float majorDistance = angleDistance(angle, uMajorStepRad);

          float ringStrokeWidth = ${glslFloat(CIRCLE_STROKE_THICKNESS_NORM)};
          float outerStroke = smoothstep(ringStrokeWidth, 0.0, abs(radius - 1.0));
          float ringAlpha = outerStroke;

          float gap = 1.0 - uInnerRadius;
          float minorStart = max(uInnerRadius, 1.0 - gap * uMinorTickLength);
          float minorEnd = 1.0;
          float majorStart = max(uInnerRadius, 1.0 - gap * uMajorTickLength);
          float majorEnd = 1.0;

          float tickThickness = ${glslFloat(TICK_RADIAL_THICKNESS_NORM)};
          float minorBand = smoothstep(minorStart - tickThickness, minorStart + tickThickness, radius) *
            (1.0 - smoothstep(minorEnd - tickThickness, minorEnd + tickThickness, radius));
          float majorBand = smoothstep(majorStart - tickThickness, majorStart + tickThickness, radius) *
            (1.0 - smoothstep(majorEnd - tickThickness, majorEnd + tickThickness, radius));

          float minorTickDefault = smoothstep(${glslFloat(MINOR_TICK_ANGULAR_THICKNESS_RAD)}, 0.0, minorDistance) * minorBand;
          float majorTickDefault = smoothstep(${glslFloat(MAJOR_TICK_ANGULAR_THICKNESS_RAD)}, 0.0, majorDistance) * majorBand;
          // When step mode is active, visualize step ticks as major lines.
          float stepAsMajorTick = smoothstep(${glslFloat(MAJOR_TICK_ANGULAR_THICKNESS_RAD)}, 0.0, minorDistance) * majorBand;
          float minorTick = (1.0 - uUseCustomStep) * minorTickDefault;
          float majorTick = (1.0 - uUseCustomStep) * majorTickDefault + uUseCustomStep * stepAsMajorTick;

          float arcDistance = uArcDirection >= 0.0
            ? mod(angle - uArcStartRad + 6.28318530718, 6.28318530718)
            : mod(uArcStartRad - angle + 6.28318530718, 6.28318530718);
          float arcInner = max(uInnerRadius, 1.0 - gap * uMajorTickLength);
          float arcOuter = 1.0;
          float arcBand = smoothstep(arcInner - ${glslFloat(ARC_EDGE_SOFTNESS_NORM)}, arcInner + ${glslFloat(ARC_EDGE_SOFTNESS_NORM)}, radius) *
            (1.0 - smoothstep(arcOuter - ${glslFloat(ARC_EDGE_SOFTNESS_NORM)}, arcOuter + ${glslFloat(ARC_EDGE_SOFTNESS_NORM)}, radius));
          float baseArcAlpha = arcBand * uBaseArcOpacity;
          float arcMask = uArcActive * (1.0 - smoothstep(uArcSweepRad, uArcSweepRad + 0.02, arcDistance)) * arcBand;
          float highlightArcAlpha = arcMask * uArcOpacity;

          float baseAlpha = max(ringAlpha, max(minorTick, majorTick));
          float alpha = max(baseAlpha, max(baseArcAlpha, highlightArcAlpha));
          if (alpha <= 0.001) discard;
          float highlightLuma = dot(uHighlightColor, vec3(0.2126, 0.7152, 0.0722));
          float highlightIsDark = 1.0 - step(${glslFloat(TICK_CONTRAST_LUMA_THRESHOLD)}, highlightLuma);
          float highlightOverlap = clamp(highlightArcAlpha * 4.0, 0.0, 1.0);
          vec3 tickContrastColor = mix(uColor, vec3(1.0), highlightIsDark);
          vec3 tickLayerColor = mix(uColor, tickContrastColor, highlightOverlap);
          vec3 color = vec3(0.0);
          color = mix(color, uHighlightColor, clamp(highlightArcAlpha, 0.0, 1.0));
          color = mix(color, tickLayerColor, clamp(baseAlpha, 0.0, 1.0));
          gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0) * uOpacity);
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
    });

    this._mesh = new Mesh(geometry, this._material);
    this._mesh.renderOrder = ROTATION_DISC_RENDER_ORDER;
    this._mesh.frustumCulled = false;
    this._mesh.castShadow = false;
    this._mesh.receiveShadow = false;
    this._mesh.userData.noHit = true;
    this._mesh.userData.selectable = false;
    this._mesh.userData.rotationControl = true;
    this._mesh.userData.skipShadow = true;
    this.add(this._mesh);
    this.visible = false;
  }

  lockSizeFromObject(selectedObject: Object3D, floorY: number): void {
    selectedObject.updateMatrixWorld(true);
    TMP_BOX.setFromObject(selectedObject);
    if (!Number.isFinite(TMP_BOX.min.x) || !Number.isFinite(TMP_BOX.max.x)) {
      this._lockedInnerRadiusWorld = null;
      this._anchorObject = null;
      return;
    }
    TMP_BOX.getBoundingSphere(TMP_SPHERE);
    this._lockedInnerRadiusWorld = Math.max(
      TMP_SPHERE.radius * INNER_RADIUS_FROM_BOUNDING_SPHERE,
      0.001
    );
    this._anchorObject = selectedObject;
    this._floorYLocal = floorY;
    TMP_FLOOR_WORLD.set(0, floorY, 0);
    if (selectedObject.parent) {
      selectedObject.parent.localToWorld(TMP_FLOOR_WORLD);
    }
    this._lockedCenterWorld.set(
      TMP_SPHERE.center.x,
      TMP_FLOOR_WORLD.y,
      TMP_SPHERE.center.z
    );
    selectedObject.getWorldPosition(this._lockedObjectWorldPosition);
  }

  clearLockedSize(): void {
    this._lockedInnerRadiusWorld = null;
    this._anchorObject = null;
  }

  update(args: RotationDiscUpdateArgs): void {
    const {
      selectedObject,
      camera,
      viewportWidth,
      viewportHeight,
      floorY,
      highlightColor,
      stepDegrees,
      lockSize,
    } = args;
    void highlightColor;

    if (
      lockSize ||
      this._lockedInnerRadiusWorld == null ||
      this._anchorObject !== selectedObject
    ) {
      this.lockSizeFromObject(selectedObject, floorY);
    }
    if (this._lockedInnerRadiusWorld == null || !this._anchorObject) {
      this.visible = false;
      return;
    }

    this._anchorObject.updateMatrixWorld(true);
    this._anchorObject.getWorldPosition(TMP_OBJECT_WORLD_POS);
    TMP_OBJECT_WORLD_DELTA.copy(TMP_OBJECT_WORLD_POS).sub(
      this._lockedObjectWorldPosition
    );
    this._centerWorld.copy(this._lockedCenterWorld).add(TMP_OBJECT_WORLD_DELTA);
    TMP_FLOOR_WORLD.set(0, this._floorYLocal, 0);
    if (this._anchorObject.parent) {
      this._anchorObject.parent.localToWorld(TMP_FLOOR_WORLD);
    }
    this._centerWorld.y = TMP_FLOOR_WORLD.y + DISC_SURFACE_OFFSET_M;
    this._plane.constant = -this._centerWorld.y;

    const cameraWorld = camera.getWorldPosition(TMP_EDGE);
    const depth = Math.max(cameraWorld.distanceTo(this._centerWorld), 0.001);
    const unitsPerPixel = worldUnitsPerPixelAtDepth(
      camera,
      depth,
      viewportHeight
    );
    const minRadiusWorld = MIN_DISC_RADIUS_PX * unitsPerPixel;
    const maxRadiusWorld =
      Math.min(viewportWidth, viewportHeight) *
      MAX_VIEWPORT_RATIO *
      unitsPerPixel;
    const targetInnerRadius = this._lockedInnerRadiusWorld;
    const targetOuterRadius = targetInnerRadius * OUTER_RADIUS_SCALE_FROM_INNER;
    const clampedOuterRadius = Math.min(
      Math.max(targetOuterRadius, minRadiusWorld),
      maxRadiusWorld
    );
    const clampedInnerRadius =
      clampedOuterRadius / OUTER_RADIUS_SCALE_FROM_INNER;

    this._outerRadiusWorld = Math.max(clampedOuterRadius, 0.001);
    this._innerRadiusWorld = Math.max(clampedInnerRadius, 0.001);

    this.scale.set(this._outerRadiusWorld, 1, this._outerRadiusWorld);

    this._material.uniforms.uColor.value.set(0x000000);
    this._material.uniforms.uBaseArcOpacity.value = BASE_ARC_OPACITY;
    this._material.uniforms.uArcOpacity.value = ARC_OPACITY;
    try {
      this._material.uniforms.uHighlightColor.value.set(
        highlightColor || '#3b82f6'
      );
    } catch (_) {
      this._material.uniforms.uHighlightColor.value.set('#3b82f6');
    }
    const normalizedStep = normalizeDegrees(stepDegrees);
    if (normalizedStep > 0) {
      this._material.uniforms.uMinorStepRad.value =
        (normalizedStep * Math.PI) / 180;
      this._material.uniforms.uUseCustomStep.value = 1;
    } else {
      this._material.uniforms.uMinorStepRad.value =
        (DEFAULT_MINOR_STEP_DEG * Math.PI) / 180;
      this._material.uniforms.uUseCustomStep.value = 0;
    }
    this._material.uniforms.uMajorStepRad.value =
      (DEFAULT_MAJOR_STEP_DEG * Math.PI) / 180;
    this._material.uniforms.uInnerRadius.value =
      this._innerRadiusWorld / this._outerRadiusWorld;
    this._material.uniforms.uMinorTickLength.value = MINOR_TICK_LENGTH_RATIO;
    this._material.uniforms.uMajorTickLength.value = MAJOR_TICK_LENGTH_RATIO;
    if (this.parent) {
      this.parent.updateMatrixWorld(true);
      TMP_LOCAL_CENTER.copy(this._centerWorld);
      this.position.copy(this.parent.worldToLocal(TMP_LOCAL_CENTER));
    } else {
      this.position.copy(this._centerWorld);
    }
    this.visible = true;
  }

  hide(): void {
    this.visible = false;
  }

  getCenterWorld(target: Vector3): Vector3 {
    return target.copy(this._centerWorld);
  }

  /** Angle on the floor plane from a ray (no radial hit test). */
  angleFromRay(ray: Ray): number | null {
    if (!this.visible) return null;
    const hit = ray.intersectPlane(this._plane, TMP_INTERSECTION);
    if (!hit) return null;
    return Math.atan2(
      TMP_INTERSECTION.z - this._centerWorld.z,
      TMP_INTERSECTION.x - this._centerWorld.x
    );
  }

  setDragArc(startAngleRad: number, currentAngleRad: number): void {
    const TAU_LOCAL = Math.PI * 2;
    const signedDelta = normalizeSignedAngleDelta(
      currentAngleRad - startAngleRad
    );
    const direction = signedDelta >= 0 ? 1 : -1;
    const sweep = Math.min(Math.abs(signedDelta), TAU_LOCAL);
    this._material.uniforms.uArcActive.value = sweep > 1e-6 ? 1 : 0;
    this._material.uniforms.uArcStartRad.value =
      ((startAngleRad % TAU_LOCAL) + TAU_LOCAL) % TAU_LOCAL;
    this._material.uniforms.uArcSweepRad.value = sweep;
    this._material.uniforms.uArcDirection.value = direction;
  }

  clearDragArc(): void {
    this._material.uniforms.uArcActive.value = 0;
    this._material.uniforms.uArcSweepRad.value = 0;
  }

  intersectRay(ray: Ray): RotationDiscHit | null {
    if (!this.visible) return null;
    const hit = ray.intersectPlane(this._plane, TMP_INTERSECTION);
    if (!hit) return null;

    const radialDistance = TMP_INTERSECTION.distanceTo(this._centerWorld);
    if (
      radialDistance < this._innerRadiusWorld ||
      radialDistance > this._outerRadiusWorld * 1.03
    ) {
      return null;
    }

    const angle = Math.atan2(
      TMP_INTERSECTION.z - this._centerWorld.z,
      TMP_INTERSECTION.x - this._centerWorld.x
    );
    return {
      point: TMP_INTERSECTION.clone(),
      angleRad: angle,
      distance: ray.origin.distanceTo(TMP_INTERSECTION),
    };
  }

  dispose(): void {
    this.clearDragArc();
    this.clearLockedSize();
    this.parent?.remove(this);
    this._mesh.geometry.dispose();
    this._disposeMaterial(this._mesh.material);
  }

  private _disposeMaterial(material: Material | Material[]): void {
    if (Array.isArray(material)) {
      material.forEach((entry) => this._disposeMaterial(entry));
      return;
    }
    material.dispose();
  }
}

export function consumeQuantizedRotationDelta(
  accumulatedDegrees: number,
  stepDegrees: number
): { consumedDelta: number; remaining: number } {
  const normalizedStep = normalizeDegrees(stepDegrees);
  if (normalizedStep <= 0) {
    return { consumedDelta: accumulatedDegrees, remaining: 0 };
  }
  const magnitude = Math.abs(accumulatedDegrees);
  const steps = Math.floor(magnitude / normalizedStep);
  if (steps <= 0) {
    return { consumedDelta: 0, remaining: accumulatedDegrees };
  }
  const consumedDelta = Math.sign(accumulatedDegrees) * steps * normalizedStep;
  const remaining = accumulatedDegrees - consumedDelta;
  return { consumedDelta, remaining };
}

export function normalizeSignedAngleDelta(deltaRad: number): number {
  let delta = deltaRad % TAU;
  if (delta > Math.PI) delta -= TAU;
  if (delta < -Math.PI) delta += TAU;
  return delta;
}

export function clampDiscOpacity(opacity: number): number {
  return clamp01(opacity);
}
