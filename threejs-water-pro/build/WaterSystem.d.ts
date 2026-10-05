/**
 * WaterSystem - High-level API for the WebGPU water rendering system.
 */
import * as THREE from "three/webgpu";
import { type IWaveSimulation, type IWaveSampler } from "./simulation/waves";
import { type ClipmapConfig } from "./components/surface/WaterSurfaceGeometry";
import { BuoyancySystem } from "./systems/buoyancy";
import { WakeSystem } from "./systems/wake";
import { WaterMasking } from "./systems/WaterMasking";
import { Underwater, AtmosphericFog } from "./rendering/postprocessing";
import { UnderwaterParticles } from "./systems/underwater";
import { RainSystem } from "./systems/rain";
import { SpraySystem } from "./systems/spray";
import type { SkyProvider } from "./components/sky/SkyProvider";
import { OceanFloor, type OceanFloorOptions } from "./components/floor/OceanFloor";
import { type PresetName } from "./config/presets";
import { type QualityLevel } from "./config/QualityLevels";
import { RenderPassManager } from "./rendering/RenderPassManager";
import type { WaterSceneConfig } from "./config/presets/types";
import { WaveUniforms } from "./uniforms";
import { Lighting } from "./systems/Lighting";
import { Environment } from "./systems/environment";
import { PostProcessingPipeline } from "./systems/PostProcessingPipeline";
import type { WaterSystemConfig } from "./types";
import type { WaterSystemOptions } from "./types/params";
import { WaterColor } from "./shaders/waterColor";
import { Fresnel } from "./shaders/fresnel";
import { Sparkle } from "./shaders/sparkle";
import { SSR } from "./shaders/ssr";
import { SSS } from "./shaders/sss";
import { SurfaceFoam } from "./shaders/foamSurface";
import { ShorelineFoam } from "./shaders/foamShoreline";
import { WaveFoam } from "./shaders/foamWaves";
import { UnderwaterDistortion } from "./shaders/underwaterDistortion";
import { SunShafts } from "./shaders/sunShafts";
import { Waterline } from "./shaders/waterline";
/** A complete water preset accepted by runtime APIs. */
export type WaterPreset = WaterSceneConfig;
/** Explicit configuration name retained for API clarity. */
export type WaterPresetConfig = WaterSceneConfig;
export declare class WaterSystem {
    private renderer;
    private _scene;
    private _camera;
    private oceanSim;
    private waterMaterial;
    private clipmap;
    private oceanFloor;
    private _underwater;
    private atmosphericFogPass;
    private renderPassManager;
    private _lighting;
    private _environment;
    private _underwaterController;
    private _postProcessing;
    private _heightQueryPos;
    private _waveUniforms;
    private _underwaterDistortion;
    private _sunShafts;
    private _fresnel;
    private _shorelineFoam;
    private _sparkle;
    private _ssr;
    private _sss;
    private _surfaceFoam;
    private _waterColor;
    private _waterline;
    private _waveFoam;
    private _rainSystem;
    private _spray;
    private _foamAccumulation;
    private _disposed;
    /**
     * Authoritative integer tick number. In deterministic mode this is the
     * single source of truth for simulation time — every consumer derives its
     * time value from `_tick * _stepSize`. Two clients on the same tick are
     * by definition at the same simulation frame.
     */
    private _tick;
    /**
     * Non-deterministic-mode time accumulator. Only used when
     * `_deterministic` is `false`; in deterministic mode the source of truth
     * is `_tick` and this field stays at zero.
     */
    private _timeAccumulator;
    /** Phillips spectrum seed; clients with the same seed see the same waves. */
    private _seed;
    /** When `true`, `update()` runs the fixed-step accumulator loop. */
    private _deterministic;
    /** Fixed simulation substep in seconds (only used when `_deterministic`). */
    private _stepSize;
    /** Leftover host-time below one fixed substep, drained next frame. */
    private _accumulator;
    private _cameraTracking;
    private _manualPosition;
    private _cameraForward;
    /**
     * Registry of subsystems iterated by `_step` (`step` hook),
     * `_fireCascadeChanged` (`onCascadeChanged` hook), `_rebindDepthTextures`
     * (`bindDepthTextures` hook), `resize` (`resize` hook), and `dispose`
     * (`dispose` hook). Subsystems implement the {@link WaterSubsystem}
     * contract — every hook is optional, so individual subsystems opt in
     * to the iterations they care about. The registry is append-only:
     * registration order is iteration order, and there is no removal hook
     * outside `dispose`.
     *
     * See the "Subsystem Boundaries" section of `AGENTS.md` for the rule.
     */
    private _subsystems;
    readonly buoyancy: BuoyancySystem;
    readonly masking: WaterMasking;
    private _wake;
    private _sampler;
    private _config;
    /**
     * Wake system: the generator registry and the dispersive iWave displacement
     * field that boats and buoys stamp into.
     */
    get wake(): WakeSystem;
    /** Wave height/normal sampler. */
    get sampler(): IWaveSampler;
    /** Quality and cascade configuration. */
    get config(): Readonly<WaterSystemConfig>;
    /**
     * Phillips spectrum seed. Two clients with the same seed (and the same
     * parameters) render the same waves. Sampled heights are not bit-exact
     * across GPU vendors — see `docs/guide/multiplayer.md` for the recommended
     * pattern of networking gameplay object state directly.
     */
    get seed(): number;
    /**
     * Whether the simulation runs in fixed-step mode. When `false`, one
     * simulation substep runs per `update()` call using the host's `deltaTime`.
     */
    get deterministic(): boolean;
    /**
     * Switch the simulation between fixed-step (deterministic) and host-clock
     * (non-deterministic) time. Absolute simulation time is preserved across
     * the flip — the internal storage form is converted, not reset, so wave
     * phases continue unbroken.
     *
     * Non-deterministic → deterministic snaps to the nearest integer tick;
     * sub-step residue is dropped. If you need an exact authoritative tick
     * across the flip, call {@link syncToTick} afterwards.
     */
    set deterministic(value: boolean);
    /**
     * Fixed simulation substep in seconds. Only used when {@link deterministic}
     * is `true`.
     */
    get stepSize(): number;
    /**
     * Absolute simulation time in seconds since construction. In deterministic
     * mode this is exact (`tick * stepSize`); in non-deterministic mode it is
     * the running sum of per-frame `deltaTime`. To override, use
     * {@link syncToTick} (deterministic mode only).
     */
    get simulationTime(): number;
    /**
     * Authoritative integer tick. Only available in deterministic mode —
     * accessing this in non-deterministic mode throws because there is no
     * fixed substep to count.
     *
     * Two clients constructed with the same `seed`, `stepSize`, and parameters
     * render the same waves whenever their `tick` values agree. Network code
     * should traffic in ticks, not seconds: integer equality is exact, float
     * equality is not. Any integer value is accepted, including ticks derived
     * from POSIX time — see {@link syncToTick}.
     */
    get tick(): number;
    /**
     * Absolute simulation time derived from `_tick` (deterministic) or
     * `_timeAccumulator` (non-deterministic). Source of truth for all
     * downstream "what time is it" reads inside the class. Not exposed
     * directly to GPU shaders — use {@link _gpuTime} for that.
     */
    private get _time();
    /**
     * Folded time value safe to send to any GPU shader. Computed as `_time`
     * modulo {@link WAVE_TIME_PERIOD_SECONDS}, so it always stays in a range
     * where float32 retains sub-millisecond precision. Two clients on the
     * same tick fold to the same value, preserving cross-client agreement.
     *
     * The wave sim quantizes every wave's `omega` to a multiple of
     * `2π / WAVE_TIME_PERIOD_SECONDS`, so the wave field at the wrap
     * boundary is identical to the wave field at `t = 0`; the fold is
     * seamless and invisible.
     */
    private get _gpuTime();
    /** Underwater ambient particles */
    private _particles;
    private constructor();
    /**
     * Build the SharedMaterialUniforms bag from owned shader classes and uniform nodes.
     * Used when creating or recreating the WaterSurfaceMaterial.
     */
    private getSharedMaterialUniforms;
    /**
     * Create and initialize a WaterSystem instance.
     *
     * Uses the "sunset" preset for initial values. Call `loadPreset()` after
     * creation to apply a different preset, or set individual uniforms directly.
     *
     * @param renderer - Initialized WebGPU renderer
     * @param scene - Three.js scene to add water to
     * @param camera - Camera for rendering
     * @param quality - Quality tier (default: "high")
     * @param options - {@link WaterSystemOptions}. `deterministic`, `seed`,
     *   and `stepSize` opt into multiplayer-friendly fixed-step behaviour — see
     *   {@link WaterSystemOptions} for semantics.
     * @returns Promise resolving to the initialized WaterSystem
     */
    static create(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, quality?: QualityLevel, options?: WaterSystemOptions): Promise<WaterSystem>;
    /** The rendering backend being used ('webgpu' or 'webgl') */
    get backend(): "webgpu" | "webgl";
    /**
     * The wave simulation instance.
     * Cast to `WebGLWaveSimulation` or `WebGPUWaveSimulation` based on `backend`
     * to access backend-specific parameters.
     */
    get simulation(): IWaveSimulation;
    /** The camera used for rendering */
    get camera(): THREE.PerspectiveCamera;
    /** Update the camera used for rendering and clipmap tracking */
    set camera(cam: THREE.PerspectiveCamera);
    /** The Three.js scene containing the water */
    get scene(): THREE.Scene;
    /** Whether the water grid follows the camera position. Default: true. */
    get cameraTracking(): boolean;
    set cameraTracking(value: boolean);
    /** Wireframe rendering mode */
    get wireframe(): boolean;
    set wireframe(value: boolean);
    /** Render pass manager for depth, scene color, mask, and water depth passes. */
    get rendering(): RenderPassManager;
    /** Distance from camera to the clip plane. */
    get clipPlaneDistance(): number;
    set clipPlaneDistance(value: number);
    /** Waterline meniscus effect at the clip plane boundary. */
    get waterline(): Waterline;
    /** Wave simulation uniforms (amplitude, windSpeed, choppiness, etc.) */
    get waves(): WaveUniforms;
    /**
     * Whether the camera is below the water surface this frame. Always `false`
     * while underwater effects are disabled. Useful for gating app-level
     * content that only makes sense on one side of the surface (audio, UI,
     * post-fog FX composites).
     */
    get cameraSubmerged(): boolean;
    /** Water color */
    get color(): WaterColor;
    /** Surface fresnel */
    get fresnel(): Fresnel;
    /** Atmospheric fog (post-processing) */
    get fog(): AtmosphericFog;
    /** Rain particles and ripple simulation. */
    get rain(): RainSystem;
    /**
     * Wave-crest spray particles. Returns `null` on the WebGL backend, which
     * does not support the GPU compute pipeline the spray system requires.
     */
    get spray(): SpraySystem | null;
    /** Sun sparkle */
    get sparkle(): Sparkle;
    /** Screen-space reflections */
    get ssr(): SSR;
    /** Subsurface scattering */
    get sss(): SSS;
    /**
     * Lighting subsystem. Access sun uniforms via `water.lighting.sun` and
     * the directional light via `water.lighting.sunLight`. Ambient fill
     * comes from the sky's environment lighting, scaled by
     * `water.environment.intensity`.
     */
    get lighting(): Lighting;
    /**
     * Environment subsystem. Owns `scene.environmentNode` (the active sky
     * provider's prefiltered PMREM, scaled by intensity and brightness, lighting
     * every scene mesh) and the `water.environment.intensity` trim.
     */
    get environment(): Environment;
    /** Foam shader classes (surface, wave crest, shoreline) */
    get foam(): {
        surface: SurfaceFoam;
        waves: WaveFoam;
        shoreline: ShorelineFoam;
    };
    /** Ocean floor component */
    get floor(): OceanFloor;
    /** Sun shafts (god rays) effect */
    get sunShafts(): SunShafts;
    /** Underwater haze effect */
    get underwater(): Underwater;
    /** Underwater UV distortion (refraction warp) */
    get underwaterDistortion(): UnderwaterDistortion;
    /** Underwater ambient particles */
    get particles(): UnderwaterParticles;
    /**
     * Update the water system. Call once per frame from your render loop.
     *
     * When `deterministic` is `true`, the host's `deltaTime` is accumulated and
     * the simulation advances in `stepSize`-sized substeps — two clients at
     * different host frame rates step the simulation identically. Per-frame
     * render passes still run exactly once. When `deterministic` is `false`
     * (the default), one substep runs per call using the host's `deltaTime`.
     *
     * @param deltaTime - Time since last frame in seconds
     */
    update(deltaTime: number): Promise<void>;
    /**
     * Hard-snap the authoritative tick. This is the entire multiplayer sync
     * primitive: call it at join with the host's current tick, and call it
     * again whenever the network reports an authoritative tick. The call is
     * O(1) — it does not run catch-up substeps regardless of how far the
     * target is from the current local tick.
     *
     * Forward and backward snaps are both allowed. The wave field re-evaluates
     * exactly at the new tick (pure function of seed and tick). The foam
     * accumulation buffer holds the state it had before the snap and converges
     * over a second or two. In-flight spray particles finish their lifetimes
     * and new ones spawn at the new tick. Buoyancy smoothing re-converges
     * over a few frames.
     *
     * Any integer is accepted, including very large ones (POSIX-derived ticks
     * on the order of `1e11` work fine). Internally, the value pushed to the
     * GPU is folded modulo a constant (~2 h 17 m at the default `stepSize`)
     * so float32 wave-phase precision stays sub-millisecond regardless of the
     * input magnitude. Wave-component angular frequencies are snapped to
     * multiples of `2π / WAVE_TIME_PERIOD_SECONDS`, so the wave field at the
     * fold boundary matches the wave field at zero exactly — the wrap is
     * seamless. The frequency snap perturbs each component by at most
     * ~0.2% (typically much less); wavelengths are unchanged.
     *
     * Only available in deterministic mode. In non-deterministic mode there
     * is no fixed substep, so ticks are undefined.
     *
     * @param tick - Absolute integer tick. Must be a finite integer.
     */
    syncToTick(tick: number): void;
    /**
     * Advance the simulation by one fixed substep. Runs the integrators that
     * must agree across substeps (FFT, foam accumulation, buoyancy, wake,
     * spray, particles); per-frame render passes are handled in
     * {@link _renderPasses} so they fire exactly once per displayed frame even
     * when the substep loop drains zero or many ticks.
     */
    private _step;
    /**
     * Run once-per-frame render passes that prepare textures sampled by the
     * final render (depth, mask, scene-color, water-depth, sun-shaft). Called
     * after the substep loop drains so these passes fire exactly once per
     * displayed frame regardless of how many simulation substeps executed.
     *
     * The substep loop above yields to the event loop on real GPU awaits,
     * and camera-mutating input handlers (e.g. OrbitControls drag) run
     * inside those gaps. Everything from here through the host's render
     * call must execute in one task, so the camera the captures render from
     * is the camera the final render uses. The awaits below don't break
     * that: every hook body is synchronous, and awaiting an already-resolved
     * promise stays in the current task.
     */
    private _renderPasses;
    /**
     * Render the scene. Call after update() in your render loop.
     */
    render(): void;
    /**
     * Handle window resize. Called automatically if autoResize is enabled.
     *
     * @param width - New width (defaults to window.innerWidth)
     * @param height - New height (defaults to window.innerHeight)
     */
    resize(width?: number, height?: number): void;
    /**
     * Dispose of all resources.
     */
    dispose(): void;
    /**
     * Change the quality level at runtime.
     *
     * Internally disposes and recreates quality-dependent subsystems (wave simulation,
     * material, geometry, wake) while preserving quality-independent state (buoyancy
     * registrations, mask objects, sky).
     *
     * Consumers that use {@link postProcessing} must rebuild their
     * post-processing pipeline after calling this method, as the internal render
     * pass textures are invalidated.
     *
     * @param quality - The new quality level
     * @param params - Current water scene parameters to reapply after rebuild
     */
    setQualityLevel(quality: QualityLevel, params: WaterPreset): Promise<void>;
    /**
     * Change a single cascade's FFT resolution at runtime, independently of
     * the rest of the quality level. Tile sizes re-derive from `maxScale` and
     * every cascade's resolution up to `index` (see `deriveCascadeScale`), so
     * this only reshapes cascades after `index` — the quality level's other
     * settings (segments, effect defaults, etc.) are unchanged. Composes with
     * prior overrides: the base is the currently active `cascades`, not the
     * named quality level's defaults.
     *
     * Uses the same rebuild path as {@link setQualityLevel}, so the same
     * post-processing-pipeline rebuild note applies.
     *
     * @param index - Cascade index to override (0..cascadeCount-1).
     * @param resolution - New FFT resolution in texels (must be a power of two).
     * @param params - Current water scene parameters to reapply after rebuild.
     */
    setCascadeResolution(index: number, resolution: number, params: WaterPreset): Promise<void>;
    /**
     * Shared rebuild path for {@link setQualityLevel} and
     * {@link setCascadeResolution}: disposes and recreates every
     * quality-dependent subsystem for the given config, then updates
     * `_config` to match.
     */
    private _rebuildForQuality;
    /**
     * Load a preset, replacing all current parameters.
     *
     * Accepts either a built-in preset name or a custom WaterPreset object.
     * Updates all uniforms and subsystems. Does not affect the sky —
     * if you want the sky to match the preset, update it separately.
     *
     * @param preset - A built-in preset name or a complete WaterPreset object
     */
    loadPreset(preset: PresetName | WaterPreset): void;
    /**
     * Set (or clear) the active sky provider. Mesh lifecycle,
     * `scene.environment`, and all subsystem rebinds are handled internally;
     * the outgoing provider is never disposed.
     */
    setSky(sky: SkyProvider | null): void;
    /**
     * Resize the cascade set from a single largest tile size (meters). Finer
     * cascades and their band edges derive automatically.
     */
    setMaxScale(maxScale: number): void;
    /**
     * Manually set the water grid center position.
     * Only effective when {@link cameraTracking} is disabled.
     *
     * @param x - World X coordinate
     * @param z - World Z coordinate
     */
    setPosition(x: number, z: number): void;
    /**
     * Rebuild the clipmap geometry with new LOD levels or base size.
     * Mesh resolution (segments) is owned by the active quality level — change
     * it via {@link setQualityLevel} or by editing the `QUALITY_LEVELS` entry,
     * not here.
     */
    rebuildGeometry(config: Partial<Omit<ClipmapConfig, "segments" | "infinityRingExtent">>): void;
    /**
     * Get the current clipmap configuration.
     */
    getGeometryConfig(): Readonly<ClipmapConfig>;
    /**
     * Recreate the ocean floor with new options.
     * Use this to change mesh resolution, texture mode, or other options that
     * require recreating the geometry/material.
     */
    recreateOceanFloor(options: Partial<OceanFloorOptions>): Promise<void>;
    /**
     * Query the water height at a world position.
     * Uses the buoyancy system's sampler — dispatches a GPU compute and readback.
     *
     * @param x - World X coordinate
     * @param z - World Z coordinate
     * @returns Promise resolving to the water height (Y displacement) at the position
     */
    getHeightAt(x: number, z: number): Promise<number>;
    /**
     * Post-processing pipeline subsystem. Owns the node-graph composition
     * (`buildNode(scenePass, inputColor)`) and the per-frame conditional
     * pass gating.
     *
     * @example
     * ```typescript
     * const scenePass = pass(scene, camera);
     * let outputNode = scenePass.getTextureNode('output');
     *
     * outputNode = water.postProcessing.buildNode(scenePass, outputNode);
     * outputNode = bloom(outputNode);
     *
     * postProcessing.outputNode = outputNode;
     * ```
     */
    get postProcessing(): PostProcessingPipeline;
    /**
     * Fan out the current render-pass depth textures to every registered
     * subsystem that caches them. Called once at construction, once after
     * every `resize`, and once after every `setQualityLevel` — the render
     * targets backing these textures change identity in both cases, so
     * cached `TextureNode` values must be re-pointed.
     */
    private _rebindDepthTextures;
    /**
     * Apply all parameters from a preset.
     */
    private applyParams;
    /**
     * Clamp effect enabled states to the quality level's capabilities. A quality
     * feature flag can only force an effect off — keeping heavy effects like SSR
     * disabled on low-end tiers — and never forces one on. Called after
     * applyParams, so a preset's or user's "off" choice survives a quality switch
     * instead of being re-enabled by the new level's defaults.
     */
    private clampFeaturesToQuality;
    /**
     * Sync distance-based fadeEnd values.
     * Fresnel fades at the outermost LOD's edge. Fog fadeEnd is preset-driven
     * and user-tunable via `water.fog.fadeEnd`, not auto-synced.
     */
    private syncFadeEndToWaterExtent;
    /**
     * Move the clipmap to follow the camera. The clipmap's snapped-position
     * listeners (registered in `_wireClipmapFollowers`) propagate the new
     * position to the water material's offset uniform and the ocean floor
     * mesh — no explicit fan-out here.
     */
    private updateClipmapPosition;
    /**
     * Register every consumer that needs to follow the clipmap's snapped
     * position. Called after construction and after every clipmap rebuild
     * (the new clipmap starts with an empty listener list).
     */
    private _wireClipmapFollowers;
    private updateAllCascadeConfigs;
    /**
     * Fan out a "wave-sim cascade configuration changed" notification.
     * Fired after the sim is rebuilt (create, setQualityLevel) and after
     * any cascade-config edit reaches the sim. Each subscriber pulls
     * whatever cascade index / resolution / scale / normal texture it
     * needs — the event carries no payload.
     *
     * Subsystems that are rebuilt across the lifecycle (oceanFloor,
     * waterMaterial, buoyancy) are called by name because they are not in
     * the registry. Registered subsystems get the same notification
     * through `onCascadeChanged?` so any future registrant participates
     * automatically.
     */
    private _fireCascadeChanged;
}
//# sourceMappingURL=WaterSystem.d.ts.map