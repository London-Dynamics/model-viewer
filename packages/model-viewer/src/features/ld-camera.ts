import {Box3, CubicBezierCurve3, MathUtils, Matrix4, Mesh, Quaternion, Vector3,} from 'three';

import ModelViewerElementBase, {$needsRender, $onModelLoad, $scene,} from '../model-viewer-base.js';
import {Constructor} from '../utilities.js';

import {$controls} from './controls.js';

import type {ViewportGizmoHandle} from './ld-controls/viewport-gizmo.js';

export interface ClickDetails {
  geometry?: string;
  material?: string;
  mesh?: string;
}

export interface CameraTypeChangeDetails {
  from: CameraType;
  to: CameraType;
}

type CameraMeta = {
  metadata: object; object: {[key: string]: any;};
};

export type CameraType = 'perspective'|'orthographic';
export type CameraControlMode = 'orbit'|'fps';

export type CameraView = CameraMeta['object']|{
  controlMode?: CameraControlMode;
  cameraOrbit?: string;
  cameraTarget?: string;
  fieldOfView?: string;
  enableKeyboardMove?: boolean;
  enableFlyMode?: boolean;
};

export type CameraEasing =|'linear'|'easeInSine'|'easeOutSine'|'easeInOutSine'|
    'easeInQuad'|'easeOutQuad'|'easeInOutQuad'|'easeInCubic'|'easeOutCubic'|
    'easeInOutCubic'|'easeInQuart'|'easeOutQuart'|'easeInOutQuart'|
    'easeInQuint'|'easeOutQuint'|'easeInOutQuint'|'easeInExpo'|'easeOutExpo'|
    'easeInOutExpo'|'easeInCirc'|'easeOutCirc'|'easeInOutCirc'|'easeInBack'|
    'easeOutBack'|'easeInOutBack'|'easeInElastic'|'easeOutElastic'|
    'easeInOutElastic'|'easeInBounce'|'easeOutBounce'|'easeInOutBounce';

export interface CameraAnimationOptions {
  duration?: number;
  easing?: CameraEasing;
  avoidSubject?: boolean;
  avoidMargin?: number;
}

interface CameraPose {
  position: Vector3;
  target: Vector3;
  fov?: number;
}

const CAMERA_JSON_DEBUG = typeof globalThis !== 'undefined' &&
    !!(globalThis as {
        MODEL_VIEWER_CAMERA_JSON_DEBUG?: boolean
      }).MODEL_VIEWER_CAMERA_JSON_DEBUG;

function debugCameraJSON(label: string, data?: unknown): void {
  if (CAMERA_JSON_DEBUG) {
    console.debug(`[ld-camera] ${label}`, data);
  }
}

const easeOutBounce = (x: number): number => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) {
    return n1 * x * x;
  }
  if (x < 2 / d1) {
    return n1 * (x -= 1.5 / d1) * x + 0.75;
  }
  if (x < 2.5 / d1) {
    return n1 * (x -= 2.25 / d1) * x + 0.9375;
  }
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

