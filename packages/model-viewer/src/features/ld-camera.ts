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
import { MathUtils, Mesh, Matrix4, Vector3 } from 'three';

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

export declare interface LDCameraInterface {
  resetCamera(): void;
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

    resetCamera() {
      const controls = (this as any)[$controls];
      controls.reset();
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
      const embeddedControlsState =
        (data as any).controlsState ??
        (json as any).controlsState ??
        (json as any)?.metadata?.controlsState;

      if (
        embeddedControlsState &&
        controls &&
        typeof controls.fromJSON === 'function'
      ) {
        const cc = controls.thirdPartyControls;
        if (cc && typeof cc.stop === 'function') {
          cc.stop();
        }

        try {
          controls.fromJSON(embeddedControlsState, false);
        } catch {
          // If this fails, fall back to manual application below.
        }

        // Ensure camera and scene are up to date with the restored controls.
        const camera: any = scene.camera;
        if (cc && typeof cc.update === 'function') {
          cc.update(1);
        }
        if (camera) {
          camera.matrixAutoUpdate = true;
          camera.updateProjectionMatrix();
          camera.updateMatrixWorld(true);
        }

        if (typeof scene.jumpToGoal === 'function') {
          scene.jumpToGoal();
        }

        this[$needsRender]();
        return;
      }

      const camera: any = scene.camera;
      if (!camera) {
        return;
      }

      // 2. Apply transform from three.js-style camera JSON
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
        if (Array.isArray(data.position) && data.position.length === 3) {
          camera.position.fromArray(data.position);
        }
        if (Array.isArray(data.quaternion) && data.quaternion.length === 4) {
          camera.quaternion.fromArray(data.quaternion);
        }
        camera.updateMatrix();
      }

      if (Array.isArray(data.up) && data.up.length === 3) {
        camera.up.fromArray(data.up);
      }

      // 3. Apply projection parameters (Perspective & Orthographic)
      if (typeof data.near === 'number' && Number.isFinite(data.near)) {
        camera.near = data.near;
      }
      if (typeof data.far === 'number' && Number.isFinite(data.far)) {
        camera.far = data.far;
      }
      if (typeof data.zoom === 'number' && Number.isFinite(data.zoom)) {
        camera.zoom = data.zoom;
      }

      if (camera.isPerspectiveCamera) {
        if (typeof data.fov === 'number' && Number.isFinite(data.fov)) {
          camera.fov = data.fov;
        }
        if (typeof data.aspect === 'number' && Number.isFinite(data.aspect)) {
          camera.aspect = data.aspect;
        }
        if (typeof data.focus === 'number' && Number.isFinite(data.focus)) {
          camera.focus = data.focus;
        }
        if (
          typeof data.filmGauge === 'number' &&
          Number.isFinite(data.filmGauge)
        ) {
          camera.filmGauge = data.filmGauge;
        }
        if (
          typeof data.filmOffset === 'number' &&
          Number.isFinite(data.filmOffset)
        ) {
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

      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      // 4. Sync orbit target and CameraControls so there is no residual interpolation (wobble).
      // Stop any ongoing transition first, then set position/target, then re-enable camera updates.
      const cc = controls?.thirdPartyControls;
      if (cc && typeof cc.stop === 'function') {
        cc.stop();
      }

      // Stored target is in model (pivot) space so round-trip preserves the same center.
      // When JSON has no target (e.g. Blender export), keep the scene's current orbit
      // center so any GLB works and we don't assume origin or bbox center.
      const modelTarget = new Vector3();
      if (Array.isArray(data.target) && data.target.length === 3) {
        modelTarget.fromArray(data.target);
      } else if (scene && typeof scene.getTarget === 'function') {
        modelTarget.copy(scene.getTarget());
      } else if (
        controls &&
        controls.thirdPartyControls &&
        typeof controls.thirdPartyControls.getTarget === 'function'
      ) {
        const oldWorld = new Vector3();
        controls.thirdPartyControls.getTarget(oldWorld);
        if (scene.pivot && typeof scene.pivot.worldToLocal === 'function') {
          scene.updateMatrixWorld(true);
          modelTarget.copy(oldWorld);
          scene.pivot.worldToLocal(modelTarget);
        } else {
          modelTarget.copy(oldWorld);
        }
      }

      if (
        Number.isFinite(modelTarget.x) &&
        Number.isFinite(modelTarget.y) &&
        Number.isFinite(modelTarget.z)
      ) {
        if (typeof scene.setTarget === 'function') {
          scene.setTarget(modelTarget.x, modelTarget.y, modelTarget.z);
          if (typeof scene.jumpToGoal === 'function') {
            scene.jumpToGoal();
          }
        }

        // Read back target from scene (model space) and convert to world for controls
        scene.updateMatrixWorld(true);
        const worldTarget = new Vector3();
        if (scene && typeof scene.getDynamicTarget === 'function') {
          worldTarget.copy(scene.getDynamicTarget());
        } else {
          worldTarget.copy(modelTarget);
        }
        if (scene.pivot && typeof scene.pivot.localToWorld === 'function') {
          scene.pivot.localToWorld(worldTarget);
        }
        if (
          controls &&
          controls.thirdPartyControls &&
          typeof controls.thirdPartyControls.setLookAt === 'function'
        ) {
          controls.thirdPartyControls.setLookAt(
            camera.position.x,
            camera.position.y,
            camera.position.z,
            worldTarget.x,
            worldTarget.y,
            worldTarget.z,
            false
          );
          // Force controls to apply state immediately (delta in seconds).
          controls.thirdPartyControls.update(1);
        }
      }

      // Let CameraControls drive the camera again on subsequent frames.
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

      // Include the current orbit target in model (pivot) space so that
      // round-trip restore keeps the same orbit center. Use the scene's target
      // as the source of truth (model-viewer sets this on load for any GLB).
      // Only fall back to bbox center when the scene does not provide a target.
      if (scene && typeof scene.getTarget === 'function') {
        const modelTarget = scene.getTarget();
        object.target = [modelTarget.x, modelTarget.y, modelTarget.z];
      }
      if (
        object.target == null &&
        controls &&
        controls.thirdPartyControls &&
        typeof controls.thirdPartyControls.getTarget === 'function'
      ) {
        const worldTarget = new Vector3();
        controls.thirdPartyControls.getTarget(worldTarget);
        if (scene.pivot && typeof scene.pivot.worldToLocal === 'function') {
          scene.updateMatrixWorld(true);
          const modelTarget = worldTarget.clone();
          scene.pivot.worldToLocal(modelTarget);
          object.target = modelTarget.toArray();
        } else {
          object.target = worldTarget.toArray();
        }
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
