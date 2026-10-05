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
import type { SkyProvider } from "../components/sky/SkyProvider";
import type { QualityLevel, QualityLevelConfig } from "../config/QualityLevels";
import type { WaterSceneConfig } from "../config/presets/types";
import { SunUniforms } from "../uniforms";
import type { WaterSubsystem } from "./types";
/** Called once after every `step()` syncs the sun light. */
export type SunSyncListener = () => void;
/**
 * Sun lighting. A `WaterSubsystem`; `WaterSystem` adds it to the registry
 * and iterates it like any other.
 */
export declare class Lighting implements WaterSubsystem {
    private readonly _scene;
    private readonly _sun;
    private readonly _sunLight;
    private readonly _sunSyncListeners;
    /**
     * The active sky provider's animated sun state, captured on
     * {@link onSkyChanged}. `null` for providers with no `getSun` (the
     * built-in `Sky`, or no sky at all) — water-pro's own sun params stay
     * authoritative in that case.
     */
    private _providerSun;
    /**
     * @param scene - The Three.js scene; the constructed lights are added
     *   here immediately and removed on `dispose`.
     */
    constructor(scene: THREE.Scene);
    /** Sun uniforms (direction, intensity, disk colour). */
    get sun(): SunUniforms;
    /**
     * The Three.js directional light driven by the sun direction. Position,
     * target, and intensity are overwritten each frame from {@link sun}, so
     * do not reassign or replace the light. Toggle `castShadow` and tune
     * `shadow.mapSize`, `shadow.bias`, and the shadow camera frustum to
     * suit your scene.
     */
    get sunLight(): THREE.DirectionalLight;
    /**
     * Register a callback that fires once per `step()` after the sun light
     * is synced. Used by consumers that need to react to `castShadow` /
     * shadow-map allocation flips (e.g. screen-space caustics rebinding
     * the shadow depth texture once Three.js allocates it).
     */
    addSunSyncListener(fn: SunSyncListener): void;
    applyParams(params: WaterSceneConfig): void;
    step(): void;
    onQualityChanged(_quality: QualityLevel, _config: QualityLevelConfig): void;
    /**
     * Capture the active provider's animated sun state, if any. A reference
     * swap isn't viable here — the water fragment shader and sun shafts have
     * already captured {@link _sun}'s uniform nodes into their built shader
     * graphs, so rebinding to a different node would force a full graph
     * rebuild on every provider swap. Instead {@link _syncProviderSun} copies
     * values into the existing nodes every step, the same pattern already
     * used for `gpuTime` / `animationSpeed`.
     */
    onSkyChanged(sky: SkyProvider | null): void;
    dispose(): void;
    /**
     * Copy the active provider's animated sun values into {@link _sun}'s
     * uniform nodes. No-op when no provider is bound or the bound provider has
     * no `getSun` (the built-in `Sky`) — water-pro's own sun params stay
     * authoritative in that case.
     */
    private _syncProviderSun;
    private _syncSunLight;
    private static _createSunLight;
}
//# sourceMappingURL=Lighting.d.ts.map