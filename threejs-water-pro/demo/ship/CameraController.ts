// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { ShipController } from "./ShipController";

export type CameraMode = "thirdPerson" | "freeCamera" | "flightCamera";

/**
 * Camera controller with 3 modes toggled by 1/2/3 keys or UI.
 */
export class CameraController {
  private orbitCamera: THREE.PerspectiveCamera;
  private canvas: HTMLElement;
  private ship: THREE.Mesh;
  private shipController: ShipController;
  private orbitControls: OrbitControls;

  // State
  public mode: CameraMode = "freeCamera";
  private enabled = false;

  // Third person state — OrbitControls orbits/zooms around the ship while the
  // ship is driven with WASD. The orbit target follows the ship each frame.
  private readonly followSmoothness = 10;
  /** Initial camera placement (height, behind) when entering third person. */
  private readonly thirdPersonOffset = new THREE.Vector3(0, 12, -25);

  // Flight camera state
  private flightVelocity = new THREE.Vector3();
  private flightInputDir = new THREE.Vector3();
  private flightKeys = {
    w: false,
    a: false,
    s: false,
    d: false,
    q: false,
    e: false,
    shift: false,
  };
  private readonly flightSpeed = 10; // Base movement speed (units/sec)
  private readonly flightSprintMultiplier = 3; // Speed multiplier when holding shift
  private readonly flightAcceleration = 2; // How quickly velocity responds to input
  private readonly flightDamping = 5; // How quickly velocity decays when no input

  // Flight camera rotation (mouse controls rotational velocity)
  private mouseNormalized = new THREE.Vector2(); // -1 to 1, center is 0
  private flightYaw = 0;
  private flightPitch = 0;
  private readonly flightRotationSpeed = 2.0; // Radians per second at full deflection
  private readonly flightPitchMin = (-80 * Math.PI) / 180;
  private readonly flightPitchMax = (80 * Math.PI) / 180;

  // Reusable objects
  private readonly tempVec = new THREE.Vector3();
  private readonly tempQuat = new THREE.Quaternion();

  // Mode change callbacks for HUD, UI sync, and camera swapping
  private modeChangeListeners: ((mode: CameraMode) => void)[] = [];

  constructor(
    orbitCamera: THREE.PerspectiveCamera,
    canvas: HTMLElement,
    ship: THREE.Mesh,
    shipController: ShipController,
    orbitControls: OrbitControls,
  ) {
    this.orbitCamera = orbitCamera;
    this.canvas = canvas;
    this.ship = ship;
    this.shipController = shipController;
    this.orbitControls = orbitControls;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
    this.canvas.addEventListener("mousemove", this.onMouseMove);
    this.canvas.addEventListener("mouseleave", this.onMouseLeave);
    this.setMode("freeCamera");
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mouseleave", this.onMouseLeave);
  }

  /** The camera currently in use for rendering */
  get activeCamera(): THREE.PerspectiveCamera {
    return this.orbitCamera;
  }

  /** Register a callback for mode changes */
  onModeChange(listener: (mode: CameraMode) => void): void {
    this.modeChangeListeners.push(listener);
  }

  /** Whether the current mode allows boat control via WASD */
  isBoatControlMode(): boolean {
    return this.mode === "thirdPerson";
  }

  /** Whether OrbitControls.update() should be called this frame */
  get shouldUpdateOrbitControls(): boolean {
    return this.mode === "freeCamera" || this.mode === "thirdPerson";
  }

  setMode(mode: CameraMode): void {
    const prev = this.mode;
    this.mode = mode;

    // Entering flight camera — initialize yaw/pitch from current camera orientation
    if (prev !== "flightCamera" && mode === "flightCamera") {
      const euler = new THREE.Euler().setFromQuaternion(
        this.orbitCamera.quaternion,
        "YXZ",
      );
      this.flightYaw = euler.y;
      this.flightPitch = euler.x;
    }

    // Leaving flight camera — reset state
    if (prev === "flightCamera" && mode !== "flightCamera") {
      this.flightVelocity.set(0, 0, 0);
      this.resetFlightKeys();
      this.mouseNormalized.set(0, 0);
    }

    // Free camera and third person both use OrbitControls for orbit + zoom.
    // Third person locks the orbit target to the ship and disables panning
    // (the target follows the ship every frame); free camera allows panning.
    this.orbitControls.enabled =
      mode === "freeCamera" || mode === "thirdPerson";

    if (mode === "thirdPerson") {
      this.orbitControls.enablePan = false;
      // Entering third person: snap to a behind-the-ship view so the user
      // isn't left wherever the previous mode's camera happened to be.
      if (prev !== "thirdPerson") this.placeBehindShip();
    } else if (mode === "freeCamera") {
      this.orbitControls.enablePan = true;
    }

    for (const listener of this.modeChangeListeners) {
      listener(mode);
    }
  }

  /** Position the camera behind and above the ship, target on the ship. */
  private placeBehindShip(): void {
    this.tempQuat.setFromAxisAngle(
      THREE.Object3D.DEFAULT_UP,
      this.shipController.yaw,
    );
    this.tempVec
      .copy(this.thirdPersonOffset)
      .applyQuaternion(this.tempQuat)
      .add(this.ship.position);
    this.orbitCamera.position.copy(this.tempVec);
    this.orbitControls.target.copy(this.ship.position);
    this.orbitControls.update();
  }

  private resetFlightKeys(): void {
    this.flightKeys.w = false;
    this.flightKeys.a = false;
    this.flightKeys.s = false;
    this.flightKeys.d = false;
    this.flightKeys.q = false;
    this.flightKeys.e = false;
    this.flightKeys.shift = false;
  }

