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
export declare class Lighting implements WaterSubsystem {
    private readonly _scene;
    private readonly _sun;
    private readonly _sunLight;
    private readonly _hemisphereLight;
    private readonly _ambient;
    private readonly _sunSyncListeners;
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
     * Read-only handle to the `THREE.HemisphereLight` that fills shaded
     * sides of the scene. Colour and intensity are driven by
     * `params.lighting.ambient` on each `applyParams` / `step`; do not
     * reassign or replace the light itself.
     */
    get hemisphereLight(): THREE.HemisphereLight;
    /**
     * Mutable ambient tint values. UI controls can write here to live-tweak;
     * `step()` reads from this on every frame.
     */
    get ambient(): {
        skyColor: THREE.Color;
        groundColor: THREE.Color;
        intensity: number;
    };
    /**
     * Register a callback that fires once per `step()` after the sun light
     * is synced. Used by consumers that need to react to `castShadow` /
     * shadow-map allocation flips (e.g. screen-space caustics rebinding
     * the shadow depth texture once Three.js allocates it).
     */
    addSunSyncListener(fn: SunSyncListener): void;
    applyParams(params: WaterSceneParams): void;
    step(): void;
    onQualityChanged(_quality: QualityLevel, _config: QualityLevelConfig): void;
    dispose(): void;
    private _syncSunLight;
    private _syncAmbientLight;
    private static _createSunLight;
    private static _createHemisphereLight;
}
//# sourceMappingURL=Lighting.d.ts.map