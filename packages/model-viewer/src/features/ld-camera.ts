//import { Spherical, Vector3 } from 'three';
//import { PerspectiveCamera } from 'three';
//import {PerspectiveCamera} from 'three';
import ModelViewerElementBase, {
  //$needsRender,
  $scene,
  // $userInputElement,
  $onModelLoad,
  $needsRender,
} from '../model-viewer-base.js';

import { $controls } from './controls.js';
//import {SmoothControls} from '../three-components/SmoothControls.js';
import { Constructor } from '../utilities.js';
import { MathUtils, Mesh, Matrix4, Quaternion, Vector3 } from 'three';

import type { ViewportGizmoHandle } from './ld-controls/viewport-gizmo.js';

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
  metadata: object;
  object: {
    [key: string]: any;
  };
};

export type CameraType = 'perspective' | 'orthographic';

const CAMERA_JSON_DEBUG =
  typeof globalThis !== 'undefined' &&
  !!(globalThis as {MODEL_VIEWER_CAMERA_JSON_DEBUG?: boolean})
    .MODEL_VIEWER_CAMERA_JSON_DEBUG;

function debugCameraJSON(label: string, data?: unknown): void {
  if (CAMERA_JSON_DEBUG) {
    console.debug(`[ld-camera] ${label}`, data);
  }
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
function normalizeControlsState(state: unknown): string | null {
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

/** Align CameraControls with a camera pose when no explicit target is stored. */
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
    position.x,
    position.y,
    position.z,
    lookAt.x,
    lookAt.y,
    lookAt.z,
    false
  );
  if (typeof cc.update === 'function') {
    cc.update(1);
  }
}

function isFiniteVector3(v: Vector3): boolean {
  return (
    Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)
  );
}

/** LDControls orbit look-at is on CameraControls, not ModelScene.setTarget. */
function usesCameraControlsLookAt(controls: any): boolean {
  return (
    controls?.thirdPartyControls &&
    typeof controls.thirdPartyControls.setLookAt === 'function'
  );
}

