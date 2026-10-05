// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Lighting subsystem.
 *
 * Owns the directional sun light and the authoritative `SunUniforms`
 * instance. Sun direction/intensity flow from preset params each
 * `applyParams`. Ambient fill comes from `scene.environment` (the active
 * sky provider's prefiltered environment), scaled by
 * `water.environment.intensity` — the subsystem adds no ambient light of
 * its own.
 *
 * Cross-subsystem couplings (notably the caustics shadow refresh) are
 * implemented via a sun-sync listener list — consumers self-register at
 * construction time and `WaterSystem` does not need to know they exist.
 */

import * as THREE from "three/webgpu";
import type { UniformNode } from "three/webgpu";
import type { SkyProvider } from "../components/sky/SkyProvider";
import type { QualityLevel, QualityLevelConfig } from "../config/QualityLevels";
import type { WaterSceneConfig } from "../config/presets/types";
import { SunUniforms } from "../uniforms";
import type { WaterSubsystem } from "./types";

/** The shape returned by {@link SkyProvider.getSun}. */
type ProviderSun = {
  color: UniformNode<THREE.Color>;
  direction: UniformNode<THREE.Vector3>;
  intensity: UniformNode<number>;
};

/** Called once after every `step()` syncs the sun light. */
export type SunSyncListener = () => void;

/**
 * Sun lighting. A `WaterSubsystem`; `WaterSystem` adds it to the registry
 * and iterates it like any other.
 */
export class Lighting implements WaterSubsystem {
  private readonly _scene: THREE.Scene;

  private readonly _sun = new SunUniforms();
  private readonly _sunLight: THREE.DirectionalLight;

  private readonly _sunSyncListeners: SunSyncListener[] = [];

  /**
   * The active sky provider's animated sun state, captured on
   * {@link onSkyChanged}. `null` for providers with no `getSun` (the
   * built-in `Sky`, or no sky at all) — water-pro's own sun params stay
   * authoritative in that case.
   */
  private _providerSun: ProviderSun | null = null;

  /**
   * @param scene - The Three.js scene; the constructed lights are added
   *   here immediately and removed on `dispose`.
   */
  constructor(scene: THREE.Scene) {
    this._scene = scene;
    this._sunLight = Lighting._createSunLight(this._sun);
    scene.add(this._sunLight);
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
   * Register a callback that fires once per `step()` after the sun light
   * is synced. Used by consumers that need to react to `castShadow` /
   * shadow-map allocation flips (e.g. screen-space caustics rebinding
   * the shadow depth texture once Three.js allocates it).
   */
  addSunSyncListener(fn: SunSyncListener): void {
    this._sunSyncListeners.push(fn);
  }

  applyParams(params: WaterSceneConfig): void {
    this._sun.update(params.sky.sun);
    this._syncSunLight();
  }

  step(): void {
    this._syncProviderSun();
    this._syncSunLight();
  }

  onQualityChanged(_quality: QualityLevel, _config: QualityLevelConfig): void {
    // Lights are quality-independent; nothing to rebuild.
  }

  /**
   * Capture the active provider's animated sun state, if any. A reference
   * swap isn't viable here — the water fragment shader and sun shafts have
   * already captured {@link _sun}'s uniform nodes into their built shader
   * graphs, so rebinding to a different node would force a full graph
   * rebuild on every provider swap. Instead {@link _syncProviderSun} copies
   * values into the existing nodes every step, the same pattern already
   * used for `gpuTime` / `animationSpeed`.
   */
  onSkyChanged(sky: SkyProvider | null): void {
    this._providerSun = sky?.getSun?.() ?? null;
  }

  dispose(): void {
    this._scene.remove(this._sunLight);
    this._sunSyncListeners.length = 0;
  }

  /**
   * Copy the active provider's animated sun values into {@link _sun}'s
   * uniform nodes. No-op when no provider is bound or the bound provider has
   * no `getSun` (the built-in `Sky`) — water-pro's own sun params stay
   * authoritative in that case.
   */
  private _syncProviderSun(): void {
    const providerSun = this._providerSun;
    if (!providerSun) return;
    this._sun.direction.value.copy(providerSun.direction.value);
    this._sun.intensity.value = providerSun.intensity.value;
    this._sun.color.copy(providerSun.color.value);
  }

  private _syncSunLight(): void {
    this._sunLight.position.copy(this._sun.direction.value).multiplyScalar(150);
    this._sunLight.intensity = this._sun.intensity.value;
    this._sunLight.color.copy(this._sun.color);

    for (const listener of this._sunSyncListeners) {
      listener();
    }
  }

  private static _createSunLight(sun: SunUniforms): THREE.DirectionalLight {
    const sunLight = new THREE.DirectionalLight(sun.color, sun.intensity.value);
    sunLight.castShadow = true;

    const shadowSize = 100;
    sunLight.shadow.camera.left = -shadowSize;
    sunLight.shadow.camera.right = shadowSize;
    sunLight.shadow.camera.top = shadowSize;
    sunLight.shadow.camera.bottom = -shadowSize;
    sunLight.shadow.camera.near = 1;
    sunLight.shadow.camera.far = 400;
    sunLight.shadow.mapSize.set(4096, 4096);
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;

    return sunLight;
  }
}
