/* @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * LDControls - Drop-in replacement for controls.ts using CameraControls library
 *
 * This module provides a camera controls mixin that uses the CameraControls
 * third-party library instead of the original SmoothControls. The interface
 * remains identical to the original controls, making it a true drop-in replacement.
 *
 * Link to CameraControls library:
 * https://github.com/yomotsu/camera-controls
 *
 * Usage:
 * Replace the import in your ModelViewer implementation:
 * ```typescript
 * // Instead of:
 * import { ControlsMixin } from './features/controls.js';
 *
 * // Use:
 * import { LDControlsMixin as ControlsMixin } from './index.js';
 * ```
 */

import { property } from 'lit/decorators.js';
import * as THREE from 'three';

import { style } from '../../decorators.js';
import ModelViewerElementBase, {
  $ariaLabel,
  $container,
  $getModelIsVisible,
  $loadedTime,
  $needsRender,
  $onModelLoad,
  $onResize,
  $renderer,
  $scene,
  $tick,
  $updateStatus,
  $userInputElement,
  toVector3D,
  Vector3D,
} from '../../model-viewer-base.js';

import {
  EvaluatedStyle,
  Intrinsics,
  SphericalIntrinsics,
  Vector3Intrinsics,
} from '../../styles/evaluators.js';

import { DECAY_MILLISECONDS } from '../../three-components/Damper.js';
import {
  ChangeSource,
  PointerChangeEvent,
} from '../../three-components/SmoothControls.js';
import { Constructor } from '../../utilities.js';
import { timeline, TimingFunction } from '../../utilities/animation.js';

import CameraControls from 'camera-controls';

import {
  ensureViewportGizmo,
  type ViewportGizmoHandle,
} from './viewport-gizmo.js';

import {
  $controls,
  $fingerAnimatedContainers,
  $panElement,
  $promptAnimatedContainer,
  $promptElement,
  A11yTranslationsInterface,
  cameraOrbitIntrinsics,
  cameraTargetIntrinsics,
  fieldOfViewIntrinsics,
  Finger,
  InteractionPromptStrategy,
  InteractionPromptStyle,
  maxCameraOrbitIntrinsics,
  minCameraOrbitIntrinsics,
  minFieldOfViewIntrinsics,
  SphericalPosition,
  TouchAction,
  type CameraChangeDetails,
  type ControlsInterface,
} from '../controls.js';

import {
  DEFAULT_FOV_DEG,
  DEFAULT_MIN_FOV_DEG,
  DEFAULT_CAMERA_ORBIT,
  DEFAULT_CAMERA_TARGET,
  DEFAULT_FIELD_OF_VIEW,
  MINIMUM_RADIUS_RATIO,
  AZIMUTHAL_QUADRANT_LABELS,
  POLAR_TRIENT_LABELS,
  DEFAULT_INTERACTION_PROMPT_THRESHOLD,
  INTERACTION_PROMPT,
} from '../controls.js';

export {
  DEFAULT_FOV_DEG,
  DEFAULT_MIN_FOV_DEG,
  DEFAULT_CAMERA_ORBIT,
  DEFAULT_CAMERA_TARGET,
  DEFAULT_FIELD_OF_VIEW,
  MINIMUM_RADIUS_RATIO,
  AZIMUTHAL_QUADRANT_LABELS,
  POLAR_TRIENT_LABELS,
  DEFAULT_INTERACTION_PROMPT_THRESHOLD,
  INTERACTION_PROMPT,
};

CameraControls.install({ THREE: THREE });

// Functions to auto-forward from CameraControls to the adapter
const CAMERA_CONTROLS_METHODS_TO_EXPOSE = [
  'fitToBox',
  'fitToSphere',
  'setLookAt',
  'saveState',
  'reset',
  'rotate',
  'rotateTo',
  'toJSON',
  'fromJSON',
] as const;

type ExposedMethodNames = (typeof CAMERA_CONTROLS_METHODS_TO_EXPOSE)[number];
type ExposedCameraControlsMethods = Pick<CameraControls, ExposedMethodNames>;
type InteractionMode = 'rotate' | 'pan';

/**
 * Adapter interface that bridges between the 3rd party controls and the expected SmoothControls interface
 */
interface ControlsAdapter extends ExposedCameraControlsMethods {
  // Core controls properties
  inputSensitivity: number;
  orbitSensitivity: number;
  zoomSensitivity: number;
  panSensitivity: number;
  disableZoom: boolean;
  enablePan: boolean;
  enableTap: boolean;
  interactionMode: InteractionMode;
  changeSource: ChangeSource;

  // Methods that need to be implemented by the adapter
  enableInteraction(): void;
  disableInteraction(): void;
  /** Disables orbit/pan drag while keeping wheel/pinch zoom. */
  disableDragInteraction(): void;
  enableDragInteraction(): void;
  applyOptions(options: any): void;
  updateTouchActionStyle(): void;
  setDamperDecayTime(decay: number): void;
  jumpToGoal(): void;
  setFieldOfView(fov: number): void;
  getFieldOfView(): number;
  setOrbit(theta: number, phi: number, radius: number): void;
  adjustOrbit(deltaTheta: number, deltaPhi: number, deltaRadius: number): void;
  updateNearFar(near: number, far: number): void;
  updateAspect(aspect: number): void;
  getCameraSpherical(target: THREE.Spherical): THREE.Spherical;
  update(time: number, delta: number): boolean;

  // Event handling
  addEventListener(type: string, listener: (event: THREE.Event) => void): void;
  removeEventListener(
    type: string,
    listener: (event: THREE.Event) => void
  ): void;

  // Options object for configuration
  options: {
    minimumFieldOfView?: number;
    maximumFieldOfView?: number;
    minimumAzimuthalAngle?: number;
    minimumPolarAngle?: number;
    minimumRadius?: number;
    maximumAzimuthalAngle?: number;
    maximumPolarAngle?: number;
    maximumRadius?: number;
    touchAction?: string;
  };
}

// Constants for tap detection (matching SmoothControls)
const TAP_DISTANCE = 2;
const TAP_MS = 300;

/**
 * Concrete adapter implementation that wraps a 3rd party controls library
 * This class adapts the 3rd party interface to match the expected SmoothControls interface
 */
class ThirdPartyControlsAdapter implements ControlsAdapter {
  private thirdPartyControls: CameraControls;
  private domElement: HTMLElement;
  private scene: any; // ModelScene reference for recenter functionality
  private canEnableInteraction: () => boolean;
  private _inputSensitivity: number = 1;
  private _orbitSensitivity: number = 1;
  private _zoomSensitivity: number = 1;
  private _panSensitivity: number = 1;
  private _disableZoom: boolean = false;
  private _enablePan: boolean = true;
  private _enableTap: boolean = true;
  private _interactionMode: InteractionMode = 'rotate';
  private _dragInteractionDisabled: boolean = false;

  // Tap detection state
  private startTime: number = 0;
  private startPointerPosition: { clientX: number; clientY: number } = {
    clientX: 0,
    clientY: 0,
  };

  changeSource: ChangeSource = ChangeSource.NONE;

  options: {
    minimumFieldOfView?: number;
    maximumFieldOfView?: number;
    minimumAzimuthalAngle?: number;
    minimumPolarAngle?: number;
    minimumRadius?: number;
    maximumAzimuthalAngle?: number;
    maximumPolarAngle?: number;
    maximumRadius?: number;
    touchAction?: string;
  } = {};

  private updateSensitivity(): void {
    // Map sensitivity settings
    this.thirdPartyControls.azimuthRotateSpeed = this._orbitSensitivity;
    this.thirdPartyControls.polarRotateSpeed = this._orbitSensitivity;
    this.thirdPartyControls.dollySpeed = this._zoomSensitivity;
    this.thirdPartyControls.truckSpeed = this._panSensitivity;
  }

  get inputSensitivity(): number {
    return this._inputSensitivity;
  }

  set inputSensitivity(value: number) {
    this._inputSensitivity = value;
    this.updateSensitivity();
  }

  get orbitSensitivity(): number {
    return this._orbitSensitivity;
  }

  set orbitSensitivity(value: number) {
    this._orbitSensitivity = value;
    this.updateSensitivity();
  }