function resolveSavedPosition(data: any): Vector3 | null {
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

function resolveWorldLookAt(scene: any, data: any): Vector3 | null {
  if (Array.isArray(data.worldTarget) && data.worldTarget.length === 3) {
    const worldTarget = new Vector3().fromArray(data.worldTarget);
    return isFiniteVector3(worldTarget) ? worldTarget : null;
  }
  if (Array.isArray(data.target) && data.target.length === 3) {
    const modelTarget = new Vector3().fromArray(data.target);
    return isFiniteVector3(modelTarget)
      ? modelTargetToWorldSpace(scene, modelTarget)
      : null;
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

type ControlsPoseSnapshot = Partial<
  Record<(typeof CONTROLS_POSE_KEYS)[number], number[] | number>
>;

function applyControlsPoseToTemplate(
  template: Record<string, unknown>,
  pose: ControlsPoseSnapshot
): void {
  for (const key of CONTROLS_POSE_KEYS) {
    const value = pose[key];
    if (value != null) {
      template[key] = value;
    }
  }
}

function parseControlsPose(
  parsed: Record<string, unknown>
): ControlsPoseSnapshot | null {
  if (
    !Array.isArray(parsed.position) ||
    !Array.isArray(parsed.target) ||
    parsed.position.length < 3 ||
    parsed.target.length < 3
  ) {
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
  camera: any,
  data: any,
  scene?: any,
  options?: {skipZoom?: boolean}
): void {
  if (typeof data.near === 'number' && Number.isFinite(data.near)) {
    camera.near = data.near;
  }
  if (typeof data.far === 'number' && Number.isFinite(data.far)) {
    camera.far = data.far;
  }
  if (
    !options?.skipZoom &&
    typeof data.zoom === 'number' &&
    Number.isFinite(data.zoom)
  ) {
    camera.zoom = data.zoom;
  }

  if (camera.isPerspectiveCamera) {
    if (typeof data.fov === 'number' && Number.isFinite(data.fov)) {
      camera.fov = data.fov;
    }
    const viewportAspect = scene?.aspect;
    if (typeof viewportAspect === 'number' && Number.isFinite(viewportAspect)) {
      camera.aspect = viewportAspect;
    } else if (typeof data.aspect === 'number' && Number.isFinite(data.aspect)) {
      camera.aspect = data.aspect;
    }
    if (typeof data.focus === 'number' && Number.isFinite(data.focus)) {
      camera.focus = data.focus;
    }
    if (typeof data.filmGauge === 'number' && Number.isFinite(data.filmGauge)) {
      camera.filmGauge = data.filmGauge;
    }
    if (typeof data.filmOffset === 'number' && Number.isFinite(data.filmOffset)) {
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
function reconcileCameraControlsPose(
  cc: any,
  data: any,
  scene: any
): void {
  if (!cc || typeof cc.setLookAt !== 'function') {
    return;
  }

  const snapshot = data.controlsSnapshot as Record<string, unknown> | undefined;
  const pose = data.controlsPose as ControlsPoseSnapshot | undefined;

  let position: Vector3 | null = null;
  let worldTarget: Vector3 | null = null;

  if (
    snapshot &&
    Array.isArray(snapshot.position) &&
    Array.isArray(snapshot.target)
  ) {
    position = new Vector3().fromArray(snapshot.position as number[]);
    worldTarget = new Vector3().fromArray(snapshot.target as number[]);
  } else if (
    Array.isArray(pose?.position) &&
    Array.isArray(pose?.target)
  ) {
    position = new Vector3().fromArray(pose.position);
    worldTarget = new Vector3().fromArray(pose.target);
  } else {
    worldTarget = resolveWorldLookAt(scene, data);
    position = resolveSavedPosition(data);
  }

  if (
    !position ||
    !worldTarget ||
    !isFiniteVector3(position) ||
    !isFiniteVector3(worldTarget)
  ) {
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
    false
  );

  const focalOffset = (snapshot?.focalOffset ??
    pose?.focalOffset ??
    data.focalOffset) as number[] | undefined;
  if (Array.isArray(focalOffset) && focalOffset.length === 3) {
    cc.setFocalOffset(focalOffset[0], focalOffset[1], focalOffset[2], false);
  }

  const controlsZoom = (snapshot?.zoom ??
    pose?.zoom ??
    data.controlsZoom) as number | undefined;
  if (typeof controlsZoom === 'number' && Number.isFinite(controlsZoom)) {
    cc.zoomTo(controlsZoom, false);
  }

  if (typeof cc.update === 'function') {
    cc.update(0);
  }
}

/** Apply a saved CameraControls JSON string (or controlsSnapshot object). */
function restoreCameraFromControlsJSON(
  controls: any,
  camera: any,
  data: any,
  scene: any,
  controlsStateJson: string,
  debugLabel: string
): boolean {
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

  try {
    controls.fromJSON(controlsStateJson, false);
  } catch {
    return false;
  }

  reconcileCameraControlsPose(cc, data, scene);

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
    scenePivotTarget:
      typeof scene.getTarget === 'function'
        ? scene.getTarget().toArray()
        : null,
  });

  return true;
}

/**
 * Legacy fallback when only pose fields were persisted (no controlsSnapshot).
 */
function restoreCameraControlsFromPartial(
  scene: any,
  controls: any,
  camera: any,
  data: any
): boolean {
  if (
    !usesCameraControlsLookAt(controls) ||
    typeof controls.toJSON !== 'function' ||
    typeof controls.fromJSON !== 'function'
  ) {
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
    // Pose fields from the same controlsState snapshot as getCameraJSON().
    applyControlsPoseToTemplate(template, savedPose);
  } else {
    template.position = savedPosition!.toArray();
    template.target = worldLookAt!.toArray();

    if (Array.isArray(data.focalOffset) && data.focalOffset.length === 3) {
      template.focalOffset = data.focalOffset;
    }
    const controlsZoom =
      typeof data.controlsZoom === 'number' &&
      Number.isFinite(data.controlsZoom)
        ? data.controlsZoom
        : typeof data.zoom === 'number' && Number.isFinite(data.zoom)
          ? data.zoom
          : null;
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
    'setCameraFromJSON CameraControls partial merge path'
  );
}

function awaitCameraSettled(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/** Apply a stored look-at to scene pivot (SmoothControls). */
function applyStoredLookAt(
  scene: any,
  camera: any,
  modelTarget: Vector3
): void {
  if (!isFiniteVector3(modelTarget)) {
    return;
  }

  debugCameraJSON('applyStoredLookAt', {
    modelTarget: modelTarget.toArray(),
    cameraPosition: camera.position.toArray(),
    scenePivotTarget:
      typeof scene.getTarget === 'function'
        ? scene.getTarget().toArray()
        : null,
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

  setCameraFromJSON(json: CameraMeta['object']): void;
  getCameraJSON(): CameraMeta | null;

  setCameraType(type: CameraType): void;
  getCameraType(): CameraType;
  toggleCameraType(): void;
}

export const LDCameraMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDCameraInterface> & T => {
  class LDCameraModelViewerElement extends ModelViewerElement {
    private _pointerDwn = [0, 0];
    private _pointerUp = [0, 0];

    handleClick(event: MouseEvent) {
      const { _pointerDwn, _pointerUp } = this;
      const d = Math.hypot(
        _pointerUp[0] - _pointerDwn[0],
        _pointerUp[1] - _pointerDwn[1]
      );
      /* This to allow for a small drag on sensetive input devices */
      if (d > 4) return;

      const { clientX, clientY } = event;

      const scene = this[$scene];
      const ndcCoords = scene.getNDC(clientX, clientY);
      const hit = scene.hitFromPoint(ndcCoords);

      if (hit) {
        const { object } = hit;

        if (object && object.isObject3D && object.visible) {
          const detail: ClickDetails = {};
          const { material, name, geometry } = object as Mesh;

          if (name) {
            detail.mesh = name;
          }

          if (geometry) {
            detail.geometry = geometry.name;
          }

          if (typeof material !== 'undefined' && !Array.isArray(material)) {
            detail.material = material.name;
          }
          // Use 'object-click' (not 'click') to avoid re-triggering the click listener and stack overflow
          this.dispatchEvent(
            new CustomEvent<ClickDetails>('object-click', { detail })
          );
        }
      }
    }

    async resetCamera() {
      const controls = (this as any)[$controls];
      if (controls && typeof controls.reset === 'function') {
        await controls.reset();
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
        azimuth * MathUtils.DEG2RAD,
        polar * MathUtils.DEG2RAD,
        animate
      );
    }

    setCurrentAsDefaultCamera() {
      const controls = (this as any)[$controls];
      controls.saveState();
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
      let desiredType: CameraType | null = null;
      const typeValue = data.type;

      if (typeof typeValue === 'string') {
        if (typeValue === 'PerspectiveCamera') {
          desiredType = 'perspective';
        } else if (typeValue === 'OrthographicCamera') {
          desiredType = 'orthographic';
        }
      }

      if (
        desiredType &&
        typeof scene.getCameraType === 'function' &&
        scene.getCameraType() !== desiredType
      ) {
        this.setCameraType(desiredType);
      }

      // If this JSON came from our own getCameraJSON, prefer restoring the
      // CameraControls state directly for a perfect round-trip (no flips or
      // drift), and let CameraControls drive the three.js camera.
      const embeddedControlsState = normalizeControlsState(
        (data as any).controlsState ??
          (data as any).controlsSnapshot ??
          (json as any).controlsState ??
          (json as any)?.metadata?.controlsState
      );

      const camera: any = scene.camera;
      if (!camera) {
        return;
      }

      if (
        embeddedControlsState &&
        restoreCameraFromControlsJSON(
          controls,
          camera,
          data,
          scene,
          embeddedControlsState,
          'setCameraFromJSON controlsState path'
        )
      ) {
        this[$needsRender]();
        await awaitCameraSettled();
        return;
      }

      const cc = controls?.thirdPartyControls;

      if (restoreCameraControlsFromPartial(scene, controls, camera, data)) {
        this[$needsRender]();
        await awaitCameraSettled();
        return;
      }

      const savedPosition = resolveSavedPosition(data);

      // Matrix-based restore (Blender exports, SmoothControls, partial JSON).
      if (Array.isArray(data.matrix) && data.matrix.length === 16) {
        const m = new Matrix4().fromArray(data.matrix);
        camera.matrixAutoUpdate = false;
        camera.matrix.copy(m);
        camera.matrix.decompose(
          camera.position,
          camera.quaternion,
          camera.scale
        );
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
        const modelTarget = new Vector3().fromArray(data.target);
        applyStoredLookAt(scene, camera, modelTarget);
        if (usesCameraControlsLookAt(controls)) {
          const worldTarget = modelTargetToWorldSpace(scene, modelTarget);
          cc.setLookAt(
            camera.position.x,
            camera.position.y,
            camera.position.z,
            worldTarget.x,
            worldTarget.y,
            worldTarget.z,
            false
          );
          cc.update(1);
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
    getCameraJSON(): CameraMeta | null {
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
        type: isPerspective
          ? 'PerspectiveCamera'
          : isOrthographic
            ? 'OrthographicCamera'
            : 'Camera',
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

      // Include the current look-at in model (pivot) space. Prefer CameraControls
      // (updated on pan/truck) over scene.getTarget() (only moves via attributes
      // or tap-recenter in LDControls).
      if (
        controls &&
        controls.thirdPartyControls &&
        typeof controls.thirdPartyControls.getTarget === 'function'
      ) {
        const worldTarget = new Vector3();
        controls.thirdPartyControls.getTarget(worldTarget);
        const modelTarget = worldTargetToModelSpace(scene, worldTarget);
        object.worldTarget = worldTarget.toArray();
        object.target = modelTarget.toArray();
        debugCameraJSON('getCameraJSON target from CameraControls', {
          worldTarget: object.worldTarget,
          modelTarget: object.target,
          scenePivotTarget:
            typeof scene.getTarget === 'function'
              ? scene.getTarget().toArray()
              : null,
        });
      } else if (scene && typeof scene.getTarget === 'function') {
        const modelTarget = scene.getTarget();
        object.target = [modelTarget.x, modelTarget.y, modelTarget.z];
      }
      if (
        object.target == null &&
        scene?.boundingBox &&
        !scene.boundingBox.isEmpty()
      ) {
        const center = scene.boundingBox.getCenter(new Vector3());
        object.target = [center.x, center.y, center.z];
      }

      let controlsState: any = undefined;
      if (controls && typeof controls.toJSON === 'function') {
        try {
          controlsState = controls.toJSON();
          const parsedControls = JSON.parse(controlsState);
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

      // For internal round-trips (UI presets, captureImage, etc), also embed
      // the CameraControls state directly on the object so that consumers that
      // only persist meta.object still get a perfect restore path.
      if (controlsState != null) {
        object.controlsState = controlsState;
      }

      const meta: CameraMeta = {
        metadata: {
          version: 1,
          generator: '@london-dynamics/model-viewer LDCamera',
          controlsState,
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
      let currentPosition: Vector3 | null = null;
      let currentTarget: Vector3 | null = null;

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
                false
              );
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
      if (
        scene.effectRenderer &&
        typeof scene.effectRenderer.setMainCamera === 'function'
      ) {
        scene.effectRenderer.setMainCamera(scene.camera);
      }

      // Update viewport gizmo with new camera
      const gizmoHandle = (this as any)
        .viewportGizmoHandle as ViewportGizmoHandle | null;
      if (gizmoHandle) {
        gizmoHandle.updateCamera(scene.camera);
      }

      this.dispatchEvent(
        new CustomEvent<CameraTypeChangeDetails>('camera-type-change', {
          detail: {
            from: previousType,
            to: type,
          },
        })
      );

      this[$needsRender]();
    }

    /**
     * Get the current camera type
     */
    getCameraType(): 'perspective' | 'orthographic' {
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

      const { currentGLTF } = this[$scene];

      if (currentGLTF != null) {
      }

      this.addEventListener('pointerdown', (e) => {
        this._pointerDwn = [e.offsetX, e.offsetY];
      });
      this.addEventListener('pointerup', (e) => {
        this._pointerUp = [e.offsetX, e.offsetY];
      });
      this.addEventListener('click', this.handleClick);
    }
  }
  // @ts-ignore
  return LDCameraModelViewerElement;
};
