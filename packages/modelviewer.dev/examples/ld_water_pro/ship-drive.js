import {Euler} from 'three';

/**
 * Vendor WASD helm from threejs-water-pro/demo/ship/ShipController.ts.
 * The page is a plain module, so this is that controller (same 3-DOF
 * surge / sway / yaw) plus arrow-key aliases. Hull forward is +Z at yaw 0.
 * Off until enable(). Heading is synced through buoyancy rotationOffset.
 */

const HELM_KEYS = {
  arrowup: 'w',
  arrowdown: 's',
  arrowleft: 'a',
  arrowright: 'd',
};

export const driveFromParam = (value) => value === '1' || value === 'true';

const helmKey = (key) => {
  const name = String(key).toLowerCase();
  return HELM_KEYS[name] ?? name;
};

const isEditableKeyTarget = (target) => {
  if (target == null || !(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
};

export class ShipController {
  thrust = 2;
  drag = 0.5;
  maxSpeed = 6;
  reverseMaxSpeed = 2;
  maxRudderAngle = Math.PI / 6;
  rudderRate = 1.5;
  rudderReturn = 2;
  throttleRate = 0.8;
  rudderTurn = 0.6;
  yawDamping = 0.8;
  swayDamping = 1.2;

  speed = 0;
  swaySpeed = 0;
  yawRate = 0;
  throttle = 0;
  rudderAngle = 0;
  yaw = 0;

  constructor(ship, buoyancyId, waterSystem) {
    this.ship = ship;
    this.buoyancyId = buoyancyId;
    this.waterSystem = waterSystem;
    this.yaw = ship.rotation.y;
    this.keys = {w: false, a: false, s: false, d: false};
    this.enabled = false;
    this.rotationOffset = new Euler(0, 0, 0, 'YXZ');
    this.onKeyDown = (event) => {
      if (isEditableKeyTarget(event.target)) {
        return;
      }
      const key = helmKey(event.key);
      if (key in this.keys) {
        this.keys[key] = true;
        event.preventDefault();
      }
    };
    this.onKeyUp = (event) => {
      if (isEditableKeyTarget(event.target)) {
        return;
      }
      const key = helmKey(event.key);
      if (key in this.keys) {
        this.keys[key] = false;
      }
    };
  }

  /** Test helper. Arrow keys use the same slots as WASD. */
  setKey(key, down) {
    const name = helmKey(key);
    if (name in this.keys) {
      this.keys[name] = down;
    }
  }

  enable() {
    if (this.enabled) {
      return;
    }
    this.enabled = true;
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
  }

  disable() {
    if (!this.enabled) {
      return;
    }
    this.enabled = false;
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    this.keys = {w: false, a: false, s: false, d: false};
  }

  update(dt) {
    if (!this.enabled) {
      return;
    }

    const step = Math.min(dt, 0.1);
    this.updateThrottle(step);
    this.updateRudder(step);
    this.updateDynamics(step);
    this.syncYawToBuoyancy();
  }

  updateThrottle(dt) {
    if (this.keys.w) {
      this.throttle = Math.min(this.throttle + this.throttleRate * dt, 1);
    } else if (this.keys.s) {
      this.throttle = Math.max(this.throttle - this.throttleRate * dt, -1);
    } else if (this.throttle > 0) {
      this.throttle = Math.max(this.throttle - this.throttleRate * dt, 0);
    } else if (this.throttle < 0) {
      this.throttle = Math.min(this.throttle + this.throttleRate * dt, 0);
    }
  }

  updateRudder(dt) {
    if (this.keys.a) {
      this.rudderAngle = Math.min(
          this.rudderAngle + this.rudderRate * dt, this.maxRudderAngle);
    } else if (this.keys.d) {
      this.rudderAngle = Math.max(
          this.rudderAngle - this.rudderRate * dt, -this.maxRudderAngle);
    } else if (this.rudderAngle > 0) {
      this.rudderAngle = Math.max(this.rudderAngle - this.rudderReturn * dt, 0);
    } else if (this.rudderAngle < 0) {
      this.rudderAngle = Math.min(this.rudderAngle + this.rudderReturn * dt, 0);
    }
  }

  updateDynamics(dt) {
    const surgeAccel =
      this.throttle * this.thrust - this.drag * this.speed +
      this.swaySpeed * this.yawRate;
    this.speed += surgeAccel * dt;
    this.speed = this.speed > 0 ?
      Math.min(this.speed, this.maxSpeed) :
      Math.max(this.speed, -this.reverseMaxSpeed);

    const flow = this.speed / this.maxSpeed;
    const rudderMoment =
      this.rudderTurn * flow * Math.abs(flow) * Math.sin(this.rudderAngle);
    this.yawRate += (rudderMoment - this.yawDamping * this.yawRate) * dt;

    const swayAccel =
      -this.speed * this.yawRate - this.swayDamping * this.swaySpeed;
    this.swaySpeed += swayAccel * dt;

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

  syncYawToBuoyancy() {
    this.rotationOffset.set(0, this.yaw, 0);
    this.waterSystem.buoyancy.updateObjectConfig(this.buoyancyId, {
      rotationOffset: this.rotationOffset,
    });
  }
}

/** Keep the orbit offset while the hull moves. Same follow as the vendor third person. */
export const followShipCamera = (camera, controls, ship, dt, smoothness = 10) => {
  const lerpFactor = 1 - Math.exp(-smoothness * dt);
  const dx = (ship.position.x - controls.target.x) * lerpFactor;
  const dy = (ship.position.y - controls.target.y) * lerpFactor;
  const dz = (ship.position.z - controls.target.z) * lerpFactor;
  controls.target.x += dx;
  controls.target.y += dy;
  controls.target.z += dz;
  camera.position.x += dx;
  camera.position.y += dy;
  camera.position.z += dz;
};