const CAMERA_EASINGS: Record<CameraEasing, (x: number) => number> = {
  linear: (x) => x,
  easeInSine: (x) => 1 - Math.cos((x * Math.PI) / 2),
  easeOutSine: (x) => Math.sin((x * Math.PI) / 2),
  easeInOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
  easeInQuad: (x) => x * x,
  easeOutQuad: (x) => 1 - (1 - x) * (1 - x),
  easeInOutQuad: (x) => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2,
  easeInCubic: (x) => x * x * x,
  easeOutCubic: (x) => 1 - Math.pow(1 - x, 3),
  easeInOutCubic: (x) =>
      x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2,
  easeInQuart: (x) => x * x * x * x,
  easeOutQuart: (x) => 1 - Math.pow(1 - x, 4),
  easeInOutQuart: (x) =>
      x < 0.5 ? 8 * x * x * x * x : 1 - Math.pow(-2 * x + 2, 4) / 2,
  easeInQuint: (x) => x * x * x * x * x,
  easeOutQuint: (x) => 1 - Math.pow(1 - x, 5),
  easeInOutQuint: (x) =>
      x < 0.5 ? 16 * x * x * x * x * x : 1 - Math.pow(-2 * x + 2, 5) / 2,
  easeInExpo: (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
  easeOutExpo: (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  easeInOutExpo: (x) => x === 0 ? 0 :
      x === 1                   ? 1 :
      x < 0.5                   ? Math.pow(2, 20 * x - 10) / 2 :
                                  (2 - Math.pow(2, -20 * x + 10)) / 2,
  easeInCirc: (x) => 1 - Math.sqrt(1 - Math.pow(x, 2)),
  easeOutCirc: (x) => Math.sqrt(1 - Math.pow(x - 1, 2)),
  easeInOutCirc: (x) => x < 0.5 ?
      (1 - Math.sqrt(1 - Math.pow(2 * x, 2))) / 2 :
      (Math.sqrt(1 - Math.pow(-2 * x + 2, 2)) + 1) / 2,
  easeInBack: (x) => 2.70158 * x * x * x - 1.70158 * x * x,
  easeOutBack: (x) =>
      1 + 2.70158 * Math.pow(x - 1, 3) + 1.70158 * Math.pow(x - 1, 2),
  easeInOutBack: (x) => {
    const c1 = 1.70158;
    const c2 = c1 * 1.525;
    return x < 0.5 ?
        (Math.pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2 :
        (Math.pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2;
  },
  easeInElastic: (x) => x === 0 ? 0 :
      x === 1                   ? 1 :
                                  -Math.pow(2, 10 * x - 10) *
          Math.sin((x * 10 - 10.75) * ((2 * Math.PI) / 3)),
  easeOutElastic: (x) => x === 0 ? 0 :
      x === 1                    ? 1 :
                                   Math.pow(2, -10 * x) *
              Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) +
          1,
  easeInOutElastic: (x) => x === 0 ? 0 :
      x === 1                      ? 1 :
      x < 0.5                      ? -(Math.pow(2, 20 * x - 10) *
                  Math.sin((20 * x - 11.125) * ((2 * Math.PI) / 4.5))) /
          2 :
                (Math.pow(2, -20 * x + 10) *
                 Math.sin((20 * x - 11.125) * ((2 * Math.PI) / 4.5))) /
              2 +
          1,
  easeInBounce: (x) => 1 - easeOutBounce(1 - x),
  easeOutBounce,
  easeInOutBounce: (x) => x < 0.5 ? (1 - easeOutBounce(1 - 2 * x)) / 2 :
                                    (1 + easeOutBounce(2 * x - 1)) / 2,
};

function getCameraEasing(name?: string): (x: number) => number {
  return CAMERA_EASINGS[(name as CameraEasing) || 'easeInOutQuad'] ??
      CAMERA_EASINGS.easeInOutQuad;
}

function hasAttributeStyleCameraView(data: any): boolean {
  return (
      typeof data?.cameraOrbit === 'string' ||
      typeof data?.cameraTarget === 'string' ||
      typeof data?.fieldOfView === 'string');
}

/** Convert a world-space look-at point to model (pivot) space. */
function worldTargetToModelSpace(scene: any, worldTarget: Vector3): Vector3 {
  const modelTarget = worldTarget.clone();
  if (scene?.pivot && typeof scene.pivot.worldToLocal === 'function') {
    scene.updateMatrixWorld(true);
    scene.pivot.worldToLocal(modelTarget);
  }
  return modelTarget;
}

/** Convert a model-space orbit center to world space. */
function modelTargetToWorldSpace(scene: any, modelTarget: Vector3): Vector3 {
  const worldTarget = modelTarget.clone();
  if (scene?.pivot && typeof scene.pivot.localToWorld === 'function') {
    scene.updateMatrixWorld(true);
    scene.pivot.localToWorld(worldTarget);
  }
  return worldTarget;
}

/** camera-controls fromJSON expects a JSON string; tolerate parsed objects. */
function normalizeControlsState(state: unknown): string|null {
  if (state == null) {
    return null;
  }
  if (typeof state === 'string') {
    return state;
  }
  if (typeof state === 'object') {
    return JSON.stringify(state);
  }
  return null;
}

/**
 * Align CameraControls with a camera pose when no explicit target is stored.
 */
function syncControlsFromCameraPose(camera: any, controls: any): void {
  const cc = controls?.thirdPartyControls;
  if (!cc || typeof cc.setLookAt !== 'function') {
    return;
  }

  const position = camera.position;
  const forward = new Vector3();
  camera.getWorldDirection(forward);
  const lookAt = position.clone().add(forward);

  cc.setLookAt(
      position.x, position.y, position.z, lookAt.x, lookAt.y, lookAt.z, false);
  if (typeof cc.update === 'function') {
    cc.update(1);
  }
}

function isFiniteVector3(v: Vector3): boolean {
  return (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z));
}

/** LDControls orbit look-at is on CameraControls, not ModelScene.setTarget. */
function usesCameraControlsLookAt(controls: any): boolean {
  return (
      controls?.thirdPartyControls &&
      typeof controls.thirdPartyControls.setLookAt === 'function');
}

function resolveSavedPosition(data: any): Vector3|null {
  if (Array.isArray(data.position) && data.position.length === 3) {
    const position = new Vector3().fromArray(data.position);
    return isFiniteVector3(position) ? position : null;
  }
  if (Array.isArray(data.matrix) && data.matrix.length === 16) {
    const position = new Vector3();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    new Matrix4().fromArray(data.matrix).decompose(position, quaternion, scale);
    return isFiniteVector3(position) ? position : null;
  }
  return null;
}

function resolveWorldLookAt(scene: any, data: any): Vector3|null {
  if (Array.isArray(data.worldTarget) && data.worldTarget.length === 3) {
    const worldTarget = new Vector3().fromArray(data.worldTarget);
    return isFiniteVector3(worldTarget) ? worldTarget : null;
  }
  if (Array.isArray(data.target) && data.target.length === 3) {
    const modelTarget = new Vector3().fromArray(data.target);
    return isFiniteVector3(modelTarget) ?
        modelTargetToWorldSpace(scene, modelTarget) :
        null;
  }
  return null;
}

const CONTROLS_POSE_KEYS = [
  'position',
  'target',
  'focalOffset',
  'zoom',
  'target0',
  'position0',
  'focalOffset0',
  'zoom0',
] as const;

type ControlsPoseSnapshot =
    Partial<Record<(typeof CONTROLS_POSE_KEYS)[number], number[]|number>>;

function applyControlsPoseToTemplate(
    template: Record<string, unknown>, pose: ControlsPoseSnapshot): void {
  for (const key of CONTROLS_POSE_KEYS) {
    const value = pose[key];
    if (value != null) {
      template[key] = value;
    }
  }
}

function parseControlsPose(parsed: Record<string, unknown>):
    ControlsPoseSnapshot|null {
  if (!Array.isArray(parsed.position) || !Array.isArray(parsed.target) ||
      parsed.position.length < 3 || parsed.target.length < 3) {
    return null;
  }

  const pose: ControlsPoseSnapshot = {
    position: parsed.position as number[],
    target: parsed.target as number[],
  };

  if (Array.isArray(parsed.focalOffset)) {
    pose.focalOffset = parsed.focalOffset as number[];
  }
  if (typeof parsed.zoom === 'number') {
    pose.zoom = parsed.zoom;
  }
  if (Array.isArray(parsed.target0)) {
    pose.target0 = parsed.target0 as number[];
  }
  if (Array.isArray(parsed.position0)) {
    pose.position0 = parsed.position0 as number[];
  }
  if (Array.isArray(parsed.focalOffset0)) {
    pose.focalOffset0 = parsed.focalOffset0 as number[];
  }
  if (typeof parsed.zoom0 === 'number') {
    pose.zoom0 = parsed.zoom0;
  }

  return pose;
}

function applyProjectionFromData(
    camera: any, data: any, scene?: any, options?: {skipZoom?: boolean}): void {
  if (typeof data.near === 'number' && Number.isFinite(data.near)) {
    camera.near = data.near;
  }
  if (typeof data.far === 'number' && Number.isFinite(data.far)) {
    camera.far = data.far;
  }
  if (!options?.skipZoom && typeof data.zoom === 'number' &&
      Number.isFinite(data.zoom)) {
    camera.zoom = data.zoom;
  }

  if (camera.isPerspectiveCamera) {
    if (typeof data.fov === 'number' && Number.isFinite(data.fov)) {
      camera.fov = data.fov;
    }
    const viewportAspect = scene?.aspect;
    if (typeof viewportAspect === 'number' && Number.isFinite(viewportAspect)) {
      camera.aspect = viewportAspect;
    } else if (
        typeof data.aspect === 'number' && Number.isFinite(data.aspect)) {
      camera.aspect = data.aspect;
    }
    if (typeof data.focus === 'number' && Number.isFinite(data.focus)) {
      camera.focus = data.focus;
    }
    if (typeof data.filmGauge === 'number' && Number.isFinite(data.filmGauge)) {
      camera.filmGauge = data.filmGauge;
    }
    if (typeof data.filmOffset === 'number' &&
        Number.isFinite(data.filmOffset)) {
      camera.filmOffset = data.filmOffset;
    }
  }

  if (camera.isOrthographicCamera) {
    if (typeof data.left === 'number' && Number.isFinite(data.left)) {
      camera.left = data.left;
    }
    if (typeof data.right === 'number' && Number.isFinite(data.right)) {
      camera.right = data.right;
    }
    if (typeof data.top === 'number' && Number.isFinite(data.top)) {
      camera.top = data.top;
    }
    if (typeof data.bottom === 'number' && Number.isFinite(data.bottom)) {
      camera.bottom = data.bottom;
    }
  }
}

/**
 * Force CameraControls to match the saved pose. Uses controlsSnapshot
 * position/target (CC world space, without focal offset) because
 * object.position includes focal offset applied by CC.update().
 */
function reconcileCameraControlsPose(cc: any, data: any, scene: any): void {
  if (!cc || typeof cc.setLookAt !== 'function') {
    return;
  }

  const snapshot = data.controlsSnapshot as Record<string, unknown>| undefined;
  const pose = data.controlsPose as ControlsPoseSnapshot | undefined;

  let position: Vector3|null = null;
  let worldTarget: Vector3|null = null;

  if (snapshot && Array.isArray(snapshot.position) &&
      Array.isArray(snapshot.target)) {
    position = new Vector3().fromArray(snapshot.position as number[]);
    worldTarget = new Vector3().fromArray(snapshot.target as number[]);
  } else if (Array.isArray(pose?.position) && Array.isArray(pose?.target)) {
    position = new Vector3().fromArray(pose.position);
    worldTarget = new Vector3().fromArray(pose.target);
  } else {
    worldTarget = resolveWorldLookAt(scene, data);
    position = resolveSavedPosition(data);
  }

  if (!position || !worldTarget || !isFiniteVector3(position) ||
      !isFiniteVector3(worldTarget)) {
    return;
  }

  cc.stop();
  cc.setLookAt(
      position.x,
      position.y,
      position.z,
      worldTarget.x,
      worldTarget.y,
      worldTarget.z,
      false);

  const focalOffset = (snapshot?.focalOffset ?? pose?.focalOffset ??
                       data.focalOffset) as number[] |
      undefined;
  if (Array.isArray(focalOffset) && focalOffset.length === 3) {
    cc.setFocalOffset(focalOffset[0], focalOffset[1], focalOffset[2], false);
  }

  const controlsZoom =
      (snapshot?.zoom ?? pose?.zoom ?? data.controlsZoom) as number | undefined;
  if (typeof controlsZoom === 'number' && Number.isFinite(controlsZoom)) {
    cc.zoomTo(controlsZoom, false);
  }

  if (typeof cc.update === 'function') {
    cc.update(0);
  }

  if (typeof cc.stop === 'function') {
    cc.stop();
  }
  if (typeof cc.update === 'function') {
    cc.update(0);
  }
}

/**
 * camera-controls stop() snaps pose but leaves smoothDamp velocities intact.
 */
function zeroCameraControlsVelocities(cc: any): void {
  if (!cc) {
    return;
  }
  if (cc._thetaVelocity) {
    cc._thetaVelocity.value = 0;
  }
  if (cc._phiVelocity) {
    cc._phiVelocity.value = 0;
  }
  if (cc._radiusVelocity) {
    cc._radiusVelocity.value = 0;
  }
  if (cc._zoomVelocity) {
    cc._zoomVelocity.value = 0;
  }
  if (cc._targetVelocity?.set) {
    cc._targetVelocity.set(0, 0, 0);
  }
  if (cc._focalOffsetVelocity?.set) {
    cc._focalOffsetVelocity.set(0, 0, 0);
  }
}

/** Snap CameraControls and flush pending smoothTime interpolation. */
function settleCameraControls(cc: any): void {
  if (!cc) {
    return;
  }
  if (typeof cc.stop === 'function') {
    cc.stop();
  }
  zeroCameraControlsVelocities(cc);
  if (typeof cc.update === 'function') {
    for (let i = 0; i < 3; ++i) {
      cc.update(0);
    }
  }
  cc._needsUpdate = false;
}

/** Apply a saved CameraControls JSON string (or controlsSnapshot object). */
function restoreCameraFromControlsJSON(
    controls: any,
    camera: any,
    data: any,
    scene: any,
    controlsStateJson: string,
    debugLabel: string): boolean {
  if (!controls || typeof controls.fromJSON !== 'function') {
    return false;
  }

  const cc = controls.thirdPartyControls;
  if (cc && typeof cc.stop === 'function') {
    cc.stop();
  }

  // Projection first so CC collision / near-plane math uses the saved lens.
  applyProjectionFromData(camera, data, scene, {skipZoom: true});
  if (Array.isArray(data.up) && data.up.length === 3) {
    camera.up.fromArray(data.up);
  }
  camera.updateProjectionMatrix();

  const hasSnapshotObject = data.controlsSnapshot != null &&
      typeof data.controlsSnapshot === 'object';

  // fromJSON uses moveTo/rotateTo/dollyTo which leave smoothDamp velocities
  // running; reconcile setLookAt then looks correct for one frame before the
  // render loop drifts back. Legacy strings still need fromJSON.
  if (!hasSnapshotObject) {
    try {
      controls.fromJSON(controlsStateJson, false);
    } catch {
      return false;
    }
  }

  reconcileCameraControlsPose(cc, data, scene);
  settleCameraControls(cc);

  if (cc && typeof cc.saveState === 'function') {
    cc.saveState();
  }

  camera.matrixAutoUpdate = true;
  camera.updateMatrixWorld(true);

  const restoredControlsTarget = new Vector3();
  if (cc && typeof cc.getTarget === 'function') {
    cc.getTarget(restoredControlsTarget);
  }

  debugCameraJSON(debugLabel, {
    position: camera.position.toArray(),
    controlsTarget: restoredControlsTarget.toArray(),
    fov: camera.isPerspectiveCamera ? camera.fov : undefined,
    aspect: camera.isPerspectiveCamera ? camera.aspect : undefined,
    near: camera.near,
    scenePivotTarget: typeof scene.getTarget === 'function' ?
        scene.getTarget().toArray() :
        null,
  });

  return true;
}

/**
 * Legacy fallback when only pose fields were persisted (no controlsSnapshot).
 */
function restoreCameraControlsFromPartial(
    scene: any, controls: any, camera: any, data: any): boolean {
  if (!usesCameraControlsLookAt(controls) ||
      typeof controls.toJSON !== 'function' ||
      typeof controls.fromJSON !== 'function') {
    return false;
  }

  const savedPose = data.controlsPose as ControlsPoseSnapshot | undefined;
  const savedPosition = resolveSavedPosition(data);
  const worldLookAt = resolveWorldLookAt(scene, data);

  if (!savedPose && (!savedPosition || !worldLookAt)) {
    return false;
  }

  let template: Record<string, unknown>;
  try {
    template = JSON.parse(controls.toJSON());
  } catch {
    return false;
  }

  if (savedPose) {
    // Pose fields from the same controls snapshot as getCameraJSON().
    applyControlsPoseToTemplate(template, savedPose);
  } else {
    template.position = savedPosition!.toArray();
    template.target = worldLookAt!.toArray();

    if (Array.isArray(data.focalOffset) && data.focalOffset.length === 3) {
      template.focalOffset = data.focalOffset;
    }
    const controlsZoom = typeof data.controlsZoom === 'number' &&
            Number.isFinite(data.controlsZoom) ?
        data.controlsZoom :
        typeof data.zoom === 'number' && Number.isFinite(data.zoom) ?
        data.zoom :
        null;
    if (controlsZoom != null) {
      template.zoom = controlsZoom;
    }
  }

  return restoreCameraFromControlsJSON(
      controls,
      camera,
      data,
      scene,
      JSON.stringify(template),
      'setCameraFromJSON CameraControls partial merge path');
}

function awaitCameraSettled(cc?: any): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0;
    const step = () => {
      if (cc) {
        settleCameraControls(cc);
      }
      frames += 1;
      if (frames >= 4) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function readCameraPose(scene: any, controls: any): CameraPose|null {
  const camera = scene?.camera;
  if (!camera) {
    return null;
  }

  camera.updateMatrixWorld(true);
  const target = new Vector3();
  if (controls?.thirdPartyControls?.getTarget) {
    controls.thirdPartyControls.getTarget(target);
  } else {
    camera.getWorldDirection(target);
    target.add(camera.position);
  }

  return {
    position: camera.position.clone(),
    target,
    fov: camera.isPerspectiveCamera ? camera.fov : undefined,
  };
}

function cameraPoseFromView(scene: any, view: CameraView): CameraPose|null {
  const data: any = (view as any)?.object ?? view;
  if (!data || hasAttributeStyleCameraView(data)) {
    return null;
  }

  const position = resolveSavedPosition(data);
  const target = resolveWorldLookAt(scene, data);
  if (!position || !target) {
    return null;
  }

  return {
    position,
    target,
    fov: typeof data.fov === 'number' && Number.isFinite(data.fov) ? data.fov :
                                                                     undefined,
  };
}

function applyCameraViewControlOptions(
    element: any,
    view: CameraView,
    options: {enableKeyboardMove?: boolean, enableFlyMode?: boolean} = {}) {
  const data: any = (view as any)?.object ?? view;
  const controlMode = data?.controlMode as CameraControlMode | undefined;
  if (controlMode && typeof element.setCameraControlsMode === 'function') {
    element.setCameraControlsMode(controlMode, {
      enableKeyboardMove: data.enableKeyboardMove ?? options.enableKeyboardMove,
      enableFlyMode: data.enableFlyMode ?? options.enableFlyMode,
    });
    return;
  }

  if (options.enableKeyboardMove != null) {
    element.fpsKeyboardMove = options.enableKeyboardMove;
  }
  if (options.enableFlyMode != null) {
    element.fpsFlyMode = options.enableFlyMode;
  }
}

function applyCameraPose(
    pose: CameraPose, scene: any, controls: any, needsRender: () => void):
    void {
  const camera = scene?.camera;
  const cc = controls?.thirdPartyControls;
  if (!camera || !cc?.setLookAt) {
    return;
  }

  cc.setLookAt(
      pose.position.x,
      pose.position.y,
      pose.position.z,
      pose.target.x,
      pose.target.y,
      pose.target.z,
      false);

  if (pose.fov != null && camera.isPerspectiveCamera) {
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();
  }

  cc.update(0);
  camera.updateMatrixWorld(true);
  needsRender();
}

function segmentIntersectsBox(
    start: Vector3, end: Vector3, box: Box3): boolean {
  const sample = new Vector3();
  for (let i = 0; i <= 32; ++i) {
    sample.lerpVectors(start, end, i / 32);
    if (box.containsPoint(sample)) {
      return true;
    }
  }
  return false;
}

function avoidDirection(start: Vector3, end: Vector3, box: Box3): Vector3 {
  const center = box.getCenter(new Vector3());
  const midpoint = start.clone().lerp(end, 0.5);
  const direction = midpoint.sub(center);

  if (direction.lengthSq() > 0.000001) {
    return direction.normalize();
  }

  const path = end.clone().sub(start).normalize();
  direction.crossVectors(path, new Vector3(0, 1, 0));
  if (direction.lengthSq() <= 0.000001) {
    direction.set(1, 0, 0);
  }
  return direction.normalize();
}

function cameraCurve(
    start: Vector3, end: Vector3, avoidBox: Box3|null): CubicBezierCurve3 {
  const controlA = start.clone().lerp(end, 1 / 3);
  const controlB = start.clone().lerp(end, 2 / 3);

  if (avoidBox && segmentIntersectsBox(start, end, avoidBox)) {
    const size = avoidBox.getSize(new Vector3());
    const margin = Math.max(size.length() * 0.5, 0.001);
    const offset = avoidDirection(start, end, avoidBox).multiplyScalar(margin);
    controlA.add(offset);
    controlB.add(offset);
  }

  return new CubicBezierCurve3(start.clone(), controlA, controlB, end.clone());
}

/** Apply a stored look-at to scene pivot (SmoothControls). */
function applyStoredLookAt(
    scene: any, camera: any, modelTarget: Vector3): void {
  if (!isFiniteVector3(modelTarget)) {
    return;
  }

  debugCameraJSON('applyStoredLookAt', {
    modelTarget: modelTarget.toArray(),
    cameraPosition: camera.position.toArray(),
    scenePivotTarget: typeof scene.getTarget === 'function' ?
        scene.getTarget().toArray() :
        null,
  });

  if (typeof scene.setTarget === 'function') {
    scene.setTarget(modelTarget.x, modelTarget.y, modelTarget.z);
    if (typeof scene.jumpToGoal === 'function') {
      scene.jumpToGoal();
    }
  }
}

export declare interface LDCameraInterface {
  resetCamera(): Promise<void>;
  rotateCamera(azimuth: number, polar: number, animate?: boolean): void;

  setCurrentAsDefaultCamera(): void;

  setCameraFromJSON(json: CameraMeta['object']): Promise<void>;
  getCameraJSON(): CameraMeta|null;
  setCameraView(view: CameraView, options?: {
    animate?: false;
    enableKeyboardMove?: boolean,
    enableFlyMode?: boolean
  }): Promise<void>;
  animateCameraTo(view: CameraView, options?: CameraAnimationOptions):
      Promise<void>;
  truckCamera(x: number, y: number, z?: number): void;

  setCameraType(type: CameraType): void;
  getCameraType(): CameraType;
  toggleCameraType(): void;
}

export const LDCameraMixin = <T extends Constructor<ModelViewerElementBase>>(
    ModelViewerElement: T): Constructor<LDCameraInterface>&T => {
  class LDCameraModelViewerElement extends ModelViewerElement {
    private _pointerDwn = [0, 0];
    private _pointerUp = [0, 0];
    private _interactionListenersAttached = false;
    private _cameraAnimationCancel: (() => void)|null = null;

    private _onPointerDown = (event: PointerEvent) => {
      this._pointerDwn = [event.offsetX, event.offsetY];
    };

    private _onPointerUp = (event: PointerEvent) => {
      this._pointerUp = [event.offsetX, event.offsetY];
    };

    private _onClick = (event: MouseEvent) => {
      this.handleClick(event);
    };

    handleClick(event: MouseEvent) {
      const {_pointerDwn, _pointerUp} = this;
      const d = Math.hypot(
          _pointerUp[0] - _pointerDwn[0], _pointerUp[1] - _pointerDwn[1]);
      /* This to allow for a small drag on sensetive input devices */
      if (d > 4)
        return;

      const {clientX, clientY} = event;

      const scene = this[$scene];
      const ndcCoords = scene.getNDC(clientX, clientY);
      const hit = scene.hitFromPoint(ndcCoords);

      if (hit) {
        const {object} = hit;

        if (object && object.isObject3D && object.visible) {
          const detail: ClickDetails = {};
          const {material, name, geometry} = object as Mesh;

          if (name) {
            detail.mesh = name;
          }

          if (geometry) {
            detail.geometry = geometry.name;
          }

          if (typeof material !== 'undefined' && !Array.isArray(material)) {
            detail.material = material.name;
          }
          // Use 'object-click' (not 'click') to avoid re-triggering the click
          // listener and stack overflow
          this.dispatchEvent(
              new CustomEvent<ClickDetails>('object-click', {detail}));
        }
      }
    }

    async resetCamera() {
      const controls = (this as any)[$controls];
      const cc = controls?.thirdPartyControls;
      if (cc && typeof cc.stop === 'function') {
        cc.stop();
      }
      if (controls && typeof controls.reset === 'function') {
        await controls.reset();
      }
      settleCameraControls(cc);
      this[$needsRender]();
    }

    /** Truck the CameraControls look-at (simulates user pan). */
    truckCamera(x: number, y: number, z: number = 0) {
      const controls = (this as any)[$controls];
      const cc = controls?.thirdPartyControls;
      if (!cc) {
        return;
      }

      if (typeof cc.stop === 'function') {
        cc.stop();
      }
      if (typeof cc.truck === 'function') {
        cc.truck(x, y, false);
      }
      if (z !== 0 && typeof cc.forward === 'function') {
        cc.forward(z, false);
      }
      if (typeof cc.update === 'function') {
        cc.update(0);
      }
      this[$needsRender]();
    }

    /**
     *
     * @param azimuth number horisontal angle in degrees;
     * @param polar number vertical angle in degrees;
     */
    rotateCamera(azimuth: number, polar: number, animate: boolean = false) {
      const controls = (this as any)[$controls];
      controls.rotateTo(
          azimuth * MathUtils.DEG2RAD, polar * MathUtils.DEG2RAD, animate);
    }

    setCurrentAsDefaultCamera() {
      const controls = (this as any)[$controls];
      controls.saveState();
    }

    async setCameraView(view: CameraView, options: {
      animate?: false;
      enableKeyboardMove?: boolean,
      enableFlyMode?: boolean
    } = {}) {
      const data: any = (view as any)?.object ?? view;
      if (!data || typeof data !== 'object') {
        return;
      }

      applyCameraViewControlOptions(this, data, options);

      if (hasAttributeStyleCameraView(data)) {
        if (typeof data.cameraOrbit === 'string') {
          (this as any).cameraOrbit = data.cameraOrbit;
        }
        if (typeof data.cameraTarget === 'string') {
          (this as any).cameraTarget = data.cameraTarget;
        }
        if (typeof data.fieldOfView === 'string') {
          (this as any).fieldOfView = data.fieldOfView;
        }
        await (this as any).updateComplete;
        if (typeof (this as any).jumpCameraToGoal === 'function') {
          (this as any).jumpCameraToGoal();
        }
        await (this as any).updateComplete;
        this[$needsRender]();
        return;
      }

      await this.setCameraFromJSON(data);
    }

    async animateCameraTo(
        view: CameraView, options: CameraAnimationOptions = {}) {
      const scene = this[$scene];
      const controls = (this as any)[$controls] as any;
      const start = readCameraPose(scene, controls);
      if (!start) {
        return;
      }

      if (this._cameraAnimationCancel) {
        this._cameraAnimationCancel();
        this._cameraAnimationCancel = null;
      }

      applyCameraViewControlOptions(this, view);
      let end = cameraPoseFromView(scene, view);
      if (!end) {
        await this.setCameraView(view);
        end = readCameraPose(scene, controls);
      }
      if (!end) {
        return;
      }

      applyCameraPose(start, scene, controls, () => this[$needsRender]());

      const duration = Math.max(0, options.duration ?? 300);
      if (duration === 0) {
        applyCameraPose(end, scene, controls, () => this[$needsRender]());
        return;
      }

      const avoidBox = options.avoidSubject && scene?.boundingBox &&
              !scene.boundingBox.isEmpty() ?
          scene.boundingBox.clone().expandByScalar(
              Math.max(0, options.avoidMargin ?? 0.25)) :
          null;
      const positionCurve = cameraCurve(start.position, end.position, avoidBox);
      const targetAvoidBox = avoidBox &&
              !avoidBox.containsPoint(start.target) &&
              !avoidBox.containsPoint(end.target) ?
          avoidBox :
          null;
      const targetCurve = cameraCurve(start.target, end.target, targetAvoidBox);
      const easing = getCameraEasing(options.easing);
      const startFov = start.fov;
      const endFov = end.fov;

      await new Promise<void>((resolve) => {
        let cancelled = false;
        const startedAt = performance.now();
        this._cameraAnimationCancel = () => {
          cancelled = true;
          resolve();
        };

        const step = (now: number) => {
          if (cancelled) {
            return;
          }

          const rawProgress = Math.min(1, (now - startedAt) / duration);
          const progress = easing(rawProgress);
          const pose: CameraPose = {
            position: positionCurve.getPoint(progress),
            target: targetCurve.getPoint(progress),
          };

          if (startFov != null && endFov != null) {
            pose.fov = MathUtils.lerp(startFov, endFov, progress);
          }

          applyCameraPose(pose, scene, controls, () => this[$needsRender]());

          if (rawProgress < 1) {
            requestAnimationFrame(step);
            return;
          }

          applyCameraPose(end, scene, controls, () => this[$needsRender]());
          this._cameraAnimationCancel = null;
          resolve();
        };

        requestAnimationFrame(step);
      });
    }

    /**
     * Apply a three.js-style camera JSON object (or CameraMeta.object) to the
     * current scene camera, while keeping CameraControls in sync.
     */
    async setCameraFromJSON(json: CameraMeta['object']) {
      // Support being passed either the raw object or a full CameraMeta.
      const data: any = (json as any)?.object ?? json;

      const scene = this[$scene];
      const controls = (this as any)[$controls] as any;

      if (!scene || !scene.camera || !data || typeof data !== 'object') {
        return;
      }

      // Ensure the underlying camera class matches the incoming payload before
      // any controls-state restore path, since switching camera type replaces
      // camera/control instances.
      let desiredType: CameraType|null = null;
      const typeValue = data.type;

      if (typeof typeValue === 'string') {
        if (typeValue === 'PerspectiveCamera') {
          desiredType = 'perspective';
        } else if (typeValue === 'OrthographicCamera') {
          desiredType = 'orthographic';
        }
      }

      if (desiredType && typeof scene.getCameraType === 'function' &&
          scene.getCameraType() !== desiredType) {
        this.setCameraType(desiredType);
      }

      // Prefer controlsSnapshot (parsed object persisted by the host). Legacy
      // controlsState strings are still accepted for older saved data.
      const embeddedControlsState = normalizeControlsState(
          (data as any).controlsSnapshot ?? (data as any).controlsState ??
          (json as any)?.metadata?.controlsState);

      const camera: any = scene.camera;
      if (!camera) {
        return;
      }

      if (embeddedControlsState &&
          restoreCameraFromControlsJSON(
              controls,
              camera,
              data,
              scene,
              embeddedControlsState,
              'setCameraFromJSON controlsSnapshot path')) {
        this[$needsRender]();
        await awaitCameraSettled(controls?.thirdPartyControls);
        return;
      }

      const cc = controls?.thirdPartyControls;

      if (restoreCameraControlsFromPartial(scene, controls, camera, data)) {
        this[$needsRender]();
        await awaitCameraSettled(cc);
        return;
      }

      const savedPosition = resolveSavedPosition(data);

      // Matrix-based restore (Blender exports, SmoothControls, partial JSON).
      if (Array.isArray(data.matrix) && data.matrix.length === 16) {
        const m = new Matrix4().fromArray(data.matrix);
        camera.matrixAutoUpdate = false;
        camera.matrix.copy(m);
        camera.matrix.decompose(
            camera.position, camera.quaternion, camera.scale);
      } else {
        if (savedPosition) {
          camera.position.copy(savedPosition);
        }
        if (Array.isArray(data.quaternion) && data.quaternion.length === 4) {
          camera.quaternion.fromArray(data.quaternion);
        }
        camera.updateMatrix();
      }

      if (Array.isArray(data.up) && data.up.length === 3) {
        camera.up.fromArray(data.up);
      }

      applyProjectionFromData(camera, data, scene);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      if (cc && typeof cc.stop === 'function') {
        cc.stop();
      }

      const hasExplicitTarget =
          Array.isArray(data.target) && data.target.length === 3;

      if (hasExplicitTarget) {
        if (usesCameraControlsLookAt(controls)) {
          const worldTarget = resolveWorldLookAt(scene, data);
          if (worldTarget) {
            cc.setLookAt(
                camera.position.x,
                camera.position.y,
                camera.position.z,
                worldTarget.x,
                worldTarget.y,
                worldTarget.z,
                false);
            cc.update(0);
          }
        } else {
          const modelTarget = new Vector3().fromArray(data.target);
          applyStoredLookAt(scene, camera, modelTarget);
        }
      } else {
        syncControlsFromCameraPose(camera, controls);
      }

      camera.matrixAutoUpdate = true;
      this[$needsRender]();
    }

    /**
     * Export the current camera as a three.js-style JSON structure that can be
     * used both by Blender scripts and to restore camera state later.
     */
    getCameraJSON(): CameraMeta|null {
      const scene = this[$scene];
      const camera: any = scene?.camera;

      if (!camera) {
        return null;
      }

      // Ensure we are serializing the latest transform.
      camera.updateMatrixWorld(true);
      camera.updateMatrix();

      const controls = (this as any)[$controls] as any;

      const isPerspective = !!camera.isPerspectiveCamera;
      const isOrthographic = !!camera.isOrthographicCamera;
      const object: any = {
        // three.js compatible identifiers
        type: isPerspective ? 'PerspectiveCamera' :
            isOrthographic  ? 'OrthographicCamera' :
                              'Camera',
        matrix: camera.matrix.toArray(),
        position: camera.position.toArray(),
        quaternion: camera.quaternion.toArray(),
        up: camera.up.toArray(),
        zoom: camera.zoom,
        near: camera.near,
        far: camera.far,
      };

      if (isPerspective) {
        object.fov = camera.fov;
        object.aspect = camera.aspect;
        object.focus = camera.focus;
        object.filmGauge = camera.filmGauge;
        object.filmOffset = camera.filmOffset;
      } else if (isOrthographic) {
        object.left = camera.left;
        object.right = camera.right;
        object.top = camera.top;
        object.bottom = camera.bottom;
      }

      // Include the current look-at in model (pivot) space. Prefer
      // CameraControls (updated on pan/truck) over scene.getTarget() (only
      // moves via attributes or tap-recenter in LDControls).
      if (controls && controls.thirdPartyControls &&
          typeof controls.thirdPartyControls.getTarget === 'function') {
        const worldTarget = new Vector3();
        controls.thirdPartyControls.getTarget(worldTarget);
        const modelTarget = worldTargetToModelSpace(scene, worldTarget);
        object.worldTarget = worldTarget.toArray();
        object.target = modelTarget.toArray();
        debugCameraJSON('getCameraJSON target from CameraControls', {
          worldTarget: object.worldTarget,
          modelTarget: object.target,
          scenePivotTarget: typeof scene.getTarget === 'function' ?
              scene.getTarget().toArray() :
              null,
        });
      } else if (scene && typeof scene.getTarget === 'function') {
        const modelTarget = scene.getTarget();
        object.target = [modelTarget.x, modelTarget.y, modelTarget.z];
      }
      if (object.target == null && scene?.boundingBox &&
          !scene.boundingBox.isEmpty()) {
        const center = scene.boundingBox.getCenter(new Vector3());
        object.target = [center.x, center.y, center.z];
      }

      // Persist CameraControls as a parsed snapshot (host-friendly object).
      // Do not emit controlsState (JSON string); restore uses controlsSnapshot.
      if (controls && typeof controls.toJSON === 'function') {
        try {
          const parsedControls = JSON.parse(controls.toJSON());
          object.controlsSnapshot = parsedControls;
          const controlsPose = parseControlsPose(parsedControls);
          if (controlsPose) {
            object.controlsPose = controlsPose;
          }
          if (Array.isArray(parsedControls.focalOffset)) {
            object.focalOffset = parsedControls.focalOffset;
          }
          if (typeof parsedControls.zoom === 'number') {
            object.controlsZoom = parsedControls.zoom;
          }
        } catch {
          // If CameraControls serialization fails, continue without it.
        }
      }

      const meta: CameraMeta = {
        metadata: {
          version: 1,
          generator: '@london-dynamics/model-viewer LDCamera',
        },
        object,
      };

      return meta;
    }

    /**
     * Set the camera type to either perspective or orthographic
     */
    setCameraType(type: CameraType) {
      const scene = this[$scene];
      const previousType = scene.getCameraType();

      if (previousType === type) {
        return;
      }

      const controls = (this as any)[$controls];

      // Store current camera state before switching
      let currentPosition: Vector3|null = null;
      let currentTarget: Vector3|null = null;

      if (controls && controls.thirdPartyControls) {
        // Save current camera position and target
        currentPosition = scene.camera.position.clone();
        currentTarget = new Vector3();
        controls.thirdPartyControls.getTarget(currentTarget);
      }

      // Switch camera type (this preserves position and rotation)
      scene.setCameraType(type);

      // Update controls to use the new camera
      if (controls) {
        // For third-party controls adapter (camera-controls)
        if (controls.thirdPartyControls) {
          // Use the updateCamera method if available (proper reinitialization)
          if (typeof controls.updateCamera === 'function') {
            controls.updateCamera(scene.camera);
          } else {
            // Fallback: Update camera reference and restore position
            controls.thirdPartyControls.camera = scene.camera;

            if (currentPosition && currentTarget) {
              controls.thirdPartyControls.setLookAt(
                  currentPosition.x,
                  currentPosition.y,
                  currentPosition.z,
                  currentTarget.x,
                  currentTarget.y,
                  currentTarget.z,
                  false);
            }
            controls.thirdPartyControls.update(0);
          }
        }
        // For SmoothControls
        else if (controls.camera) {
          // Update the readonly camera property
          Object.defineProperty(controls, 'camera', {
            value: scene.camera,
            writable: false,
            configurable: true,
          });
        }
      }

      // Update effect renderer if present
      if (scene.effectRenderer &&
          typeof scene.effectRenderer.setMainCamera === 'function') {
        scene.effectRenderer.setMainCamera(scene.camera);
      }

      // Update viewport gizmo with new camera
      const gizmoHandle =
          (this as any).viewportGizmoHandle as ViewportGizmoHandle | null;
      if (gizmoHandle) {
        gizmoHandle.updateCamera(scene.camera);
      }

      this.dispatchEvent(
          new CustomEvent<CameraTypeChangeDetails>('camera-type-change', {
            detail: {
              from: previousType,
              to: type,
            },
          }));

      this[$needsRender]();
    }

    /**
     * Get the current camera type
     */
    getCameraType(): 'perspective'|'orthographic' {
      return this[$scene].getCameraType();
    }

    /**
     * Toggle between perspective and orthographic camera
     */
    toggleCameraType() {
      const currentType = this.getCameraType();
      const newType =
          currentType === 'perspective' ? 'orthographic' : 'perspective';
      this.setCameraType(newType);
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      // $onModelLoad fires on every src change; attach interaction listeners
      // once so reloading a model does not stack duplicate handlers.
      if (!this._interactionListenersAttached) {
        this._interactionListenersAttached = true;
        this.addEventListener('pointerdown', this._onPointerDown);
        this.addEventListener('pointerup', this._onPointerUp);
        this.addEventListener('click', this._onClick);
      }
    }
  }
  // @ts-ignore
  return LDCameraModelViewerElement;
};
