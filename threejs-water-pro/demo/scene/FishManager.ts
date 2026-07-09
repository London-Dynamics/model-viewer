import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

interface FishInstance {
  mesh: THREE.Object3D;
  direction: THREE.Vector3;
  targetDirection: THREE.Vector3;
  turnTimer: number;
  speed: number;
  targetSpeed: number;
  animationMixer: THREE.AnimationMixer;
  initialDepth: number;
}

interface FishManagerOptions {
  count?: number;
  spawnRadius?: number;
  centerX?: number;
  centerZ?: number;
  minDepth?: number;
  maxDepth?: number;
  minSpeed?: number;
  maxSpeed?: number;
}

const DEFAULT_OPTIONS: Required<FishManagerOptions> = {
  count: 10,
  spawnRadius: 500,
  centerX: -300,
  centerZ: 300,
  minDepth: -70,
  maxDepth: -50,
  minSpeed: 10,
  maxSpeed: 20,
};

// Reusable objects to avoid allocations
const _lookMatrix = new THREE.Matrix4();
const _targetQuat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _modelRotation = new THREE.Quaternion().setFromAxisAngle(_up, THREE.MathUtils.degToRad(225));

/**
 * Manages a school of animated fish swimming aimlessly underwater
 */
export class FishManager {
  private scene: THREE.Scene;
  private fish: FishInstance[] = [];
  private options: Required<FishManagerOptions>;
  private group: THREE.Group;
  private isLoaded = false;

  constructor(scene: THREE.Scene, options: FishManagerOptions = {}) {
    this.scene = scene;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.group = new THREE.Group();
    this.group.name = "FishGroup";
    this.scene.add(this.group);
  }

  async load(): Promise<void> {
    const gltfLoader = new GLTFLoader();
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(
      "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
    );
    gltfLoader.setDRACOLoader(dracoLoader);

    const gltf = await gltfLoader.loadAsync("/models/fish.glb");
    const template = gltf.scene;
    const animations = gltf.animations;

    // Spawn fish instances
    const { count, spawnRadius, centerX, centerZ, minDepth, maxDepth } =
      this.options;

    for (let i = 0; i < count; i++) {
      // Use SkeletonUtils for proper skinned mesh cloning with animations
      const clone = SkeletonUtils.clone(template);
      const scale = 10 + Math.random() * 10;
      clone.scale.set(scale, scale, scale);
      clone.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });

      // Random position
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * spawnRadius;
      const x = centerX + Math.cos(angle) * radius;
      const z = centerZ + Math.sin(angle) * radius;
      const y = minDepth + Math.random() * (maxDepth - minDepth);
      clone.position.set(x, y, z);

      // Random initial direction (horizontal only)
      const dirAngle = Math.random() * Math.PI * 2;
      const direction = new THREE.Vector3(
        Math.cos(dirAngle),
        0,
        Math.sin(dirAngle),
      );

      // Store initial depth for this fish
      const initialDepth = y;

      // Set initial rotation to face movement direction
      _lookMatrix.lookAt(
        clone.position,
        clone.position.clone().add(direction),
        _up,
      );
      clone.quaternion.setFromRotationMatrix(_lookMatrix);
      clone.quaternion.multiply(_modelRotation);

      // Setup animation mixer
      const mixer = new THREE.AnimationMixer(clone);
      if (animations.length > 0) {
        const action = mixer.clipAction(animations[0]);
        action.play();
        // Randomize animation offset so fish aren't synchronized
        action.time = Math.random() * animations[0].duration;
        // Vary playback speed slightly for natural variation
        action.timeScale = 0.8 + Math.random() * 0.4;
      }

      this.group.add(clone);

      const speed =
        this.options.minSpeed +
        Math.random() * (this.options.maxSpeed - this.options.minSpeed);

      this.fish.push({
        mesh: clone,
        direction: direction.clone(),
        targetDirection: direction.clone(),
        turnTimer: 3 + Math.random() * 5,
        speed,
        targetSpeed: speed,
        animationMixer: mixer,
        initialDepth,
      });
    }

    this.isLoaded = true;
  }

  update(deltaTime: number): void {
    if (!this.isLoaded) return;

    const { spawnRadius, centerX, centerZ } = this.options;
    const turnRate = 0.8;
    const speedLerpRate = 0.5;

    for (const fish of this.fish) {
      // Update animation
      fish.animationMixer.update(deltaTime);

      // Update turn timer and pick new target direction
      fish.turnTimer -= deltaTime;
      if (fish.turnTimer <= 0) {
        fish.turnTimer = 4 + Math.random() * 6;

        // Pick a new horizontal direction
        const turnAmount = (Math.random() - 0.5) * Math.PI * 0.5;
        const currentAngle = Math.atan2(fish.direction.x, fish.direction.z);
        const newAngle = currentAngle + turnAmount;

        fish.targetDirection.set(Math.sin(newAngle), 0, Math.cos(newAngle));

        // Occasionally change speed
        fish.targetSpeed =
          this.options.minSpeed +
          Math.random() * (this.options.maxSpeed - this.options.minSpeed);
      }

      // Boundary steering - gently steer back toward center if too far
      const dx = fish.mesh.position.x - centerX;
      const dz = fish.mesh.position.z - centerZ;
      const distFromCenter = Math.sqrt(dx * dx + dz * dz);
      const boundaryStart = spawnRadius * 0.7;

      if (distFromCenter > boundaryStart) {
        const boundaryStrength =
          (distFromCenter - boundaryStart) / (spawnRadius * 0.3);
        const toCenter = new THREE.Vector3(-dx, 0, -dz).normalize();
        fish.targetDirection.lerp(toCenter, boundaryStrength * 0.3);
        fish.targetDirection.y = 0;
        fish.targetDirection.normalize();
      }

      // Smoothly interpolate direction toward target
      fish.direction.lerp(fish.targetDirection, deltaTime * turnRate);
      fish.direction.y = 0;
      fish.direction.normalize();

      // Smoothly interpolate speed
      fish.speed = THREE.MathUtils.lerp(
        fish.speed,
        fish.targetSpeed,
        deltaTime * speedLerpRate,
      );

      // Update position (horizontal only)
      fish.mesh.position.x += fish.direction.x * fish.speed * deltaTime;
      fish.mesh.position.z += fish.direction.z * fish.speed * deltaTime;
      fish.mesh.position.y = fish.initialDepth;

      // Smoothly rotate to face movement direction
      _lookMatrix.lookAt(
        fish.mesh.position,
        fish.mesh.position.clone().add(fish.direction),
        _up,
      );
      _targetQuat.setFromRotationMatrix(_lookMatrix);
      _targetQuat.multiply(_modelRotation);
      fish.mesh.quaternion.slerp(_targetQuat, deltaTime * 2);
    }
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    for (const fish of this.fish) {
      fish.animationMixer.stopAllAction();
    }
    this.fish = [];
    this.scene.remove(this.group);
  }
}
