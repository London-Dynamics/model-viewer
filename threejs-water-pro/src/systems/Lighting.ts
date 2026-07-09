/**
 * Lighting subsystem.
 *
 * Owns the directional sun light, the hemisphere fill light, and the
 * authoritative `SunUniforms` instance. Sun direction/intensity flow from
 * preset params each `applyParams`; HemisphereLight tint and intensity come
 * straight from `params.lighting.ambient`.
 *
 * Cross-subsystem couplings (notably the caustics shadow refresh) are
 * implemented via a sun-sync listener list — consumers self-register at
 * construction time and `WaterSystem` does not need to know they exist.
 */

import * as THREE from "three/webgpu";
import type { QualityLevel, QualityLevelConfig } from "../config/QualityLevels";
import type { WaterSceneParams } from "../config/presets/types";
import { SunUniforms } from "../uniforms";
import type { WaterSubsystem } from "./types";

/** Called once after every `step()` syncs the sun light. */
export type SunSyncListener = () => void;

/**
 * Sun + ambient lighting. A `WaterSubsystem`; `WaterSystem` adds it to
 * the registry and iterates it like any other.
 */
export class Lighting implements WaterSubsystem {
  private readonly _scene: THREE.Scene;

  private readonly _sun = new SunUniforms();
  private readonly _sunLight: THREE.DirectionalLight;
  private readonly _hemisphereLight: THREE.HemisphereLight;

  private readonly _ambient = {
    skyColor: new THREE.Color(0xaac8ff),
    groundColor: new THREE.Color(0x5a4a3a),
    intensity: 0.7,
  };

  private readonly _sunSyncListeners: SunSyncListener[] = [];

  /**
   * @param scene - The Three.js scene; the constructed lights are added
   *   here immediately and removed on `dispose`.
   */
  constructor(scene: THREE.Scene) {
    this._scene = scene;
    this._sunLight = Lighting._createSunLight(this._sun);
    this._hemisphereLight = Lighting._createHemisphereLight();
    scene.add(this._sunLight);
    scene.add(this._hemisphereLight);
  }

  /** Sun uniforms (direction, intensity, disk colour). */
  get sun(): SunUniforms {
    return this._sun;
  }

  /**
   * The Three.js directional light driven by the sun direction. Position,
   * target, and intensity are overwritten each frame from {@link sun}, so
   * do not reassign or replace the light. Toggle `castShadow` and tune
   * `shadow.mapSize`, `shadow.bias`, and the shadow camera frustum to
   * suit your scene.
   */
  get sunLight(): THREE.DirectionalLight {
    return this._sunLight;
  }

  /**
   * Read-only handle to the `THREE.HemisphereLight` that fills shaded
   * sides of the scene. Colour and intensity are driven by
   * `params.lighting.ambient` on each `applyParams` / `step`; do not
   * reassign or replace the light itself.
   */
  get hemisphereLight(): THREE.HemisphereLight {
    return this._hemisphereLight;
  }

  /**
   * Mutable ambient tint values. UI controls can write here to live-tweak;
   * `step()` reads from this on every frame.
   */
  get ambient(): {
    skyColor: THREE.Color;
    groundColor: THREE.Color;
    intensity: number;
  } {
    return this._ambient;
  }

  /**
   * Register a callback that fires once per `step()` after the sun light
   * is synced. Used by consumers that need to react to `castShadow` /
   * shadow-map allocation flips (e.g. screen-space caustics rebinding
   * the shadow depth texture once Three.js allocates it).
   */
  addSunSyncListener(fn: SunSyncListener): void {
    this._sunSyncListeners.push(fn);
  }

  applyParams(params: WaterSceneParams): void {
    this._sun.update(params.sky.sun);
    this._ambient.skyColor.set(params.lighting.ambient.skyColor);
    this._ambient.groundColor.set(params.lighting.ambient.groundColor);
    this._ambient.intensity = params.lighting.ambient.intensity;
    this._syncSunLight();
    this._syncAmbientLight();
  }

  step(): void {
    this._syncSunLight();
    this._syncAmbientLight();
  }

  onQualityChanged(_quality: QualityLevel, _config: QualityLevelConfig): void {
    // Lights are quality-independent; nothing to rebuild.
  }

  dispose(): void {
    this._scene.remove(this._sunLight);
    this._scene.remove(this._hemisphereLight);
    this._sunSyncListeners.length = 0;
  }

  private _syncSunLight(): void {
    this._sunLight.position.copy(this._sun.direction.value).multiplyScalar(1500);
    this._sunLight.intensity = this._sun.intensity.value;
    this._sunLight.color.copy(this._sun.color);

    for (const listener of this._sunSyncListeners) {
      listener();
    }
  }

  private _syncAmbientLight(): void {
    this._hemisphereLight.color.copy(this._ambient.skyColor);
    this._hemisphereLight.groundColor.copy(this._ambient.groundColor);
    this._hemisphereLight.intensity = this._ambient.intensity;
  }

  private static _createSunLight(sun: SunUniforms): THREE.DirectionalLight {
    const sunLight = new THREE.DirectionalLight(sun.color, sun.intensity.value);
    sunLight.castShadow = true;

    const shadowSize = 1500;
    sunLight.shadow.camera.left = -shadowSize;
    sunLight.shadow.camera.right = shadowSize;
    sunLight.shadow.camera.top = shadowSize;
    sunLight.shadow.camera.bottom = -shadowSize;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 3000;
    sunLight.shadow.mapSize.set(4096, 4096);
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;

    return sunLight;
  }

  private static _createHemisphereLight(): THREE.HemisphereLight {
    return new THREE.HemisphereLight(0xaac8ff, 0x5a4a3a, 0.7);
  }
}
