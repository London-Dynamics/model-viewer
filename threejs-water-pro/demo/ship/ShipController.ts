import * as THREE from "three/webgpu";
import type { WaterSystem } from "threejs-water-pro";

/**
 * WASD ship controller with a 3-DOF (surge / sway / yaw) maneuvering model.
 *
 * Rather than rotating the hull about its origin, the rudder is treated as a
 * stern foil whose side force (∝ dynamic pressure · sin of the rudder angle)
 * produces a yaw moment. The rigid-body kinematics then couple that turn into a
 * lateral (sway) velocity, so the hull crabs with a drift angle and its pivot
 * point sits forward — the bow rides inside the turn and the stern swings wide,
 * the way a real vessel making way behaves. Updates ship XZ position + yaw each
 * frame and syncs heading to the buoyancy system via rotationOffset.
 */
export class ShipController {
  // References (may be swapped on quality rebuild)
  private ship: THREE.Mesh;
  private buoyancyId: number;
  private waterSystem: WaterSystem;

  // Physics tuning (adjustable via UI)
  public thrust = 15;
  public drag = 0.5;
  public maxSpeed = 50;
  public reverseMaxSpeed = 15;
  public maxRudderAngle = Math.PI / 6; // 30°
  public rudderRate = 1.5; // rad/s
  public rudderReturn = 2.0; // rad/s
  public throttleRate = 0.8; // per second
  /** Rudder yaw authority: peak yaw acceleration at full speed and rudder. */
  public rudderTurn = 0.6; // rad/s²
  /** Hull resistance to yaw rate — sets course-keeping and turn lag/overshoot. */
  public yawDamping = 0.8; // 1/s
  /** Hull resistance to lateral motion — its balance with the turn sets the drift angle. */
  public swayDamping = 1.2; // 1/s

  // Physics state
  /** Surge: forward velocity along the hull's heading (m/s). */
  public speed = 0;
  /** Sway: lateral velocity (m/s); nonzero in turns, producing the drift angle. */
  public swaySpeed = 0;
  /** Yaw rate (rad/s); integrated from the rudder moment, not set directly. */
  public yawRate = 0;
  public throttle = 0;
  public rudderAngle = 0;
  public yaw = 0;

  // Input state
  private keys = { w: false, a: false, s: false, d: false };
  private enabled = false;

  // Reusable objects
  private readonly rotationOffset = new THREE.Euler(0, 0, 0, "YXZ");

  constructor(ship: THREE.Mesh, buoyancyId: number, waterSystem: WaterSystem) {
    this.ship = ship;
    this.buoyancyId = buoyancyId;
    this.waterSystem = waterSystem;
    this.yaw = ship.rotation.y;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    document.removeEventListener("keydown", this.onKeyDown);
    document.removeEventListener("keyup", this.onKeyUp);
    this.keys = { w: false, a: false, s: false, d: false };
  }

  /** Called when quality level changes and buoyancy is rebuilt */
  updateReferences(buoyancyId: number, waterSystem: WaterSystem): void {
    this.buoyancyId = buoyancyId;
    this.waterSystem = waterSystem;
    // Re-sync yaw to new buoyancy object
    this.syncYawToBuoyancy();
  }

  update(dt: number): void {
    if (!this.enabled) return;

    // Clamp delta to avoid physics explosions on tab-out
    const clampedDt = Math.min(dt, 0.1);

    this.updateThrottle(clampedDt);
    this.updateRudder(clampedDt);
    this.updateDynamics(clampedDt);
    this.syncYawToBuoyancy();
  }

  private updateThrottle(dt: number): void {
    if (this.keys.w) {
      this.throttle = Math.min(this.throttle + this.throttleRate * dt, 1);
    } else if (this.keys.s) {
      this.throttle = Math.max(this.throttle - this.throttleRate * dt, -1);
    } else {
      // Decay toward zero
      if (this.throttle > 0) {
        this.throttle = Math.max(this.throttle - this.throttleRate * dt, 0);
      } else if (this.throttle < 0) {
        this.throttle = Math.min(this.throttle + this.throttleRate * dt, 0);
      }
    }
  }

