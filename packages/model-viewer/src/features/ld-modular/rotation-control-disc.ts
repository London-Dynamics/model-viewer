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

// --- Customisation (edit these) -----------------------------------------------

const ROTATION_DISC_DEFAULT_MINOR_STEP_DEG = 7.5;
const ROTATION_DISC_DEFAULT_MAJOR_STEP_DEG = 45;

/** Minimum on-screen disc radius in CSS pixels. */
const ROTATION_DISC_MIN_RADIUS_PX = 96;

/** Fill behind the full disc annulus (the “frisbee” background). */
const ROTATION_DISC_BASE_ARC_COLOR = '#ffffff';
const ROTATION_DISC_BASE_ARC_OPACITY = 0.9;

const ROTATION_DISC_OUTER_RING_COLOR = '#3f3f46';
const ROTATION_DISC_OUTER_RING_OPACITY = 1;
/** Normalised radial stroke width at the outer ring (shader radius 1.0). */
const ROTATION_DISC_OUTER_RING_THICKNESS = 0.01;

const ROTATION_DISC_MINOR_TICK_COLOR = '#71717a';
const ROTATION_DISC_MAJOR_TICK_COLOR = '#3f3f46';
const ROTATION_DISC_TICK_OPACITY = 1;
/** Radial extent of minor ticks as a fraction of annulus width (0–1). */
const ROTATION_DISC_MINOR_TICK_LENGTH = 0.4;
/** Radial extent of major ticks / highlight arc band (0–1). */
const ROTATION_DISC_MAJOR_TICK_LENGTH = 0.8;
/** Angular half-width of minor ticks in degrees. */
const ROTATION_DISC_MINOR_TICK_THICKNESS_DEG = 0.008 * (180 / Math.PI);
/** Angular half-width of major ticks in degrees. */
const ROTATION_DISC_MAJOR_TICK_THICKNESS_DEG = 0.01 * (180 / Math.PI);

/**
 * Outer ÷ inner radius of the annulus (clickable band and tick/highlight span).
 * 1.25 → annulus is 20% of the outer radius in normalised shader space.
 */
const ROTATION_DISC_OUTER_TO_INNER_RATIO = 1.25;

// --- Internal -----------------------------------------------------------------

const rotationDiscRenderOrder = 9800;
const tau = Math.PI * 2;
const maxViewportRatio = 0.8;
const innerRadiusFromBoundingSphere = 0.8;
const baseArcOvershootRatio = 0.12;
const maxAnnulusGapNorm = 1 - 1 / ROTATION_DISC_OUTER_TO_INNER_RATIO;
const discMeshRadiusNorm = 1 + baseArcOvershootRatio * maxAnnulusGapNorm;
const bandEdgeAaScale = 0.75;
const highlightArcOpacity = 1;
const discSurfaceOffsetM = 0.003;
const minStepEpsilon = 1e-5;
const hitTestOuterRadiusSlack = 1.03;
const highlightArcSweepEdgeSoftness = 0.02;
const tickHighlightLumaThreshold = 0.45;
const tickHighlightContrastAmount = 0.92;
const discMasterOpacity = 1;
const tmpContrastColor = new Color();
const planeNormal = new Vector3(0, 1, 0);
const tmpBox = new Box3();
const tmpSphere = new Sphere();
const tmpEdge = new Vector3();
const tmpIntersection = new Vector3();
const tmpLocalCenter = new Vector3();
const tmpFloorWorld = new Vector3();
const tmpObjectWorldPos = new Vector3();
const tmpObjectWorldDelta = new Vector3();