  update(dt: number): void {
    if (!this.enabled) return;

    if (this.mode === "thirdPerson") {
      this.updateThirdPerson(dt);
    } else if (this.mode === "flightCamera") {
      this.updateFlightCamera(dt);
    }
    // First person: fpCamera is a child of the ship, position is automatic.
    // PointerLockControls handles rotation via mouse events.
    // Free camera: OrbitControls handles everything.
  }

  private updateFlightCamera(dt: number): void {
    // Apply rotational velocity from mouse position
    // Mouse at center = no rotation, mouse at edge = max rotation speed
    this.flightYaw -= this.mouseNormalized.x * this.flightRotationSpeed * dt;
    this.flightPitch -= this.mouseNormalized.y * this.flightRotationSpeed * dt;

    // Clamp pitch
    this.flightPitch = Math.max(
      this.flightPitchMin,
      Math.min(this.flightPitchMax, this.flightPitch),
    );

    // Apply rotation to camera
    this.tempQuat.setFromEuler(
      new THREE.Euler(this.flightPitch, this.flightYaw, 0, "YXZ"),
    );
    this.orbitCamera.quaternion.copy(this.tempQuat);

    // Build input direction from WASD+QE keys
    this.flightInputDir.set(0, 0, 0);

    if (this.flightKeys.w) this.flightInputDir.z -= 1;
    if (this.flightKeys.s) this.flightInputDir.z += 1;
    if (this.flightKeys.a) this.flightInputDir.x -= 1;
    if (this.flightKeys.d) this.flightInputDir.x += 1;
    if (this.flightKeys.q) this.flightInputDir.y -= 1;
    if (this.flightKeys.e) this.flightInputDir.y += 1;

    const hasInput = this.flightInputDir.lengthSq() > 0;

    if (hasInput) {
      this.flightInputDir.normalize();

      // Transform input direction to world space based on camera orientation
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
        this.orbitCamera.quaternion,
      );
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
        this.orbitCamera.quaternion,
      );
      const up = new THREE.Vector3(0, 1, 0);

      // Build world-space movement direction
      this.tempVec.set(0, 0, 0);
      this.tempVec.addScaledVector(right, this.flightInputDir.x);
      this.tempVec.addScaledVector(up, this.flightInputDir.y);
      this.tempVec.addScaledVector(forward, -this.flightInputDir.z);

      // Apply speed (with sprint multiplier if shift held)
      const speed = this.flightKeys.shift
        ? this.flightSpeed * this.flightSprintMultiplier
        : this.flightSpeed;
      this.tempVec.multiplyScalar(speed);

      // Accelerate toward target velocity
      const accelFactor = 1 - Math.exp(-this.flightAcceleration * dt);
      this.flightVelocity.lerp(this.tempVec, accelFactor);
    } else {
      // Dampen velocity when no input
      const dampFactor = Math.exp(-this.flightDamping * dt);
      this.flightVelocity.multiplyScalar(dampFactor);
    }

    // Apply velocity to camera position
    this.orbitCamera.position.addScaledVector(this.flightVelocity, dt);
  }

  private updateThirdPerson(dt: number): void {
    // Follow the ship while preserving the user's orbit angle and zoom: shift
    // BOTH the orbit target and the camera by the same (smoothed) delta toward
    // the ship, so the camera→target offset OrbitControls maintains is
    // unchanged. `WaterApp` then calls `orbitControls.update()` (see
    // `shouldUpdateOrbitControls`), which applies the user's drag/zoom on top.
    const lerpFactor = 1 - Math.exp(-this.followSmoothness * dt);
    const delta = this.tempVec
      .copy(this.ship.position)
      .sub(this.orbitControls.target)
      .multiplyScalar(lerpFactor);
    this.orbitControls.target.add(delta);
    this.orbitCamera.position.add(delta);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isInputElement(e.target)) return;

    // Mode switching
    switch (e.key) {
      case "1":
        this.setMode("freeCamera");
        return;
      case "2":
        this.setMode("flightCamera");
        return;
      case "3":
        this.setMode("thirdPerson");
        return;
    }

    // Flight camera movement keys
    if (this.mode === "flightCamera") {
      switch (e.key.toLowerCase()) {
        case "w":
          this.flightKeys.w = true;
          break;
        case "a":
          this.flightKeys.a = true;
          break;
        case "s":
          this.flightKeys.s = true;
          break;
        case "d":
          this.flightKeys.d = true;
          break;
        case "q":
          this.flightKeys.q = true;
          break;
        case "e":
          this.flightKeys.e = true;
          break;
        case "shift":
          this.flightKeys.shift = true;
          break;
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.mode === "flightCamera") {
      switch (e.key.toLowerCase()) {
        case "w":
          this.flightKeys.w = false;
          break;
        case "a":
          this.flightKeys.a = false;
          break;
        case "s":
          this.flightKeys.s = false;
          break;
        case "d":
          this.flightKeys.d = false;
          break;
        case "q":
          this.flightKeys.q = false;
          break;
        case "e":
          this.flightKeys.e = false;
          break;
        case "shift":
          this.flightKeys.shift = false;
          break;
      }
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.mode !== "flightCamera") return;

    // Calculate normalized mouse position (-1 to 1, center is 0)
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    this.mouseNormalized.set(x, y);
  };

  private onMouseLeave = (): void => {
    // Reset mouse to center when leaving canvas
    this.mouseNormalized.set(0, 0);
  };

  private isInputElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  }
}