  get zoomSensitivity(): number {
    return this._zoomSensitivity;
  }

  set zoomSensitivity(value: number) {
    this._zoomSensitivity = value;
    this.updateSensitivity();
  }

  get panSensitivity(): number {
    return this._panSensitivity;
  }

  set panSensitivity(value: number) {
    this._panSensitivity = value;
    this.updateSensitivity();
  }

  get disableZoom(): boolean {
    return this._disableZoom;
  }

  set disableZoom(value: boolean) {
    this._disableZoom = value;
    this.applyInteractionBindings();
  }

  get enablePan(): boolean {
    return this._enablePan;
  }

  set enablePan(value: boolean) {
    this._enablePan = value;
    this.applyInteractionBindings();
  }

  get enableTap(): boolean {
    return this._enableTap;
  }

  set enableTap(value: boolean) {
    this._enableTap = value;
    // Tap handling is implemented via pointer event listeners in enableInteraction/disableInteraction
  }

  get interactionMode(): InteractionMode {
    return this._interactionMode;
  }

  set interactionMode(value: InteractionMode) {
    this._interactionMode = value;
    this.applyInteractionBindings();
  }

  constructor(
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    element: HTMLElement,
    scene: any,
    canEnableInteraction: () => boolean = () => true
  ) {
    this.thirdPartyControls = new CameraControls(camera, element);
    this.domElement = element;
    this.scene = scene; // Store scene reference for recenter functionality
    this.canEnableInteraction = canEnableInteraction;

    // Initialize default settings to match SmoothControls behavior
    this.thirdPartyControls.smoothTime = 0.25;
    this.thirdPartyControls.draggingSmoothTime = 0.125;

    // Ensure camera has valid initial values before any calculations
    if (!camera.position.isVector3 || camera.position.length() === 0) {
      camera.position.set(0, 0, 5);
    }

    // Ensure camera up vector is valid
    if (
      !camera.up.isVector3 ||
      camera.up.length() === 0 ||
      !isFinite(camera.up.x) ||
      !isFinite(camera.up.y) ||
      !isFinite(camera.up.z)
    ) {
      camera.up.set(0, 1, 0);
    }

    // Ensure projection matrix is properly set up
    if (camera instanceof THREE.PerspectiveCamera) {
      if (!camera.fov || !isFinite(camera.fov) || camera.fov <= 0) {
        camera.fov = 45; // Default field of view
      }
      if (!camera.aspect || !isFinite(camera.aspect) || camera.aspect <= 0) {
        camera.aspect = 1; // Default aspect ratio
      }
    } else if (camera instanceof THREE.OrthographicCamera) {
      if (!camera.zoom || !isFinite(camera.zoom) || camera.zoom <= 0) {
        camera.zoom = 1; // Default zoom
      }
    }
    if (!camera.near || !isFinite(camera.near) || camera.near <= 0) {
      camera.near = 0.1; // Default near plane
    }
    if (!camera.far || !isFinite(camera.far) || camera.far <= camera.near) {
      camera.far = 1000; // Default far plane
    }

    // Update projection matrix with valid parameters
    camera.updateProjectionMatrix();

    // Ensure camera is looking at a valid target
    const defaultTarget = new THREE.Vector3(0, 0, 0);

    // Set up camera with proper matrices first
    camera.lookAt(defaultTarget);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);

    // Now set CameraControls with the properly initialized camera
    this.thirdPartyControls.setLookAt(
      camera.position.x,
      camera.position.y,
      camera.position.z, // Camera position from actual camera
      defaultTarget.x,
      defaultTarget.y,
      defaultTarget.z, // Target position
      false // No transition
    );

    // Force multiple updates to ensure proper matrix calculation
    this.thirdPartyControls.update(0);
    camera.updateMatrix();
    camera.updateMatrixWorld(true);

    // Final validation - if still invalid, reset to absolute safe defaults
    const matrixValid = camera.matrixWorld.elements.every(
      (n: number) => isFinite(n) && !isNaN(n)
    );
    const projMatrixValid = camera.projectionMatrix.elements.every(
      (n: number) => isFinite(n) && !isNaN(n)
    );