  private updateRudder(dt: number): void {
    if (this.keys.a) {
      this.rudderAngle = Math.min(
        this.rudderAngle + this.rudderRate * dt,
        this.maxRudderAngle,
      );
    } else if (this.keys.d) {
      this.rudderAngle = Math.max(
        this.rudderAngle - this.rudderRate * dt,
        -this.maxRudderAngle,
      );
    } else {
      // Self-center
      if (this.rudderAngle > 0) {
        this.rudderAngle = Math.max(
          this.rudderAngle - this.rudderReturn * dt,
          0,
        );
      } else if (this.rudderAngle < 0) {
        this.rudderAngle = Math.min(
          this.rudderAngle + this.rudderReturn * dt,
          0,
        );
      }
    }
  }

  /**
   * Advance the coupled surge / sway / yaw state one step, then the position.
   * The three axes are integrated together because they are coupled: the rudder
   * drives yaw, and the rigid-body Coriolis terms trade momentum between the
   * forward and lateral axes as the hull turns.
   */
  private updateDynamics(dt: number): void {
    // Surge (forward axis): throttle thrust vs. linear drag, plus the Coriolis
    // term swaySpeed·yawRate that feeds a developing turn back into forward
    // speed (the small speed loss felt in a hard turn).
    const surgeAccel =
      this.throttle * this.thrust -
      this.drag * this.speed +
      this.swaySpeed * this.yawRate;
    this.speed += surgeAccel * dt;
    if (this.speed > 0) {
      this.speed = Math.min(this.speed, this.maxSpeed);
    } else {
      this.speed = Math.max(this.speed, -this.reverseMaxSpeed);
    }

    // Yaw: the rudder's side force scales with dynamic pressure (speed²) and
    // sin(rudder angle). Using flow·|flow| flips its sense when going astern —
    // no flow over the rudder means no turning authority. yawDamping is the
    // hull's course-keeping resistance and sets the turn lag and overshoot.
    const flow = this.speed / this.maxSpeed;
    const rudderMoment =
      this.rudderTurn * flow * Math.abs(flow) * Math.sin(this.rudderAngle);
    this.yawRate += (rudderMoment - this.yawDamping * this.yawRate) * dt;

    // Sway (lateral axis): the centripetal coupling −speed·yawRate pushes the
    // hull sideways through a turn; swayDamping is the hull's strong lateral
    // resistance. Their steady balance is the drift angle, so the pivot point
    // emerges forward of amidships rather than being pinned to the origin.
    const swayAccel =
      -this.speed * this.yawRate - this.swayDamping * this.swaySpeed;
    this.swaySpeed += swayAccel * dt;

    // Integrate heading, then advance the position by the body-frame velocity
    // rotated into the world: forward along the heading, sway perpendicular to
    // it. (Hull faces +Z at yaw = 0.)
    this.yaw += this.yawRate * dt;
    const forwardX = Math.sin(this.yaw);
    const forwardZ = Math.cos(this.yaw);
    const lateralX = Math.cos(this.yaw);
    const lateralZ = -Math.sin(this.yaw);
    this.ship.position.x +=
      (this.speed * forwardX + this.swaySpeed * lateralX) * dt;
    this.ship.position.z +=
      (this.speed * forwardZ + this.swaySpeed * lateralZ) * dt;
  }

  private syncYawToBuoyancy(): void {
    this.rotationOffset.set(0, this.yaw, 0);
    this.waterSystem.buoyancy.updateObjectConfig(this.buoyancyId, {
      rotationOffset: this.rotationOffset,
    });
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.isInputElement(e.target)) return;
    const key = e.key.toLowerCase();
    if (key in this.keys) {
      this.keys[key as keyof typeof this.keys] = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (this.isInputElement(e.target)) return;
    const key = e.key.toLowerCase();
    if (key in this.keys) {
      this.keys[key as keyof typeof this.keys] = false;
    }
  };

  private isInputElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
  }
}
