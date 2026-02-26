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

      // 1. Ensure the underlying three.js camera matches the requested type
      let desiredType: CameraType | null = null;
      const typeValue = data.cameraType ?? data.type;

      if (typeof typeValue === 'string') {
        if (typeValue === 'perspective' || typeValue === 'orthographic') {
          desiredType = typeValue;
        } else if (typeValue === 'PerspectiveCamera') {
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

      const camera: any = scene.camera;
      if (!camera) {
        return;
      }

      // 2. Apply transform from three.js-style camera JSON
      if (Array.isArray(data.matrix) && data.matrix.length === 16) {
        const m = new Matrix4().fromArray(data.matrix);
        camera.matrixAutoUpdate = false;
        camera.matrix.copy(m);
        camera.matrix.decompose(camera.position, camera.quaternion, camera.scale);
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

      // 4. Sync CameraControls target so interaction remains smooth
      const target = new Vector3();

      if (Array.isArray(data.target) && data.target.length === 3) {
        target.fromArray(data.target);
      } else if (
        controls &&
        controls.thirdPartyControls &&
        typeof controls.thirdPartyControls.getTarget === 'function'
      ) {
        // Derive a new target based on the new camera orientation but keep
        // the previous orbit radius for a natural feel.
        const oldTarget = new Vector3();
        controls.thirdPartyControls.getTarget(oldTarget);
        let radius = camera.position.distanceTo(oldTarget);
        if (!Number.isFinite(radius) || radius <= 0) {
          radius = 1;
        }

        const forward = new Vector3(0, 0, -1)
          .applyQuaternion(camera.quaternion)
          .normalize();

        target.copy(camera.position).add(forward.multiplyScalar(radius));
      }

      if (
        Number.isFinite(target.x) &&
        Number.isFinite(target.y) &&
        Number.isFinite(target.z)
      ) {
        if (typeof scene.setTarget === 'function') {
          scene.setTarget(target.x, target.y, target.z);
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
            target.x,
            target.y,
            target.z,
            false
          );
        }
      }

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
      const cameraType: CameraType =
        isPerspective || !isOrthographic ? 'perspective' : 'orthographic';

      const object: any = {
        // three.js compatible identifiers
        type: isPerspective
          ? 'PerspectiveCamera'
          : isOrthographic
            ? 'OrthographicCamera'
            : 'Camera',
        cameraType,
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

      // Include the current orbit target when available so we can
      // faithfully restore the CameraControls state later.
      const target = new Vector3();
      if (
        controls &&
        controls.thirdPartyControls &&
        typeof controls.thirdPartyControls.getTarget === 'function'
      ) {
        controls.thirdPartyControls.getTarget(target);
        object.target = target.toArray();
      } else if (scene && typeof scene.getDynamicTarget === 'function') {
        const dynTarget = scene.getDynamicTarget();
        if (dynTarget) {
          object.target = [dynTarget.x, dynTarget.y, dynTarget.z];
        }
      }

      let controlsState: any = undefined;
      if (controls && typeof controls.toJSON === 'function') {
        try {
          controlsState = controls.toJSON();
        } catch {
          // If CameraControls serialization fails, continue without it.
        }
      }

      const meta: CameraMeta = {
        metadata: {
          version: 1,
          generator: '@london-dynamics/model-viewer LDCamera',
          cameraType,
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
      console.log('setCameraType called', type);
      if (scene.getCameraType() === type) {
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