    if (!matrixValid || !projMatrixValid) {
      camera.position.set(0, 0, 5);
      camera.up.set(0, 1, 0);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = 45;
        camera.aspect = 1;
      } else if (camera instanceof THREE.OrthographicCamera) {
        camera.zoom = 1;
      }
      camera.near = 0.1;
      camera.far = 1000;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);
      camera.updateMatrix();
      camera.updateMatrixWorld(true);

      this.thirdPartyControls.setLookAt(0, 0, 5, 0, 0, 0, false);
      this.thirdPartyControls.update(0);
    }

    // Set up sensitivity mappings
    this.updateSensitivity();
    this.applyInteractionBindings();

    // CameraControls does not set changeSource like SmoothControls did on pointer
    // events. Without this, interaction-prompt wiggle leaves changeSource as
    // AUTOMATIC and user drags are not recognized (prompt never dismisses).
    this.thirdPartyControls.addEventListener('controlstart', () => {
      if (this.changeSource !== ChangeSource.AUTOMATIC) {
        this.changeSource = ChangeSource.USER_INTERACTION;
      }
    });

    this.thirdPartyControls.addEventListener('controlend', () => {
      if (this.changeSource === ChangeSource.USER_INTERACTION) {
        this.changeSource = ChangeSource.NONE;
      }
    });
  }

  private applyInteractionBindings(): void {
    const controls = this.thirdPartyControls;
    const wheelZoomAction =
      (this.thirdPartyControls.camera instanceof THREE.OrthographicCamera
        ? CameraControls.ACTION.ZOOM
        : CameraControls.ACTION.DOLLY) as typeof controls.mouseButtons.wheel;
    const mouseZoomAction =
      (this.thirdPartyControls.camera instanceof THREE.OrthographicCamera
        ? CameraControls.ACTION.ZOOM
        : CameraControls.ACTION.DOLLY) as typeof controls.mouseButtons.middle;
    const touchZoomAction =
      (this.thirdPartyControls.camera instanceof THREE.OrthographicCamera
        ? CameraControls.ACTION.TOUCH_ZOOM
        : CameraControls.ACTION.TOUCH_DOLLY) as typeof controls.touches.two;
    const touchZoomTruckAction =
      (this.thirdPartyControls.camera instanceof THREE.OrthographicCamera
        ? CameraControls.ACTION.TOUCH_ZOOM_TRUCK
        : CameraControls.ACTION.TOUCH_DOLLY_TRUCK) as typeof controls.touches.two;

    controls.mouseButtons.wheel = this._disableZoom
      ? CameraControls.ACTION.NONE
      : wheelZoomAction;
    controls.mouseButtons.middle = mouseZoomAction;

    if (this._interactionMode === 'pan') {
      controls.mouseButtons.left = this._enablePan
        ? CameraControls.ACTION.TRUCK
        : CameraControls.ACTION.NONE;
      controls.mouseButtons.right = this._enablePan
        ? CameraControls.ACTION.TRUCK
        : CameraControls.ACTION.NONE;

      controls.touches.one = this._enablePan
        ? CameraControls.ACTION.TOUCH_TRUCK
        : CameraControls.ACTION.NONE;
      controls.touches.two = this._enablePan
        ? touchZoomTruckAction
        : touchZoomAction;
      controls.touches.three = this._enablePan
        ? touchZoomTruckAction
        : touchZoomAction;
    } else {
      controls.mouseButtons.left = CameraControls.ACTION.ROTATE;
      controls.mouseButtons.right = this._enablePan
        ? CameraControls.ACTION.TRUCK
        : CameraControls.ACTION.NONE;

      controls.touches.one = CameraControls.ACTION.TOUCH_ROTATE;
      controls.touches.two = this._enablePan
        ? touchZoomTruckAction
        : touchZoomAction;
      controls.touches.three = this._enablePan
        ? touchZoomTruckAction
        : touchZoomAction;
    }

    if (this._dragInteractionDisabled) {
      this.applyDragDisabledBindings();
    }
  }

  /**
   * Disable orbit/pan pointer drags while keeping wheel and pinch zoom.
   * Used when the pointer is over a draggable object in edit mode.
   */
  disableDragInteraction(): void {
    if (!this.canEnableInteraction()) {
      return;
    }
    if (this._dragInteractionDisabled) {
      return;
    }
    this._dragInteractionDisabled = true;
    this.ensureControlsListening();
    this.applyInteractionBindings();
  }

  enableDragInteraction(): void {
    if (!this._dragInteractionDisabled) {
      return;
    }
    this._dragInteractionDisabled = false;
    if (!this.canEnableInteraction()) {
      this.disableInteraction();
      return;
    }
    this.ensureControlsListening();
    this.applyInteractionBindings();
  }

  /** Turn on CameraControls and tap listeners without resetting drag-disabled state. */
  private ensureControlsListening(): void {
    if (!this.canEnableInteraction()) {
      return;
    }
    const wasEnabled = this.thirdPartyControls.enabled;
    this.thirdPartyControls.enabled = true;
    if (wasEnabled) {
      return;
    }
    this.domElement.addEventListener('mousedown', this.onMouseDown);
    this.domElement.addEventListener('mouseup', this.onMouseUp);
    this.domElement.addEventListener('touchstart', this.onTouchStart);
    this.domElement.addEventListener('touchend', this.onTouchEnd);
  }

  private applyDragDisabledBindings(): void {
    const controls = this.thirdPartyControls;
    const touchZoomOnly =
      (this.thirdPartyControls.camera instanceof THREE.OrthographicCamera
        ? CameraControls.ACTION.TOUCH_ZOOM
        : CameraControls.ACTION.TOUCH_DOLLY) as typeof controls.touches.two;

    controls.mouseButtons.left = CameraControls.ACTION.NONE;
    controls.mouseButtons.right = CameraControls.ACTION.NONE;
    controls.touches.one = CameraControls.ACTION.NONE;
    controls.touches.two = touchZoomOnly;
    controls.touches.three = touchZoomOnly;
  }

  enableInteraction(): void {
    if (!this.canEnableInteraction()) {
      this.disableInteraction();
      return;
    }
    this._dragInteractionDisabled = false;
    this.ensureControlsListening();
    this.applyInteractionBindings();
  }

  disableInteraction(): void {
    this._dragInteractionDisabled = false;
    this.thirdPartyControls.enabled = false;
    // Remove tap detection listeners
    this.domElement.removeEventListener('mousedown', this.onMouseDown);
    this.domElement.removeEventListener('mouseup', this.onMouseUp);
    this.domElement.removeEventListener('touchstart', this.onTouchStart);
    this.domElement.removeEventListener('touchend', this.onTouchEnd);
  }

  /**
   * Handle mouse down for tap detection
   */
  private onMouseDown = (event: MouseEvent) => {
    // Only track left mouse button
    if (event.button !== 0) return;
    this.startTime = performance.now();
    this.startPointerPosition.clientX = event.clientX;
    this.startPointerPosition.clientY = event.clientY;
  };

  /**
   * Handle touch start for tap detection
   */
  private onTouchStart = (event: TouchEvent) => {
    if (event.changedTouches.length === 0) return;
    this.startTime = performance.now();
    this.startPointerPosition.clientX = event.changedTouches[0].clientX;
    this.startPointerPosition.clientY = event.changedTouches[0].clientY;
  };

  /**
   * Handle mouse up - check if it was a tap and recenter if so
   */
  private onMouseUp = (event: MouseEvent) => {
    // Only handle left mouse button
    if (event.button !== 0) return;
    if (this._enablePan && this._enableTap) {
      this.recenter(event.clientX, event.clientY);
    }
  };

  /**
   * Handle touch end - check if it was a tap and recenter if so
   */
  private onTouchEnd = (event: TouchEvent) => {
    if (event.changedTouches.length === 0) return;
    if (this._enablePan && this._enableTap) {
      this.recenter(
        event.changedTouches[0].clientX,
        event.changedTouches[0].clientY
      );
    }
  };

  /**
   * Recenter the camera target on tap (matching SmoothControls behavior)
   * This is called when the user taps (short click without dragging)
   */
  private recenter(clientX: number, clientY: number) {
    // Check if this was a tap (short duration, small movement)
    if (
      performance.now() > this.startTime + TAP_MS ||
      Math.abs(clientX - this.startPointerPosition.clientX) > TAP_DISTANCE ||
      Math.abs(clientY - this.startPointerPosition.clientY) > TAP_DISTANCE
    ) {
      return;
    }

    const { scene } = this;
    if (!scene) return;

    // Get normalized device coordinates for the click position
    const ndc = scene.getNDC(clientX, clientY);
    const hit = scene.positionAndNormalFromPoint(ndc);

    if (hit == null) {
      // No hit - reset to default target and zoom out
      const { cameraTarget } = scene.element;
      scene.element.cameraTarget = '';
      scene.element.cameraTarget = cameraTarget;
      // Zoom all the way out (increase radius)
      this.thirdPartyControls.dolly(-1, true);
    } else {
      // Hit something - set target to hit position
      scene.target.worldToLocal(hit.position);
      scene.setTarget(hit.position.x, hit.position.y, hit.position.z);
    }
  }

  applyOptions(options: any): void {
    Object.assign(this.options, options);

    // Map options to CameraControls properties
    if (options.minimumAzimuthalAngle !== undefined) {
      this.thirdPartyControls.minAzimuthAngle = options.minimumAzimuthalAngle;
    }
    if (options.maximumAzimuthalAngle !== undefined) {
      this.thirdPartyControls.maxAzimuthAngle = options.maximumAzimuthalAngle;
    }
    if (options.minimumPolarAngle !== undefined) {
      this.thirdPartyControls.minPolarAngle = options.minimumPolarAngle;
    }
    if (options.maximumPolarAngle !== undefined) {
      this.thirdPartyControls.maxPolarAngle = options.maximumPolarAngle;
    }
    if (options.minimumRadius !== undefined) {
      this.thirdPartyControls.minDistance = options.minimumRadius;
    }
    if (options.maximumRadius !== undefined) {
      this.thirdPartyControls.maxDistance = options.maximumRadius;
    }
    if (options.minimumFieldOfView !== undefined) {
      this.options.minimumFieldOfView = options.minimumFieldOfView;
    }
    if (options.maximumFieldOfView !== undefined) {
      this.options.maximumFieldOfView = options.maximumFieldOfView;
    }
    if (options.touchAction !== undefined) {
      // CameraControls doesn't have direct touch-action style control
      // This would need to be handled at the DOM level if needed
      this.options.touchAction = options.touchAction;
    }
  }

  updateTouchActionStyle(): void {
    // CameraControls doesn't directly manage touch-action CSS
    // Set styles on the DOM element directly
    if (this.options.touchAction && this.domElement) {
      this.domElement.style.touchAction = this.options.touchAction;
    }
  }

  setDamperDecayTime(decay: number): void {
    // Convert decay time (milliseconds) to smoothTime (seconds)
    // SmoothControls uses decay in ms, CameraControls uses smoothTime in seconds
    this.thirdPartyControls.smoothTime = decay / 1000;
    this.thirdPartyControls.draggingSmoothTime = decay / 2000; // Half for dragging
  }

  jumpToGoal(): void {
    // Stop any ongoing transitions and immediately move to target
    this.thirdPartyControls.stop();
  }

  setFieldOfView(fov: number): void {
    // Set camera field of view directly
    if (this.thirdPartyControls.camera instanceof THREE.PerspectiveCamera) {
      this.thirdPartyControls.camera.fov = fov;
      this.thirdPartyControls.camera.updateProjectionMatrix();
    }
  }

  getFieldOfView(): number {
    if (this.thirdPartyControls.camera instanceof THREE.PerspectiveCamera) {
      return this.thirdPartyControls.camera.fov;
    }
    return 30; // Default for orthographic cameras
  }

  setOrbit(theta: number, phi: number, radius: number): void {
    // Validate input parameters to avoid NaN issues
    if (
      !isFinite(theta) ||
      !isFinite(phi) ||
      !isFinite(radius) ||
      isNaN(theta) ||
      isNaN(phi) ||
      isNaN(radius)
    ) {
      console.warn('setOrbit called with invalid values:', {
        theta,
        phi,
        radius,
      });
      return;
    }

    // Ensure radius is positive and non-zero
    if (radius <= 0) {
      console.warn('setOrbit called with invalid radius:', radius);
      radius = 1; // Use a safe default
    }

    // Clamp phi to valid range to avoid gimbal lock issues
    const clampedPhi = Math.max(0.01, Math.min(Math.PI - 0.01, phi));

    // Get the current target position to maintain it
    const currentTarget = new THREE.Vector3();
    this.thirdPartyControls.getTarget(currentTarget);

    // Ensure the target is valid (not NaN)
    if (
      !currentTarget.isVector3 ||
      !isFinite(currentTarget.x) ||
      !isFinite(currentTarget.y) ||
      !isFinite(currentTarget.z)
    ) {
      currentTarget.set(0, 0, 0);
    }

    // Set the spherical coordinates
    this.thirdPartyControls.azimuthAngle = theta;
    this.thirdPartyControls.polarAngle = clampedPhi;
    this.thirdPartyControls.distance = radius;

    // Calculate expected camera position to validate before applying
    const expectedPosition = new THREE.Vector3();
    expectedPosition.setFromSphericalCoords(radius, clampedPhi, theta);
    expectedPosition.add(currentTarget);

    // Validate expected position
    if (
      !expectedPosition.isVector3 ||
      !isFinite(expectedPosition.x) ||
      !isFinite(expectedPosition.y) ||
      !isFinite(expectedPosition.z)
    ) {
      console.error(
        'Expected camera position is invalid, resetting to safe state'
      );
      this.thirdPartyControls.setLookAt(0, 0, 5, 0, 0, 0, false);
      this.thirdPartyControls.update(0);
      return;
    }

    // Force multiple updates to ensure proper matrix calculation
    this.thirdPartyControls.update(0);
    this.thirdPartyControls.camera.updateMatrix();
    this.thirdPartyControls.camera.updateMatrixWorld(true);

    // Verify the camera matrix is valid after update
    const matrixValid =
      this.thirdPartyControls.camera.matrixWorld.elements.every(
        (n: number) => isFinite(n) && !isNaN(n)
      );
    if (!matrixValid) {
      console.error(
        'Camera matrix became invalid after setOrbit, resetting to safe state'
      );
      // Reset to a safe state
      this.thirdPartyControls.setLookAt(0, 0, 5, 0, 0, 0, false);
      this.thirdPartyControls.update(0);
      this.thirdPartyControls.camera.updateMatrix();
      this.thirdPartyControls.camera.updateMatrixWorld(true);
    }
  }

  adjustOrbit(deltaTheta: number, deltaPhi: number, deltaRadius: number): void {
    // Match SmoothControls: apply deltas relative to the current goal orbit.
    const goal = new THREE.Spherical();
    this.thirdPartyControls.getSpherical(goal, true);
    this.thirdPartyControls.rotateTo(
      goal.theta - deltaTheta,
      goal.phi - deltaPhi,
      false
    );
    if (deltaRadius !== 0) {
      this.thirdPartyControls.dolly(deltaRadius, false);
    }
    this.thirdPartyControls.update(0);
  }

  rotate(
    azimuthAngle: number,
    polarAngle: number,
    enableTransition?: boolean
  ): Promise<void> {
    return this.thirdPartyControls.rotateTo(
      azimuthAngle,
      polarAngle,
      enableTransition
    );
  }

  rotateTo(
    azimuthAngle: number,
    polarAngle: number,
    enableTransition?: boolean
  ): Promise<void> {
    return this.thirdPartyControls.rotateTo(
      azimuthAngle,
      polarAngle,
      enableTransition
    );
  }

  updateNearFar(near: number, far: number): void {
    // Update camera near/far planes
    this.thirdPartyControls.camera.near = near;
    this.thirdPartyControls.camera.far = far;
    this.thirdPartyControls.camera.updateProjectionMatrix();
  }

  updateAspect(aspect: number): void {
    // Update camera aspect ratio
    if (this.thirdPartyControls.camera instanceof THREE.PerspectiveCamera) {
      this.thirdPartyControls.camera.aspect = aspect;
      this.thirdPartyControls.camera.updateProjectionMatrix();
    }
  }

  getCameraSpherical(target: THREE.Spherical): THREE.Spherical {
    // Get current camera position in spherical coordinates
    return this.thirdPartyControls.getSpherical(target);
  }

  update(_time: number, delta: number): boolean {
    // Periodically validate camera matrix to catch and fix NaN issues
    this.validateAndFixCameraMatrix();

    // Update CameraControls - delta is in seconds for CameraControls
    return this.thirdPartyControls.update(delta / 1000);
  }

  addEventListener(type: string, listener: (event: THREE.Event) => void): void {
    // Map SmoothControls events to CameraControls events and add listeners
    const mappedType = this.mapEventType(type);
    if (mappedType) {
      // Use the basic addEventListener for compatibility
      (this.thirdPartyControls as any).addEventListener(mappedType, listener);
    }
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    // Map SmoothControls events to CameraControls events and remove listeners
    const mappedType = this.mapEventType(type);
    if (mappedType) {
      // Use the basic removeEventListener for compatibility
      (this.thirdPartyControls as any).removeEventListener(
        mappedType,
        listener
      );
    }
  }

  // CameraControls methods that need to be exposed

  fitToBox(...args: Parameters<CameraControls['fitToBox']>) {
    return this.thirdPartyControls.fitToBox(...args);
  }

  fitToSphere(...args: Parameters<CameraControls['fitToSphere']>) {
    return this.thirdPartyControls.fitToSphere(...args);
  }

  setLookAt(...args: Parameters<CameraControls['setLookAt']>) {
    return this.thirdPartyControls.setLookAt(...args);
  }

  saveState(): void {
    return this.thirdPartyControls.saveState();
  }

  toJSON(): any {
    return this.thirdPartyControls.toJSON();
  }

  fromJSON(json: any): void {
    return this.thirdPartyControls.fromJSON(json);
  }

  reset(): Promise<void[]> {
    return this.thirdPartyControls.reset();
  }

  /**
   * Force camera matrix update and validate state
   * Call this if you suspect the camera matrix is invalid
   */
  validateAndFixCameraMatrix(): boolean {
    const camera = this.thirdPartyControls.camera;
    let needsControlsUpdate = false;

    // Check if camera position and target are valid
    const position = camera.position;
    const positionValid =
      position.isVector3 &&
      isFinite(position.x) &&
      isFinite(position.y) &&
      isFinite(position.z) &&
      !isNaN(position.x) &&
      !isNaN(position.y) &&
      !isNaN(position.z);

    if (!positionValid) {
      position.set(0, 0, 5);
      needsControlsUpdate = true;
    }

    // Check camera up vector
    const up = camera.up;
    const upValid =
      up.isVector3 &&
      isFinite(up.x) &&
      isFinite(up.y) &&
      isFinite(up.z) &&
      !isNaN(up.x) &&
      !isNaN(up.y) &&
      !isNaN(up.z) &&
      up.length() > 0;

    if (!upValid) {
      up.set(0, 1, 0);
      needsControlsUpdate = true;
    }

    // Check camera projection parameters (only for PerspectiveCamera)
    if (camera instanceof THREE.PerspectiveCamera) {
      if (!camera.fov || !isFinite(camera.fov) || camera.fov <= 0) {
        camera.fov = 45;
      }
      if (!camera.aspect || !isFinite(camera.aspect) || camera.aspect <= 0) {
        camera.aspect = 1;
      }
    }

    if (!camera.near || !isFinite(camera.near) || camera.near <= 0) {
      camera.near = 0.1;
    }
    if (!camera.far || !isFinite(camera.far) || camera.far <= camera.near) {
      camera.far = 1000;
    }

    // Update projection matrix
    camera.updateProjectionMatrix();

    // Check CameraControls target
    const target = new THREE.Vector3();
    this.thirdPartyControls.getTarget(target);
    const targetValid =
      target.isVector3 &&
      isFinite(target.x) &&
      isFinite(target.y) &&
      isFinite(target.z) &&
      !isNaN(target.x) &&
      !isNaN(target.y) &&
      !isNaN(target.z);

    if (!targetValid) {
      this.thirdPartyControls.setTarget(0, 0, 0, false);
      needsControlsUpdate = true;
    }

    if (needsControlsUpdate) {
      this.thirdPartyControls.update(0);
      camera.updateMatrix();
      camera.updateMatrixWorld(true);
    }

    // Check if matrices are valid
    const matrixValid =
      camera.matrix.elements.every((n: number) => isFinite(n) && !isNaN(n)) &&
      camera.matrixWorld.elements.every(
        (n: number) => isFinite(n) && !isNaN(n)
      );
    const projMatrixValid = camera.projectionMatrix.elements.every(
      (n: number) => isFinite(n) && !isNaN(n)
    );

    if (!matrixValid || !projMatrixValid) {
      // Reset to a known good state
      camera.position.set(0, 0, 5);
      camera.up.set(0, 1, 0);
      if (camera instanceof THREE.PerspectiveCamera) {
        camera.fov = 45;
        camera.aspect = 1;
      }
      camera.near = 0.1;
      camera.far = 1000;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);
      camera.updateMatrix();
      camera.updateMatrixWorld(true);

      this.thirdPartyControls.setLookAt(0, 0, 5, 0, 0, 0, false);
      this.thirdPartyControls.update(0);
      return false;
    }

    return true;
  }

  /**
   * Update the camera reference and reinitialize CameraControls state.
   * This should be called when the camera type changes (e.g., perspective <-> orthographic).
   */
  updateCamera(
    newCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  ): void {
    // Save current position and target
    const oldPosition = this.thirdPartyControls.camera.position.clone();
    const oldTarget = new THREE.Vector3();
    this.thirdPartyControls.getTarget(oldTarget);

    // Save current enabled state
    const wasEnabled = this.thirdPartyControls.enabled;

    // Dispose the old CameraControls instance (removes event listeners)
    this.thirdPartyControls.dispose();

    // Create new CameraControls with the new camera
    this.thirdPartyControls = new CameraControls(newCamera, this.domElement);

    // Restore settings
    this.thirdPartyControls.smoothTime = 0.25;
    this.thirdPartyControls.draggingSmoothTime = 0.125;
    this.thirdPartyControls.enabled = wasEnabled;

    // Restore sensitivity settings
    this.updateSensitivity();

    // Restore constraints from options
    if (this.options.minimumAzimuthalAngle !== undefined) {
      this.thirdPartyControls.minAzimuthAngle =
        this.options.minimumAzimuthalAngle;
    }
    if (this.options.maximumAzimuthalAngle !== undefined) {
      this.thirdPartyControls.maxAzimuthAngle =
        this.options.maximumAzimuthalAngle;
    }
    if (this.options.minimumPolarAngle !== undefined) {
      this.thirdPartyControls.minPolarAngle = this.options.minimumPolarAngle;
    }
    if (this.options.maximumPolarAngle !== undefined) {
      this.thirdPartyControls.maxPolarAngle = this.options.maximumPolarAngle;
    }
    if (this.options.minimumRadius !== undefined) {
      this.thirdPartyControls.minDistance = this.options.minimumRadius;
    }
    if (this.options.maximumRadius !== undefined) {
      this.thirdPartyControls.maxDistance = this.options.maximumRadius;
    }

    this.applyInteractionBindings();

    // Restore the camera position and target
    this.thirdPartyControls.setLookAt(
      oldPosition.x,
      oldPosition.y,
      oldPosition.z,
      oldTarget.x,
      oldTarget.y,
      oldTarget.z,
      false
    );

    // Force update
    this.thirdPartyControls.update(0);
  }

  private mapEventType(smoothControlsEventType: string): string | null {
    // Map SmoothControls event types to CameraControls event types
    switch (smoothControlsEventType) {
      case 'user-interaction':
        return 'controlstart';
      case 'pointer-change-start':
        return 'controlstart';
      case 'pointer-change-end':
        return 'controlend';
      case 'change':
        return 'update';
      default:
        return smoothControlsEventType; // Pass through if no mapping needed
    }
  }
}