function glslFloat(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

function degreesToRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function linearLumaFromColor(color: Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

function linearLumaFromHex(hex: string): number {
  tmpContrastColor.set(hex);
  return linearLumaFromColor(tmpContrastColor);
}

/** Pick tick stroke colour that contrasts with the highlight arc fill. */
function updateTickHighlightContrastUniforms(
  uniforms: ShaderMaterial['uniforms'],
  highlightColorHex: string
): void {
  const highlightLuma = linearLumaFromHex(highlightColorHex);
  const highlightIsLight = highlightLuma >= tickHighlightLumaThreshold;
  uniforms.uTickHighlightContrastTarget.value.set(
    highlightIsLight ? 0x000000 : 0xffffff
  );
  uniforms.uTickHighlightContrastAmount.value = tickHighlightContrastAmount;
}

function applyRotationDiscAppearanceUniforms(
  uniforms: ShaderMaterial['uniforms'],
  highlightColorHex: string = '#3b82f6'
): void {
  uniforms.uBaseArcColor.value.set(ROTATION_DISC_BASE_ARC_COLOR);
  uniforms.uBaseArcOpacity.value = ROTATION_DISC_BASE_ARC_OPACITY;
  uniforms.uHighlightArcOpacity.value = highlightArcOpacity;
  updateTickHighlightContrastUniforms(uniforms, highlightColorHex);
  uniforms.uRingColor.value.set(ROTATION_DISC_OUTER_RING_COLOR);
  uniforms.uRingOpacity.value = ROTATION_DISC_OUTER_RING_OPACITY;
  uniforms.uRingStrokeWidth.value = ROTATION_DISC_OUTER_RING_THICKNESS;
  uniforms.uMinorTickColor.value.set(ROTATION_DISC_MINOR_TICK_COLOR);
  uniforms.uMajorTickColor.value.set(ROTATION_DISC_MAJOR_TICK_COLOR);
  uniforms.uTickOpacity.value = ROTATION_DISC_TICK_OPACITY;
  uniforms.uMinorTickLength.value = ROTATION_DISC_MINOR_TICK_LENGTH;
  uniforms.uMajorTickLength.value = ROTATION_DISC_MAJOR_TICK_LENGTH;
  uniforms.uMinorTickAngularThickness.value = degreesToRad(
    ROTATION_DISC_MINOR_TICK_THICKNESS_DEG
  );
  uniforms.uMajorTickAngularThickness.value = degreesToRad(
    ROTATION_DISC_MAJOR_TICK_THICKNESS_DEG
  );
  uniforms.uMinorStepRad.value = degreesToRad(
    ROTATION_DISC_DEFAULT_MINOR_STEP_DEG
  );
  uniforms.uMajorStepRad.value = degreesToRad(
    ROTATION_DISC_DEFAULT_MAJOR_STEP_DEG
  );
  uniforms.uOpacity.value = discMasterOpacity;
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
  if (!Number.isFinite(stepDegrees) || Math.abs(stepDegrees) < minStepEpsilon) {
    return 0;
  }
  return Math.min(360, Math.max(minStepEpsilon, Math.abs(stepDegrees)));
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
  private readonly _plane: Plane = new Plane(planeNormal.clone(), 0);
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

    const geometry = new CircleGeometry(discMeshRadiusNorm, 128);
    geometry.rotateX(-Math.PI / 2);
    this._material = new ShaderMaterial({
      uniforms: {
        uBaseArcColor: { value: new Color() },
        uBaseArcOpacity: { value: ROTATION_DISC_BASE_ARC_OPACITY },
        uHighlightColor: { value: new Color(0x3b82f6) },
        uHighlightArcOpacity: { value: highlightArcOpacity },
        uRingColor: { value: new Color() },
        uRingOpacity: { value: ROTATION_DISC_OUTER_RING_OPACITY },
        uRingStrokeWidth: { value: ROTATION_DISC_OUTER_RING_THICKNESS },
        uMinorTickColor: { value: new Color() },
        uMajorTickColor: { value: new Color() },
        uTickOpacity: { value: ROTATION_DISC_TICK_OPACITY },
        uOpacity: { value: discMasterOpacity },
        uMinorStepRad: {
          value: degreesToRad(ROTATION_DISC_DEFAULT_MINOR_STEP_DEG),
        },
        uMajorStepRad: {
          value: degreesToRad(ROTATION_DISC_DEFAULT_MAJOR_STEP_DEG),
        },
        uUseCustomStep: { value: 0 },
        uInnerRadius: { value: 0.75 },
        uMinorTickLength: { value: ROTATION_DISC_MINOR_TICK_LENGTH },
        uMajorTickLength: { value: ROTATION_DISC_MAJOR_TICK_LENGTH },
        uMinorTickAngularThickness: {
          value: degreesToRad(ROTATION_DISC_MINOR_TICK_THICKNESS_DEG),
        },
        uMajorTickAngularThickness: {
          value: degreesToRad(ROTATION_DISC_MAJOR_TICK_THICKNESS_DEG),
        },
        uArcActive: { value: 0 },
        uArcStartRad: { value: 0 },
        uArcSweepRad: { value: 0 },
        uArcDirection: { value: 1 },
        uTickHighlightContrastTarget: { value: new Color(0xffffff) },
        uTickHighlightContrastAmount: { value: tickHighlightContrastAmount },
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
        uniform vec3 uBaseArcColor;
        uniform float uBaseArcOpacity;
        uniform vec3 uHighlightColor;
        uniform float uHighlightArcOpacity;
        uniform vec3 uRingColor;
        uniform float uRingOpacity;
        uniform float uRingStrokeWidth;
        uniform vec3 uMinorTickColor;
        uniform vec3 uMajorTickColor;
        uniform float uTickOpacity;
        uniform float uOpacity;
        uniform float uMinorStepRad;
        uniform float uMajorStepRad;
        uniform float uUseCustomStep;
        uniform float uInnerRadius;
        uniform float uMinorTickLength;
        uniform float uMajorTickLength;
        uniform float uMinorTickAngularThickness;
        uniform float uMajorTickAngularThickness;
        uniform float uArcActive;
        uniform float uArcStartRad;
        uniform float uArcSweepRad;
        uniform float uArcDirection;
        uniform vec3 uTickHighlightContrastTarget;
        uniform float uTickHighlightContrastAmount;

        float angleDistance(float angle, float step) {
          if (step <= 0.0) return 10.0;
          float wrapped = mod(angle + step * 0.5, step) - step * 0.5;
          return abs(wrapped);
        }

        float radialBand(float radius, float inner, float outer) {
          float aa = fwidth(radius) * ${glslFloat(bandEdgeAaScale)};
          return smoothstep(inner - aa, inner + aa, radius) *
            (1.0 - smoothstep(outer - aa, outer + aa, radius));
        }

        vec4 overLayer(vec4 dst, vec3 rgb, float a) {
          float srcA = clamp(a, 0.0, 1.0);
          float outA = srcA + dst.a * (1.0 - srcA);
          if (outA <= 0.0) return vec4(0.0);
          vec3 outRgb = (rgb * srcA + dst.rgb * dst.a * (1.0 - srcA)) / outA;
          return vec4(outRgb, outA);
        }

        void main() {
          float radius = length(vLocal);
          float gap = 1.0 - uInnerRadius;
          float baseArcOvershoot = gap * ${glslFloat(baseArcOvershootRatio)};
          float baseArcInner = uInnerRadius - baseArcOvershoot;
          float baseArcOuter = 1.0 + baseArcOvershoot;
          if (radius > baseArcOuter || radius < baseArcInner) {
            discard;
          }

          float angle = atan(vLocal.y, vLocal.x);
          if (angle < 0.0) angle += 6.28318530718;

          float minorDistance = angleDistance(angle, uMinorStepRad);
          float majorDistance = angleDistance(angle, uMajorStepRad);

          float outerStroke = smoothstep(uRingStrokeWidth, 0.0, abs(radius - 1.0));
          float ringAlpha = outerStroke * uRingOpacity;

          float minorStart = max(uInnerRadius, 1.0 - gap * uMinorTickLength);
          float minorEnd = 1.0;
          float majorStart = max(uInnerRadius, 1.0 - gap * uMajorTickLength);
          float majorEnd = 1.0;

          float minorBand = radialBand(radius, minorStart, minorEnd);
          float majorBand = radialBand(radius, majorStart, majorEnd);

          float minorTickDefault = smoothstep(uMinorTickAngularThickness, 0.0, minorDistance) * minorBand;
          float majorTickDefault = smoothstep(uMajorTickAngularThickness, 0.0, majorDistance) * majorBand;
          float stepAsMajorTick = smoothstep(uMajorTickAngularThickness, 0.0, minorDistance) * majorBand;
          float majorTick = (1.0 - uUseCustomStep) * majorTickDefault + uUseCustomStep * stepAsMajorTick;
          float minorTick = (1.0 - uUseCustomStep) * minorTickDefault * (1.0 - step(0.001, majorTickDefault));
          float tickMask = max(minorTick, majorTick);
          vec3 tickRgb = mix(uMinorTickColor, uMajorTickColor, step(0.001, majorTick));
          float tickAlpha = tickMask * uTickOpacity;

          float arcDistance = uArcDirection >= 0.0
            ? mod(angle - uArcStartRad + 6.28318530718, 6.28318530718)
            : mod(uArcStartRad - angle + 6.28318530718, 6.28318530718);
          float arcInner = uInnerRadius;
          float arcOuter = 1.0;
          float arcBand = radialBand(radius, arcInner, arcOuter);
          float baseArcBand = radialBand(radius, baseArcInner, baseArcOuter);
          float baseArcAlpha = baseArcBand * uBaseArcOpacity;
          float arcMask = uArcActive * (1.0 - smoothstep(uArcSweepRad, uArcSweepRad + ${glslFloat(highlightArcSweepEdgeSoftness)}, arcDistance)) * arcBand;
          float highlightArcAlpha = arcMask * uHighlightArcOpacity;
          float highlightOverTick = clamp(arcMask * uHighlightArcOpacity * 5.0, 0.0, 1.0) * tickMask;
          tickRgb = mix(
            tickRgb,
            uTickHighlightContrastTarget,
            highlightOverTick * uTickHighlightContrastAmount
          );

          vec4 layer = vec4(0.0);
          layer = overLayer(layer, uBaseArcColor, baseArcAlpha);
          layer = overLayer(layer, uHighlightColor, highlightArcAlpha);
          layer = overLayer(layer, uRingColor, ringAlpha);
          layer = overLayer(layer, tickRgb, tickAlpha);
          if (layer.a <= 0.001) discard;
          gl_FragColor = vec4(layer.rgb, layer.a * uOpacity);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    applyRotationDiscAppearanceUniforms(this._material.uniforms, '#3b82f6');

    this._mesh = new Mesh(geometry, this._material);
    this._mesh.renderOrder = rotationDiscRenderOrder;
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
    tmpBox.setFromObject(selectedObject);
    if (!Number.isFinite(tmpBox.min.x) || !Number.isFinite(tmpBox.max.x)) {
      this._lockedInnerRadiusWorld = null;
      this._anchorObject = null;
      return;
    }
    tmpBox.getBoundingSphere(tmpSphere);
    this._lockedInnerRadiusWorld = Math.max(
      tmpSphere.radius * innerRadiusFromBoundingSphere,
      0.001
    );
    this._anchorObject = selectedObject;
    this._floorYLocal = floorY;
    tmpFloorWorld.set(0, floorY, 0);
    if (selectedObject.parent) {
      selectedObject.parent.localToWorld(tmpFloorWorld);
    }
    this._lockedCenterWorld.set(
      tmpSphere.center.x,
      tmpFloorWorld.y,
      tmpSphere.center.z
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
    this._anchorObject.getWorldPosition(tmpObjectWorldPos);
    tmpObjectWorldDelta
      .copy(tmpObjectWorldPos)
      .sub(this._lockedObjectWorldPosition);
    this._centerWorld.copy(this._lockedCenterWorld).add(tmpObjectWorldDelta);
    tmpFloorWorld.set(0, this._floorYLocal, 0);
    if (this._anchorObject.parent) {
      this._anchorObject.parent.localToWorld(tmpFloorWorld);
    }
    this._centerWorld.y = tmpFloorWorld.y + discSurfaceOffsetM;
    this._plane.constant = -this._centerWorld.y;

    const cameraWorld = camera.getWorldPosition(tmpEdge);
    const depth = Math.max(cameraWorld.distanceTo(this._centerWorld), 0.001);
    const unitsPerPixel = worldUnitsPerPixelAtDepth(
      camera,
      depth,
      viewportHeight
    );
    const minRadiusWorld = ROTATION_DISC_MIN_RADIUS_PX * unitsPerPixel;
    const maxRadiusWorld =
      Math.min(viewportWidth, viewportHeight) *
      maxViewportRatio *
      unitsPerPixel;
    const targetInnerRadius = this._lockedInnerRadiusWorld;
    const targetOuterRadius =
      targetInnerRadius * ROTATION_DISC_OUTER_TO_INNER_RATIO;
    const clampedOuterRadius = Math.min(
      Math.max(targetOuterRadius, minRadiusWorld),
      maxRadiusWorld
    );
    const clampedInnerRadius =
      clampedOuterRadius / ROTATION_DISC_OUTER_TO_INNER_RATIO;

    this._outerRadiusWorld = Math.max(clampedOuterRadius, 0.001);
    this._innerRadiusWorld = Math.max(clampedInnerRadius, 0.001);

    this.scale.set(this._outerRadiusWorld, 1, this._outerRadiusWorld);

    const activeHighlightColor = highlightColor || '#3b82f6';
    applyRotationDiscAppearanceUniforms(
      this._material.uniforms,
      activeHighlightColor
    );
    if (highlightColor) {
      try {
        this._material.uniforms.uHighlightColor.value.set(highlightColor);
      } catch (_) {
        // Keep the previous colour when the attribute value is invalid.
      }
    }

    const normalizedStep = normalizeDegrees(stepDegrees);
    if (normalizedStep > 0) {
      this._material.uniforms.uMinorStepRad.value =
        (normalizedStep * Math.PI) / 180;
      this._material.uniforms.uUseCustomStep.value = 1;
    } else {
      this._material.uniforms.uMinorStepRad.value = degreesToRad(
        ROTATION_DISC_DEFAULT_MINOR_STEP_DEG
      );
      this._material.uniforms.uUseCustomStep.value = 0;
    }
    this._material.uniforms.uMajorStepRad.value = degreesToRad(
      ROTATION_DISC_DEFAULT_MAJOR_STEP_DEG
    );
    this._material.uniforms.uInnerRadius.value =
      this._innerRadiusWorld / this._outerRadiusWorld;

    if (this.parent) {
      this.parent.updateMatrixWorld(true);
      tmpLocalCenter.copy(this._centerWorld);
      this.position.copy(this.parent.worldToLocal(tmpLocalCenter));
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
    const hit = ray.intersectPlane(this._plane, tmpIntersection);
    if (!hit) return null;
    return Math.atan2(
      tmpIntersection.z - this._centerWorld.z,
      tmpIntersection.x - this._centerWorld.x
    );
  }

  setDragArc(startAngleRad: number, currentAngleRad: number): void {
    const signedDelta = normalizeSignedAngleDelta(
      currentAngleRad - startAngleRad
    );
    const direction = signedDelta >= 0 ? 1 : -1;
    const sweep = Math.min(Math.abs(signedDelta), tau);
    this._material.uniforms.uArcActive.value = sweep > 1e-6 ? 1 : 0;
    this._material.uniforms.uArcStartRad.value =
      ((startAngleRad % tau) + tau) % tau;
    this._material.uniforms.uArcSweepRad.value = sweep;
    this._material.uniforms.uArcDirection.value = direction;
  }

  clearDragArc(): void {
    this._material.uniforms.uArcActive.value = 0;
    this._material.uniforms.uArcSweepRad.value = 0;
  }

  intersectRay(ray: Ray): RotationDiscHit | null {
    if (!this.visible) return null;
    const hit = ray.intersectPlane(this._plane, tmpIntersection);
    if (!hit) return null;

    const radialDistance = tmpIntersection.distanceTo(this._centerWorld);
    if (
      radialDistance < this._innerRadiusWorld ||
      radialDistance > this._outerRadiusWorld * hitTestOuterRadiusSlack
    ) {
      return null;
    }

    const angle = Math.atan2(
      tmpIntersection.z - this._centerWorld.z,
      tmpIntersection.x - this._centerWorld.x
    );
    return {
      point: tmpIntersection.clone(),
      angleRad: angle,
      distance: ray.origin.distanceTo(tmpIntersection),
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
  let delta = deltaRad % tau;
  if (delta > Math.PI) delta -= tau;
  if (delta < -Math.PI) delta += tau;
  return delta;
}

export function clampDiscOpacity(opacity: number): number {
  return clamp01(opacity);
}