// NOTE(cdata): The following "animation" timing functions are deliberately
// being used in favor of CSS animations. In Safari 12.1 and 13, CSS animations
// would cause the interaction prompt to glitch unexpectedly
// @see https://github.com/google/model-viewer/issues/839
const PROMPT_ANIMATION_TIME = 5000;

// For timing purposes, a "frame" is a timing agnostic relative unit of time
// and a "value" is a target value for the Frame.
const wiggle = timeline({
  initialValue: 0,
  keyframes: [
    { frames: 5, value: -1 },
    { frames: 1, value: -1 },
    { frames: 8, value: 1 },
    { frames: 1, value: 1 },
    { frames: 5, value: 0 },
    { frames: 18, value: 0 },
  ],
});

const fade = timeline({
  initialValue: 0,
  keyframes: [
    { frames: 1, value: 1 },
    { frames: 5, value: 1 },
    { frames: 1, value: 0 },
    { frames: 6, value: 0 },
  ],
});

const HALF_PI = Math.PI / 2.0;
const THIRD_PI = Math.PI / 3.0;
const QUARTER_PI = HALF_PI / 2.0;
const TAU = 2.0 * Math.PI;

const $deferInteractionPrompt = Symbol('deferInteractionPrompt');
const $updateAria = Symbol('updateAria');
const $a11y = Symbol('a11y');
const $updateA11y = Symbol('updateA11y');
const $updateCameraForRadius = Symbol('updateCameraForRadius');

const $cancelPrompts = Symbol('cancelPrompts');
const $onChange = Symbol('onChange');
const $onPointerChange = Symbol('onPointerChange');

const $waitingToPromptUser = Symbol('waitingToPromptUser');
const $userHasInteracted = Symbol('userHasInteracted');
const $promptElementVisibleTime = Symbol('promptElementVisibleTime');
const $lastPromptOffset = Symbol('lastPromptOffset');
const $cancellationSource = Symbol('cancellationSource');

const $lastSpherical = Symbol('lastSpherical');
const $jumpCamera = Symbol('jumpCamera');
const $initialized = Symbol('initialized');
const $maintainThetaPhi = Symbol('maintainThetaPhi');

const $syncCameraOrbit = Symbol('syncCameraOrbit');
const $syncFieldOfView = Symbol('syncFieldOfView');
const $syncCameraTarget = Symbol('syncCameraTarget');

const $syncMinCameraOrbit = Symbol('syncMinCameraOrbit');
const $syncMaxCameraOrbit = Symbol('syncMaxCameraOrbit');
const $syncMinFieldOfView = Symbol('syncMinFieldOfView');
const $syncMaxFieldOfView = Symbol('syncMaxFieldOfView');

export declare interface LDControlsInterface extends ControlsInterface {}

export const LDControlsMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDControlsInterface> & T => {
  class ControlsModelViewerElement extends ModelViewerElement {
    @property({ type: Boolean, attribute: 'camera-controls' })
    cameraControls: boolean = false;

    @property({ type: String, attribute: 'interaction-mode' })
    interactionMode: InteractionMode = 'rotate';

    @property({ type: Boolean, attribute: 'viewport-gizmo' })
    showViewportGizmo: boolean = false;

    viewportGizmoHandle: ViewportGizmoHandle | null = null;

    @style({
      intrinsics: cameraOrbitIntrinsics,
      observeEffects: true,
      updateHandler: $syncCameraOrbit,
    })
    @property({
      type: String,
      attribute: 'camera-orbit',
      hasChanged: () => true,
    })
    cameraOrbit: string = DEFAULT_CAMERA_ORBIT;

    @style({
      intrinsics: cameraTargetIntrinsics,
      observeEffects: true,
      updateHandler: $syncCameraTarget,
    })
    @property({
      type: String,
      attribute: 'camera-target',
      hasChanged: () => true,
    })
    cameraTarget: string = DEFAULT_CAMERA_TARGET;

    @style({
      intrinsics: fieldOfViewIntrinsics,
      observeEffects: true,
      updateHandler: $syncFieldOfView,
    })
    @property({
      type: String,
      attribute: 'field-of-view',
      hasChanged: () => true,
    })
    fieldOfView: string = DEFAULT_FIELD_OF_VIEW;

    @style({
      intrinsics: minCameraOrbitIntrinsics,
      updateHandler: $syncMinCameraOrbit,
    })
    @property({
      type: String,
      attribute: 'min-camera-orbit',
      hasChanged: () => true,
    })
    minCameraOrbit: string = 'auto';

    @style({
      intrinsics: maxCameraOrbitIntrinsics,
      updateHandler: $syncMaxCameraOrbit,
    })
    @property({
      type: String,
      attribute: 'max-camera-orbit',
      hasChanged: () => true,
    })
    maxCameraOrbit: string = 'auto';

    @style({
      intrinsics: minFieldOfViewIntrinsics,
      updateHandler: $syncMinFieldOfView,
    })
    @property({
      type: String,
      attribute: 'min-field-of-view',
      hasChanged: () => true,
    })
    minFieldOfView: string = 'auto';

    @style({
      intrinsics: fieldOfViewIntrinsics,
      updateHandler: $syncMaxFieldOfView,
    })
    @property({
      type: String,
      attribute: 'max-field-of-view',
      hasChanged: () => true,
    })
    maxFieldOfView: string = 'auto';

    @property({ type: Number, attribute: 'interaction-prompt-threshold' })
    interactionPromptThreshold: number = DEFAULT_INTERACTION_PROMPT_THRESHOLD;

    @property({ type: String, attribute: 'interaction-prompt' })
    interactionPrompt: InteractionPromptStrategy =
      InteractionPromptStrategy.AUTO;

    @property({ type: String, attribute: 'interaction-prompt-style' })
    interactionPromptStyle: InteractionPromptStyle =
      InteractionPromptStyle.WIGGLE;

    @property({ type: Number, attribute: 'orbit-sensitivity' })
    orbitSensitivity: number = 1;

    @property({ type: Number, attribute: 'zoom-sensitivity' })
    zoomSensitivity: number = 1;

    @property({ type: Number, attribute: 'pan-sensitivity' })
    panSensitivity: number = 1;

    @property({ type: String, attribute: 'touch-action' })
    touchAction: TouchAction = TouchAction.NONE;

    @property({ type: Boolean, attribute: 'disable-zoom' })
    disableZoom: boolean = false;

    @property({ type: Boolean, attribute: 'disable-pan' })
    disablePan: boolean = false;

    @property({ type: Boolean, attribute: 'disable-tap' })
    disableTap: boolean = false;

    @property({ type: Number, attribute: 'interpolation-decay' })
    interpolationDecay: number = DECAY_MILLISECONDS;

    @property() a11y: A11yTranslationsInterface | string | null = null;

    protected [$promptElement] = this.shadowRoot!.querySelector(
      '.interaction-prompt'
    ) as HTMLElement;
    protected [$promptAnimatedContainer] = this.shadowRoot!.querySelector(
      '#prompt'
    ) as HTMLElement;
    protected [$fingerAnimatedContainers]: HTMLElement[] = [
      this.shadowRoot!.querySelector('#finger0')!,
      this.shadowRoot!.querySelector('#finger1')!,
    ];
    protected [$panElement] = this.shadowRoot!.querySelector(
      '.pan-target'
    ) as HTMLElement;

    protected [$lastPromptOffset] = 0;
    protected [$promptElementVisibleTime] = Infinity;
    protected [$userHasInteracted] = false;
    protected [$waitingToPromptUser] = false;
    protected [$cancellationSource] = ChangeSource.AUTOMATIC;

    // Replace SmoothControls with ThirdPartyControlsAdapter
    protected [$controls] = new ThirdPartyControlsAdapter(
      this[$scene].camera as THREE.PerspectiveCamera,
      this[$userInputElement],
      this[$scene],
      () => this.cameraControls || this.interactionMode === 'pan'
    );

    protected [$lastSpherical] = new THREE.Spherical();
    protected [$jumpCamera] = false;
    protected [$initialized] = false;
    protected [$maintainThetaPhi] = false;
    protected [$a11y] = {} as A11yTranslationsInterface;

    get inputSensitivity(): number {
      return this[$controls].inputSensitivity;
    }

    set inputSensitivity(value: number) {
      this[$controls].inputSensitivity = value;
    }

    getCameraOrbit(): SphericalPosition {
      const { theta, phi, radius } = this[$lastSpherical];
      return {
        theta,
        phi,
        radius,
        toString() {
          return `${this.theta}rad ${this.phi}rad ${this.radius}m`;
        },
      };
    }

    getCameraTarget(): Vector3D {
      return toVector3D(
        this[$renderer].isPresenting
          ? this[$renderer].arRenderer.target
          : this[$scene].getDynamicTarget()
      );
    }

    getFieldOfView(): number {
      return this[$controls].getFieldOfView();
    }

    // Provided so user code does not have to parse these from attributes.
    getMinimumFieldOfView(): number {
      return this[$controls].options.minimumFieldOfView!;
    }

    getMaximumFieldOfView(): number {
      return this[$controls].options.maximumFieldOfView!;
    }

    getIdealAspect(): number {
      return this[$scene].idealAspect;
    }

    jumpCameraToGoal() {
      this[$jumpCamera] = true;
      this.requestUpdate($jumpCamera, false);
    }

    resetInteractionPrompt() {
      this[$lastPromptOffset] = 0;
      this[$promptElementVisibleTime] = Infinity;
      this[$userHasInteracted] = false;
      this[$waitingToPromptUser] =
        this.interactionPrompt === InteractionPromptStrategy.AUTO &&
        this.cameraControls;
    }

    zoom(keyPresses: number) {
      const event = new WheelEvent('wheel', { deltaY: -30 * keyPresses });
      this[$userInputElement].dispatchEvent(event);
    }

    connectedCallback() {
      super.connectedCallback();

      this[$controls].addEventListener(
        'user-interaction',
        this[$cancelPrompts]
      );
      this[$controls].addEventListener(
        'pointer-change-start',
        this[$onPointerChange] as (event: THREE.Event) => void
      );
      this[$controls].addEventListener(
        'pointer-change-end',
        this[$onPointerChange] as (event: THREE.Event) => void
      );

      this.viewportGizmoHandle = ensureViewportGizmo({
        host: this,
        scene: this[$scene],
        container: this[$container],
        controls: this[$controls],
        show: this.showViewportGizmo,
        existing: this.viewportGizmoHandle,
      });
    }

    disconnectedCallback() {
      super.disconnectedCallback();

      this[$controls].removeEventListener(
        'user-interaction',
        this[$cancelPrompts]
      );
      this[$controls].removeEventListener(
        'pointer-change-start',
        this[$onPointerChange] as (event: THREE.Event) => void
      );
      this[$controls].removeEventListener(
        'pointer-change-end',
        this[$onPointerChange] as (event: THREE.Event) => void
      );

      if (this.viewportGizmoHandle) {
        this.viewportGizmoHandle.dispose();
        this.viewportGizmoHandle = null;
      }
    }

    updated(changedProperties: Map<string | number | symbol, unknown>) {
      super.updated(changedProperties);

      const controls = this[$controls];
      const scene = this[$scene];
      const interactionAllowed =
        this.cameraControls || this.interactionMode === 'pan';

      if (changedProperties.has('cameraControls')) {
        if (interactionAllowed) {
          controls.enableInteraction();
          if (this.interactionPrompt === InteractionPromptStrategy.AUTO) {
            this[$waitingToPromptUser] = true;
          }
        } else {
          controls.disableInteraction();
          this[$deferInteractionPrompt]();
        }
        this[$userInputElement].setAttribute('aria-label', this[$ariaLabel]);
      }

      if (changedProperties.has('interactionMode')) {
        controls.interactionMode = this.interactionMode;
        if (interactionAllowed) {
          controls.enableInteraction();
        } else {
          controls.disableInteraction();
        }
      }

      if (changedProperties.has('disableZoom')) {
        controls.disableZoom = this.disableZoom;
      }

      if (changedProperties.has('disablePan')) {
        controls.enablePan = !this.disablePan;
      }

      if (changedProperties.has('disableTap')) {
        controls.enableTap = !this.disableTap;
      }

      if (
        changedProperties.has('interactionPrompt') ||
        changedProperties.has('cameraControls') ||
        changedProperties.has('src')
      ) {
        if (
          this.interactionPrompt === InteractionPromptStrategy.AUTO &&
          this.cameraControls &&
          !this[$userHasInteracted]
        ) {
          this[$waitingToPromptUser] = true;
        } else {
          this[$deferInteractionPrompt]();
        }
      }

      if (changedProperties.has('interactionPromptStyle')) {
        this[$promptAnimatedContainer].style.opacity =
          this.interactionPromptStyle == InteractionPromptStyle.BASIC
            ? '1'
            : '0';
      }

      if (changedProperties.has('touchAction')) {
        const touchAction = this.touchAction;
        controls.applyOptions({ touchAction });
        controls.updateTouchActionStyle();
      }

      if (changedProperties.has('orbitSensitivity')) {
        controls.orbitSensitivity = this.orbitSensitivity;
      }

      if (changedProperties.has('zoomSensitivity')) {
        controls.zoomSensitivity = this.zoomSensitivity;
      }

      if (changedProperties.has('panSensitivity')) {
        controls.panSensitivity = this.panSensitivity;
      }

      if (changedProperties.has('interpolationDecay')) {
        controls.setDamperDecayTime(this.interpolationDecay);
        scene.setTargetDamperDecayTime(this.interpolationDecay);
      }

      if (changedProperties.has('a11y')) {
        this[$updateA11y]();
      }

      if (this[$jumpCamera] === true) {
        Promise.resolve().then(() => {
          controls.jumpToGoal();
          scene.jumpToGoal();
          this[$onChange]();
          this[$jumpCamera] = false;
        });
      }

      if (changedProperties.has('showViewportGizmo')) {
        this.viewportGizmoHandle = ensureViewportGizmo({
          host: this,
          scene: this[$scene],
          container: this[$container],
          controls: this[$controls],
          show: this.showViewportGizmo,
          existing: this.viewportGizmoHandle,
        });
      }
    }

    async updateFraming() {
      const scene = this[$scene];
      const oldFramedFoV = scene.adjustedFoV(scene.framedFoVDeg);

      await scene.updateFraming();

      const newFramedFoV = scene.adjustedFoV(scene.framedFoVDeg);
      const zoom = this[$controls].getFieldOfView() / oldFramedFoV;
      this[$controls].setFieldOfView(newFramedFoV * zoom);
      this[$maintainThetaPhi] = true;

      this.requestUpdate('maxFieldOfView');
      this.requestUpdate('fieldOfView');
      this.requestUpdate('minCameraOrbit');
      this.requestUpdate('maxCameraOrbit');
      this.requestUpdate('cameraOrbit');
      await this.updateComplete;
    }

    interact(duration: number, finger0: Finger, finger1?: Finger) {
      const inputElement = this[$userInputElement];
      const fingerElements = this[$fingerAnimatedContainers];

      if (fingerElements[0].style.opacity === '1') {
        console.warn(
          'interact() failed because an existing interaction is running.'
        );
        return;
      }

      const xy = new Array<{ x: TimingFunction; y: TimingFunction }>();
      xy.push({ x: timeline(finger0.x), y: timeline(finger0.y) });
      const positions = [{ x: xy[0].x(0), y: xy[0].y(0) }];

      if (finger1 != null) {
        xy.push({ x: timeline(finger1.x), y: timeline(finger1.y) });
        positions.push({ x: xy[1].x(0), y: xy[1].y(0) });
      }

      let startTime = performance.now();
      const { width, height } = this[$scene];
      const rect = this.getBoundingClientRect();

      const dispatchTouches = (type: string) => {
        for (const [i, position] of positions.entries()) {
          const { style } = fingerElements[i];
          style.transform = `translateX(${width * position.x}px) translateY(${
            height * position.y
          }px)`;
          if (type === 'pointerdown') {
            style.opacity = '1';
          } else if (type === 'pointerup') {
            style.opacity = '0';
          }

          const init = {
            pointerId: i - 5678, // help ensure uniqueness
            pointerType: 'touch',
            target: inputElement,
            clientX: width * position.x + rect.x,
            clientY: height * position.y + rect.y,
            altKey: true, // flag that this is not a user interaction
          } as PointerEventInit;

          inputElement.dispatchEvent(new PointerEvent(type, init));
        }
      };

      const moveTouches = () => {
        // Cancel interaction if something else moves the camera or input is
        // removed from the DOM.
        const changeSource = this[$cancellationSource];
        if (
          changeSource !== ChangeSource.AUTOMATIC ||
          !inputElement.isConnected
        ) {
          for (const fingerElement of this[$fingerAnimatedContainers]) {
            fingerElement.style.opacity = '0';
          }
          dispatchTouches('pointercancel');
          this.dispatchEvent(
            new CustomEvent<CameraChangeDetails>('interact-stopped', {
              detail: { source: changeSource },
            })
          );
          document.removeEventListener('visibilitychange', onVisibilityChange);
          return;
        }

        const time = Math.min(1, (performance.now() - startTime) / duration);
        for (const [i, position] of positions.entries()) {
          position.x = xy[i].x(time);
          position.y = xy[i].y(time);
        }
        dispatchTouches('pointermove');

        if (time < 1) {
          requestAnimationFrame(moveTouches);
        } else {
          dispatchTouches('pointerup');
          this.dispatchEvent(
            new CustomEvent<CameraChangeDetails>('interact-stopped', {
              detail: { source: ChangeSource.AUTOMATIC },
            })
          );
          document.removeEventListener('visibilitychange', onVisibilityChange);
        }
      };

      const onVisibilityChange = () => {
        let elapsed = 0;
        if (document.visibilityState === 'hidden') {
          elapsed = performance.now() - startTime;
        } else {
          startTime = performance.now() - elapsed;
        }
      };

      document.addEventListener('visibilitychange', onVisibilityChange);

      dispatchTouches('pointerdown');

      this[$cancellationSource] = ChangeSource.AUTOMATIC;

      requestAnimationFrame(moveTouches);
    }

    [$syncFieldOfView](style: EvaluatedStyle<Intrinsics<['rad']>>) {
      const controls = this[$controls];
      const scene = this[$scene];
      scene.framedFoVDeg = (style[0] * 180) / Math.PI;
      controls.changeSource = ChangeSource.NONE;
      controls.setFieldOfView(scene.adjustedFoV(scene.framedFoVDeg));
      this[$cancelPrompts]();
    }

    [$syncCameraOrbit](style: EvaluatedStyle<SphericalIntrinsics>) {
      const controls = this[$controls];
      if (this[$maintainThetaPhi]) {
        const { theta, phi } = this.getCameraOrbit();
        style[0] = theta;
        style[1] = phi;
        this[$maintainThetaPhi] = false;
      }
      controls.changeSource = ChangeSource.NONE;
      controls.setOrbit(style[0], style[1], style[2]);
      this[$cancelPrompts]();
    }

    [$syncMinCameraOrbit](style: EvaluatedStyle<SphericalIntrinsics>) {
      this[$controls].applyOptions({
        minimumAzimuthalAngle: style[0],
        minimumPolarAngle: style[1],
        minimumRadius: style[2],
      });
      this.jumpCameraToGoal();
    }

    [$syncMaxCameraOrbit](style: EvaluatedStyle<SphericalIntrinsics>) {
      this[$controls].applyOptions({
        maximumAzimuthalAngle: style[0],
        maximumPolarAngle: style[1],
        maximumRadius: style[2],
      });
      this[$updateCameraForRadius](style[2]);
      this.jumpCameraToGoal();
    }

    [$syncMinFieldOfView](style: EvaluatedStyle<Intrinsics<['rad']>>) {
      this[$controls].applyOptions({
        minimumFieldOfView: (style[0] * 180) / Math.PI,
      });
      this.jumpCameraToGoal();
    }

    [$syncMaxFieldOfView](style: EvaluatedStyle<Intrinsics<['rad']>>) {
      const fov = this[$scene].adjustedFoV((style[0] * 180) / Math.PI);
      this[$controls].applyOptions({ maximumFieldOfView: fov });
      this.jumpCameraToGoal();
    }

    [$syncCameraTarget](style: EvaluatedStyle<Vector3Intrinsics>) {
      const [x, y, z] = style;
      if (!this[$renderer].arRenderer.isPresenting) {
        this[$scene].setTarget(x, y, z);
      }
      this[$controls].changeSource = ChangeSource.NONE;
      this[$renderer].arRenderer.updateTarget();
      this[$cancelPrompts]();
    }

    [$tick](time: number, delta: number) {
      super[$tick](time, delta);

      if (this[$renderer].isPresenting || !this[$getModelIsVisible]()) {
        return;
      }

      const controls = this[$controls];
      const scene = this[$scene];

      const now = performance.now();
      if (this[$waitingToPromptUser]) {
        if (
          this.loaded &&
          now > this[$loadedTime] + this.interactionPromptThreshold
        ) {
          this[$waitingToPromptUser] = false;
          this[$promptElementVisibleTime] = now;

          this[$promptElement].classList.add('visible');
        }
      }

      let interactionPromptAdjustedOrbit = false;

      if (
        isFinite(this[$promptElementVisibleTime]) &&
        this.interactionPromptStyle === InteractionPromptStyle.WIGGLE
      ) {
        const animationTime =
          ((now - this[$promptElementVisibleTime]) / PROMPT_ANIMATION_TIME) % 1;
        const offset = wiggle(animationTime);
        const opacity = fade(animationTime);

        this[$promptAnimatedContainer].style.opacity = `${opacity}`;

        if (offset !== this[$lastPromptOffset]) {
          const xOffset = offset * scene.width * 0.05;
          const deltaTheta =
            ((offset - this[$lastPromptOffset]) * Math.PI) / 16;

          this[$promptAnimatedContainer].style.transform =
            `translateX(${xOffset}px)`;

          controls.changeSource = ChangeSource.AUTOMATIC;
          controls.adjustOrbit(deltaTheta, 0, 0);
          interactionPromptAdjustedOrbit = true;

          this[$lastPromptOffset] = offset;
        }
      }

      const cameraMoved = controls.update(time, delta);
      const targetMoved = scene.updateTarget(delta);

      if (cameraMoved || targetMoved) {
        this[$onChange]();
      } else if (interactionPromptAdjustedOrbit) {
        // CameraControls may have applied the wiggle before update() returned true
        // (e.g. when rotateTo snaps with enableTransition=false). Ensure a frame is
        // rendered so the interaction prompt is visible without auto-rotate.
        this[$needsRender]();
      }

      // Do not leave AUTOMATIC set after wiggle; otherwise the next controlstart
      // is treated as part of the prompt instead of user interaction.
      if (
        interactionPromptAdjustedOrbit &&
        controls.changeSource === ChangeSource.AUTOMATIC
      ) {
        controls.changeSource = ChangeSource.NONE;
      }

      if (this.viewportGizmoHandle) {
        // Keep gizmo orientation in sync with the current camera.
        this.viewportGizmoHandle.gizmo.cameraUpdate();
        if (this.showViewportGizmo) {
          this.viewportGizmoHandle.render();
        }
      }
    }

    [$deferInteractionPrompt]() {
      // Effectively cancel the timer waiting for user interaction:
      this[$waitingToPromptUser] = false;
      this[$promptElement].classList.remove('visible');
      this[$promptElementVisibleTime] = Infinity;
    }

    /**
     * Updates the camera's near and far planes to enclose the scene when
     * orbiting at the supplied radius.
     */
    [$updateCameraForRadius](radius: number) {
      const maximumRadius = Math.max(this[$scene].farRadius(), radius);

      const near = 0;
      const far = Math.abs(2 * maximumRadius);
      this[$controls].updateNearFar(near, far);
    }

    [$updateAria]() {
      const { theta, phi } = this[$controls]!.getCameraSpherical(
        this[$lastSpherical]
      );

      const azimuthalQuadrant =
        (4 + Math.floor(((theta % TAU) + QUARTER_PI) / HALF_PI)) % 4;

      const polarTrient = Math.floor(phi / THIRD_PI);

      const azimuthalQuadrantLabel =
        AZIMUTHAL_QUADRANT_LABELS[azimuthalQuadrant];
      const polarTrientLabel = POLAR_TRIENT_LABELS[polarTrient];
      const position = `${polarTrientLabel}${azimuthalQuadrantLabel}`;

      const key = position as keyof A11yTranslationsInterface;
      if (key in this[$a11y]) {
        this[$updateStatus](this[$a11y][key]);
      } else {
        this[$updateStatus](`View from stage ${position}`);
      }

      return position; // HACK
    }

    get [$ariaLabel]() {
      let interactionPrompt = INTERACTION_PROMPT;
      if ('interaction-prompt' in this[$a11y]) {
        interactionPrompt = `. ${this[$a11y]['interaction-prompt']}`;
      }

      return (
        super[$ariaLabel].replace(/\.$/, '') +
        (this.cameraControls ? interactionPrompt : '')
      );
    }

    async [$onResize](event: any) {
      const controls = this[$controls];
      const scene = this[$scene];
      const oldFramedFoV = scene.adjustedFoV(scene.framedFoVDeg);

      // The super of $onResize may update the scene's adjustedFoV, so we
      // compare the before and after to calculate the proper zoom.
      super[$onResize](event);

      const fovRatio = scene.adjustedFoV(scene.framedFoVDeg) / oldFramedFoV;
      const fov =
        controls.getFieldOfView() * (isFinite(fovRatio) ? fovRatio : 1);

      controls.updateAspect(this[$scene].aspect);

      this.requestUpdate('maxFieldOfView', this.maxFieldOfView);
      await this.updateComplete;
      this[$controls].setFieldOfView(fov);

      this.jumpCameraToGoal();

      if (this.viewportGizmoHandle) {
        this.viewportGizmoHandle.updateOnResize(
          this[$scene].width,
          this[$scene].height
        );
      }
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      if (this[$initialized]) {
        this[$maintainThetaPhi] = true;
      } else {
        this[$initialized] = true;
      }
      this.requestUpdate('maxFieldOfView', this.maxFieldOfView);
      this.requestUpdate('fieldOfView', this.fieldOfView);
      this.requestUpdate('minCameraOrbit', this.minCameraOrbit);
      this.requestUpdate('maxCameraOrbit', this.maxCameraOrbit);
      this.requestUpdate('cameraOrbit', this.cameraOrbit);
      this.requestUpdate('cameraTarget', this.cameraTarget);
      this.jumpCameraToGoal();

      if (this.showViewportGizmo) {
        this.viewportGizmoHandle = ensureViewportGizmo({
          host: this,
          scene: this[$scene],
          container: this[$container],
          controls: this[$controls],
          show: this.showViewportGizmo,
          existing: this.viewportGizmoHandle,
        });
      }
    }

    [$cancelPrompts] = () => {
      const source = this[$controls].changeSource;
      this[$cancellationSource] = source;

      if (source === ChangeSource.USER_INTERACTION) {
        this[$userHasInteracted] = true;
        this[$deferInteractionPrompt]();
      }
    };

    [$onChange] = () => {
      const spatialRegion = this[$updateAria](); // HACK
      this[$needsRender]();
      const source = this[$controls].changeSource;

      this.dispatchEvent(
        new CustomEvent<CameraChangeDetails>('camera-change', {
          detail: { source, spatialRegion },
        })
      ); // HACK
    };

    [$onPointerChange] = (event: PointerChangeEvent) => {
      this[$container].classList.toggle(
        'pointer-tumbling',
        event.type === 'pointer-change-start'
      );
    };

    [$updateA11y]() {
      if (typeof this.a11y === 'string') {
        if (this.a11y.startsWith('{')) {
          try {
            this[$a11y] = JSON.parse(this.a11y);
          } catch (error) {
            console.warn('Error parsing a11y JSON:', error);
          }
        } else if (this.a11y.length > 0) {
          console.warn(
            'Error not supported format, should be a JSON string:',
            this.a11y
          );
        } else {
          this[$a11y] = <A11yTranslationsInterface>{};
        }
      } else if (typeof this.a11y === 'object' && this.a11y != null) {
        this[$a11y] = Object.assign({}, this.a11y);
      } else {
        this[$a11y] = <A11yTranslationsInterface>{};
      }

      this[$userInputElement].setAttribute('aria-label', this[$ariaLabel]);
    }
  }

  return ControlsModelViewerElement;
};
