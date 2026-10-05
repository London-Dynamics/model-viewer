// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * WaterSystem - High-level API for the WebGPU water rendering system.
 */

import * as THREE from "three/webgpu";
import {
  createWaveSimulation,
  createWaveSampler,
  type IWaveSimulation,
  type IWaveSampler,
  WAVE_TIME_PERIOD_SECONDS,
} from "./simulation/waves";
import { WaterSurfaceMaterial } from "./components/surface/WaterSurfaceMaterial";
import {
  WaterSurfaceGeometry,
  type ClipmapConfig,
} from "./components/surface/WaterSurfaceGeometry";
import { BuoyancySystem } from "./systems/buoyancy";
import { WakeSystem } from "./systems/wake";
import { WaterMasking } from "./systems/WaterMasking";
import { Underwater, AtmosphericFog } from "./rendering/postprocessing";
import { UnderwaterParticles } from "./systems/underwater";
import { RainSystem } from "./systems/rain";
import { SpraySystem } from "./systems/spray";
import { createFoamAccumulation } from "./simulation/foam";
import type { FoamAccumulation } from "./simulation/foam";
import type { SkyProvider } from "./components/sky/SkyProvider";
import {
  OceanFloor,
  type OceanFloorOptions,
} from "./components/floor/OceanFloor";
import {
  getPresetParams,
  normalizeWaterSceneConfig,
  type PresetName,
} from "./config/presets";
import {
  QUALITY_LEVELS,
  type QualityLevel,
  type QualityLevelConfig,
} from "./config/QualityLevels";
import { RenderPassManager } from "./rendering/RenderPassManager";
import type { WaterSceneConfig } from "./config/presets/types";
import { WaveUniforms } from "./uniforms";
import { Lighting } from "./systems/Lighting";
import { Environment } from "./systems/environment";
import { UnderwaterStateController } from "./systems/UnderwaterStateController";
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
import type { WaterSubsystem } from "./systems/types";

/** A complete water preset accepted by runtime APIs. */
export type WaterPreset = WaterSceneConfig;

/** Explicit configuration name retained for API clarity. */
export type WaterPresetConfig = WaterSceneConfig;

/**
 * `Scene.fogNode` is a node-renderer feature (r171+, `three/src/renderers/
 * common/nodes/Nodes.js`) that `@types/three` does not declare yet.
 */
interface SceneWithFogNode extends THREE.Scene {
  fogNode: THREE.Node | null;
}

/** Default seed for the Phillips spectrum. */
const DEFAULT_SEED = 1;
/** Default fixed simulation substep in seconds (60 Hz) when `deterministic` is enabled. */
const DEFAULT_STEP_SIZE = 1 / 60;
/**
 * Maximum substeps drained per `update()` call. Caps the worst-case work when
 * a host stalls and the accumulator gets large, so we don't spiral into a
 * frozen frame trying to catch up.
 */
const MAX_CATCHUP_STEPS = 8;

export class WaterSystem {
  // ============================================
  // Private Fields
  // ============================================

  private renderer: THREE.WebGPURenderer;
  private _scene: THREE.Scene;
  private _camera: THREE.PerspectiveCamera;

  private oceanSim: IWaveSimulation;
  private waterMaterial!: WaterSurfaceMaterial;
  private clipmap!: WaterSurfaceGeometry;

  private oceanFloor: OceanFloor;
  private _underwater: Underwater;
  private atmosphericFogPass: AtmosphericFog;

  private renderPassManager!: RenderPassManager;
  private _lighting!: Lighting;
  private _environment!: Environment;
  private _underwaterController!: UnderwaterStateController;
  private _postProcessing!: PostProcessingPipeline;

  private _heightQueryPos = new THREE.Vector3();
  private _waveUniforms: WaveUniforms;
  private _underwaterDistortion!: UnderwaterDistortion;
  private _sunShafts: SunShafts;

  // Shader class instances — owned here, injected into material via SharedMaterialUniforms.
  // Stable across quality level changes so external references (e.g., UI bindings) remain valid.
  private _fresnel = new Fresnel();
  private _shorelineFoam = new ShorelineFoam();
  private _sparkle = new Sparkle();
  private _ssr = new SSR();
  private _sss = new SSS();
  private _surfaceFoam = new SurfaceFoam();
  private _waterColor = new WaterColor();
  private _waterline = new Waterline();
  private _waveFoam: WaveFoam;

  private _rainSystem!: RainSystem;
  private _spray: SpraySystem | null = null;
  private _foamAccumulation: FoamAccumulation | null = null;
  private _disposed = false;
  /**
   * Authoritative integer tick number. In deterministic mode this is the
   * single source of truth for simulation time — every consumer derives its
   * time value from `_tick * _stepSize`. Two clients on the same tick are
   * by definition at the same simulation frame.
   */
  private _tick = 0;
  /**
   * Non-deterministic-mode time accumulator. Only used when
   * `_deterministic` is `false`; in deterministic mode the source of truth
   * is `_tick` and this field stays at zero.
   */
  private _timeAccumulator = 0;
  /** Phillips spectrum seed; clients with the same seed see the same waves. */
  private _seed: number;
  /** When `true`, `update()` runs the fixed-step accumulator loop. */
  private _deterministic: boolean;
  /** Fixed simulation substep in seconds (only used when `_deterministic`). */
  private _stepSize: number;
  /** Leftover host-time below one fixed substep, drained next frame. */
  private _accumulator = 0;

  private _cameraTracking = true;
  private _manualPosition = new THREE.Vector3();
  private _cameraForward = new THREE.Vector3();

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
  private _subsystems: WaterSubsystem[] = [];
  // ============================================
  // Public Readonly Fields
  // ============================================

  readonly buoyancy: BuoyancySystem;
  readonly masking = new WaterMasking();
  private _wake: WakeSystem;
  private _sampler: IWaveSampler;
  private _config: Readonly<WaterSystemConfig>;

  /**
   * Wake system: the generator registry and the dispersive iWave displacement
   * field that boats and buoys stamp into.
   */
  get wake(): WakeSystem {
    return this._wake;
  }

  /** Wave height/normal sampler. */
  get sampler(): IWaveSampler {
    return this._sampler;
  }

  /** Quality and cascade configuration. */
  get config(): Readonly<WaterSystemConfig> {
    return this._config;
  }

  /**
   * Phillips spectrum seed. Two clients with the same seed (and the same
   * parameters) render the same waves. Sampled heights are not bit-exact
   * across GPU vendors — see `docs/guide/multiplayer.md` for the recommended
   * pattern of networking gameplay object state directly.
   */
  get seed(): number {
    return this._seed;
  }

  /**
   * Whether the simulation runs in fixed-step mode. When `false`, one
   * simulation substep runs per `update()` call using the host's `deltaTime`.
   */
  get deterministic(): boolean {
    return this._deterministic;
  }

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
  set deterministic(value: boolean) {
    if (value === this._deterministic) return;
    if (value) {
      this._tick = Math.round(this._timeAccumulator / this._stepSize);
      this._timeAccumulator = 0;
    } else {
      this._timeAccumulator = this._tick * this._stepSize;
    }
    this._accumulator = 0;
    this._deterministic = value;
  }

  /**
   * Fixed simulation substep in seconds. Only used when {@link deterministic}
   * is `true`.
   */
  get stepSize(): number {
    return this._stepSize;
  }

  /**
   * Absolute simulation time in seconds since construction. In deterministic
   * mode this is exact (`tick * stepSize`); in non-deterministic mode it is
   * the running sum of per-frame `deltaTime`. To override, use
   * {@link syncToTick} (deterministic mode only).
   */
  get simulationTime(): number {
    return this._time;
  }

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
  get tick(): number {
    if (!this._deterministic) {
      throw new Error(
        "WaterSystem.tick is only defined in deterministic mode. " +
          "Construct with `{ deterministic: true }` if you need tick-based time.",
      );
    }
    return this._tick;
  }

  /**
   * Absolute simulation time derived from `_tick` (deterministic) or
   * `_timeAccumulator` (non-deterministic). Source of truth for all
   * downstream "what time is it" reads inside the class. Not exposed
   * directly to GPU shaders — use {@link _gpuTime} for that.
   */
  private get _time(): number {
    return this._deterministic
      ? this._tick * this._stepSize
      : this._timeAccumulator;
  }

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
  private get _gpuTime(): number {
    const t = this._time % WAVE_TIME_PERIOD_SECONDS;
    return t < 0 ? t + WAVE_TIME_PERIOD_SECONDS : t;
  }

  // ============================================
  // Constructor
  // ============================================

  /** Underwater ambient particles */
  private _particles!: UnderwaterParticles;

  private constructor(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    oceanSim: IWaveSimulation,
    buoyancy: BuoyancySystem,
    wake: WakeSystem,
    sampler: IWaveSampler,
    lighting: Lighting,
    oceanFloor: OceanFloor,
    underwater: Underwater,
    atmosphericFogPass: AtmosphericFog,
    quality: QualityLevel,
    waveUniforms: WaveUniforms,
    waveFoam: WaveFoam,
    seed: number,
    deterministic: boolean,
    stepSize: number,
  ) {
    this.renderer = renderer;
    this._scene = scene;
    this._camera = camera;
    this.oceanSim = oceanSim;
    this.buoyancy = buoyancy;
    this._wake = wake;
    this._sampler = sampler;
    this._lighting = lighting;
    this.oceanFloor = oceanFloor;
    this._underwater = underwater;
    this.atmosphericFogPass = atmosphericFogPass;
    this._waveUniforms = waveUniforms;
    this._waveFoam = waveFoam;
    this._seed = seed;
    this._deterministic = deterministic;
    this._stepSize = stepSize;

    this._sunShafts = new SunShafts();
    this._underwaterDistortion = new UnderwaterDistortion(
      this._underwater.timeUniform,
    );

    this._config = Object.freeze({
      quality,
      cascades: QUALITY_LEVELS[quality].cascades.map((c) => ({ ...c })),
    });
  }

  /**
   * Build the SharedMaterialUniforms bag from owned shader classes and uniform nodes.
   * Used when creating or recreating the WaterSurfaceMaterial.
   */
  private getSharedMaterialUniforms(): import("./components/surface/WaterSurfaceMaterial").SharedMaterialUniforms {
    return {
      maskEnabled: this.masking.enabledNode,
      sunDirection: this._lighting.sun.direction,
      sunIntensity: this._lighting.sun.intensity,
      windDirection: this._waveUniforms.windDirection,
      foamFieldSampler: this._foamAccumulation?.getSampler() ?? null,
      fresnel: this._fresnel,
      rainRipples: this._rainSystem.ripples,
      shorelineFoam: this._shorelineFoam,
      sparkle: this._sparkle,
      ssr: this._ssr,
      sss: this._sss,
      surfaceFoam: this._surfaceFoam,
      waterColor: this._waterColor,
      waterline: this._waterline,
      waveFoam: this._waveFoam,
      wakeFieldSampler: this._wake.getSampler(),
    };
  }

  // ============================================
  // Static Factory
  // ============================================

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
  static async create(
    renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    quality: QualityLevel = "high",
    options: WaterSystemOptions = {},
  ): Promise<WaterSystem> {
    const params = getPresetParams("sunset");
    const qualityConfig = QUALITY_LEVELS[quality];
    const seed = options.seed ?? DEFAULT_SEED;
    const deterministic = options.deterministic ?? false;
    const stepSize = options.stepSize ?? DEFAULT_STEP_SIZE;

    // Construct Lighting before everything else that consumes sun nodes
    // (water material, sun shafts, screen-space caustics). The sky
    const lighting = new Lighting(scene);
    lighting.applyParams(params);

    // Create shared uniform instances early — they're the single source of
    // truth and must exist before the simulation and material bind to their nodes.
    const waveUniforms = new WaveUniforms();
    waveUniforms.update(params.waves.fft);

    // Create WaveFoam early — it's shared between simulation (for windBias
    // node in Jacobian compute) and the material (for rendering).
    const waveFoam = new WaveFoam();
    waveFoam.update(params.foam.waves);

    const oceanSim = createWaveSimulation(renderer, {
      cascades: params.waves.fft.cascades,
      foamWindBias: waveFoam._windBiasNode,
      qualityConfig,
      seed,
      waveUniforms,
    });
    oceanSim.init();
    await oceanSim.initializeBuffers(renderer);

    const clipmapTotalSize =
      params.clipmap.baseSize * Math.pow(2, params.clipmap.levels - 1);

    const oceanFloor = await OceanFloor.create({
      size: clipmapTotalSize,
      windDirection: waveUniforms.windDirection,
      ...params.oceanFloor,
    });

    scene.add(oceanFloor.getMesh());

    const waveSampler = createWaveSampler(oceanSim, renderer);
    const buoyancy = new BuoyancySystem(waveSampler);

    const isWebGL = oceanSim.getCapabilities().backend === "webgl";

    // Dispersive iWave wake field. Enablement, resolution, and extent are
    // quality-scaled (see QualityLevels); the wake re-applies them on a quality
    // switch via its `onQualityChanged` hook. The wake binds the shared gravity
    // uniform so its dispersion tracks the ocean. All values stay runtime-
    // tunable from the demo UI.
    const wakeSystem = new WakeSystem(
      renderer,
      isWebGL,
      qualityConfig.wakeResolution,
      qualityConfig.wakeWorldSize,
      waveUniforms.gravity,
      camera,
    );
    wakeSystem.enabled = qualityConfig.wakeEnabled;

    const underwater = new Underwater();
    const atmosphericFogPass = new AtmosphericFog();

    // Atmospheric fog is forward (per-material): the renderer applies this
    // node inside every material with the default `fog: true`, after shading
    // and before blending, so fog composes correctly through any transparency.
    if (scene.fog !== null) {
      console.warn(
        "[WaterSystem] scene.fog is set; the water system's atmospheric fog " +
          "(scene.fogNode) takes precedence over it.",
      );
    }
    (scene as SceneWithFogNode).fogNode =
      atmosphericFogPass.createSceneFogNode();

    // Construct WaterSystem first — shader class field initializers run here,
    // providing stable instances that survive quality level changes.
    const waterSystem = new WaterSystem(
      renderer,
      scene,
      camera,
      oceanSim,
      buoyancy,
      wakeSystem,
      waveSampler,
      lighting,
      oceanFloor,
      underwater,
      atmosphericFogPass,
      quality,
      waveUniforms,
      waveFoam,
      seed,
      deterministic,
      stepSize,
    );
    // Share the physical/custom color model between surface and underwater.
    underwater.bindWaterColor(waterSystem._waterColor);
    waterSystem._subsystems.push(lighting);

    // Owns scene.environment and the active sky provider's backdrop meshes;
    // registered before any setSky call so its onSkyChanged hook is reached.
    waterSystem._environment = new Environment(scene);
    // A provider may rebuild its environment texture mid-session (quality
    // tier resize); rerun the full setSky rebind so every compiled sampler
    // recaptures the new texture instead of sampling the destroyed one.
    waterSystem._environment.onEnvironmentTextureChanged = () => {
      waterSystem.setSky(waterSystem.renderPassManager.getCurrentSky());
    };
    waterSystem._subsystems.push(waterSystem._environment);

    // Wake steps via the registry (after buoyancy, which the registry loop
    // follows) and disposes via the registry — no bespoke handling in _step.
    waterSystem._subsystems.push(wakeSystem);

    waterSystem._rainSystem = new RainSystem(waveUniforms, camera);

    // Persistent wave-crest foam accumulator (the only wave-crest foam path).
    // A registered subsystem that steps and rebinds to a new wave sim itself; its
    // persistence tuning and enable come from WaveFoam's shared nodes. Must exist
    // before the material so its sampler is exposed through SharedMaterialUniforms
    // at material-build time.
    waterSystem._foamAccumulation = createFoamAccumulation(
      renderer,
      oceanSim,
      waveUniforms,
      {
        persistence: waveFoam.persistence,
        enabledNode: waveFoam._enabledNode,
        resolution: qualityConfig.foamFieldResolution,
        worldSize: qualityConfig.foamFieldWorldSize,
      },
    );
    if (waterSystem._foamAccumulation) {
      waterSystem._foamAccumulation.setCamera(camera);
      waterSystem._subsystems.push(waterSystem._foamAccumulation);
    }

    // Create material using stable shader classes from the WaterSystem instance
    const waterMaterial = new WaterSurfaceMaterial(
      oceanSim,
      waterSystem.getSharedMaterialUniforms(),
      undefined,
      quality,
    );
    waterMaterial.ssr.maxDistance = qualityConfig.ssrMaxDistance;
    waterMaterial.ssr.stepCount = qualityConfig.ssrStepCount;
    waterSystem.waterMaterial = waterMaterial;
    // The wake/foam samplers are bound at material-build time via
    // SharedMaterialUniforms, so they survive quality rebuilds automatically.
    // Only a runtime field rebuild (resolution change) needs an explicit re-bind,
    // onto whichever material is current — not the one captured here.
    wakeSystem.onSamplerRebuild((sampler) =>
      waterSystem.waterMaterial.setWakeFieldSampler(sampler),
    );
    waterSystem._foamAccumulation?.onSamplerRebuild((sampler) =>
      waterSystem.waterMaterial.setFoamFieldSampler(sampler),
    );

    // Wave-crest spray (WebGPU only). Pool size comes from the quality
    // config; tryCreate returns null on backends that can't support the
    // GPU compute pipeline.
    waterSystem._spray = SpraySystem.tryCreate(
      renderer,
      oceanSim,
      waterMaterial,
      qualityConfig.sprayMaxParticles,
      waterSystem.masking.enabledNode,
    );
    if (waterSystem._spray) {
      waterSystem._spray.enabled = qualityConfig.sprayEnabledByDefault;
      scene.add(waterSystem._spray.getMesh());
    }

    const clipmap = new WaterSurfaceGeometry(
      {
        levels: params.clipmap.levels,
        segments: QUALITY_LEVELS[quality].segments,
        baseSize: params.clipmap.baseSize,
        // The flat infinity ring is part of the clipmap, sized to stay inside
        // the camera frustum. Exceeding camera.far breaks effects that read
        // the water depth buffer via the far-plane clip.
        infinityRingExtent: camera.far * 0.95,
      },
      waterMaterial,
    );
    scene.add(clipmap.getObject());
    waterSystem.clipmap = clipmap;
    waterSystem._wireClipmapFollowers();

    const particles = new UnderwaterParticles(
      params.postProcessing.underwaterParticles,
      {
        clipDistance: waterMaterial.clipPlaneDistanceUniform,
        cameraForward: waterMaterial.cameraForwardUniform,
      },
    );
    scene.add(particles.getMesh());
    waterSystem._particles = particles;

    const renderPassManager = new RenderPassManager(renderer, scene, camera, {
      clipmap,
      waterMaterial,
      spray: waterSystem._spray,
      underwater,
      atmosphericFog: atmosphericFogPass,
      isWebGL,
    });
    waterSystem.renderPassManager = renderPassManager;
    // Subsystems that hold cached `TextureNode` references to render-pass
    // depth targets. Registered here in one place; `_rebindDepthTextures`
    // re-fires on every resize and quality switch.
    waterSystem._subsystems.push(
      waterSystem._sunShafts,
      waterSystem._underwaterDistortion,
      waterSystem._rainSystem,
      waterSystem._particles,
    );
    waterSystem._rebindDepthTextures();

    waterSystem._underwaterController = new UnderwaterStateController(camera, {
      buoyancy,
      underwater,
      particles,
      material: waterMaterial,
      waterline: waterSystem._waterline,
      oceanFloor,
    });
    waterSystem._subsystems.push(waterSystem._underwaterController);

    waterSystem._sunShafts.attachRuntimeRefs({
      camera,
      lighting,
      fresnel: waterSystem._fresnel,
      underwaterController: waterSystem._underwaterController,
    });
    const size = new THREE.Vector2();
    renderer.getDrawingBufferSize(size);
    waterSystem._sunShafts.attachPass(
      size.x,
      size.y,
      qualityConfig.sunShaftResolutionScale,
    );

    waterSystem._postProcessing = new PostProcessingPipeline({
      rainSystem: waterSystem._rainSystem,
      rpm: renderPassManager,
      ssr: waterSystem._ssr,
      sunShafts: waterSystem._sunShafts,
      underwater,
      underwaterDistortion: waterSystem._underwaterDistortion,
    });
    waterSystem._subsystems.push(waterSystem._postProcessing);

    waterSystem.masking.bind(renderPassManager);

    waterSystem.applyParams(params);
    waterSystem.clampFeaturesToQuality(qualityConfig.features);
    waterSystem.syncFadeEndToWaterExtent();

    camera.updateMatrixWorld(true);
    oceanSim.update(0);
    clipmap.update(camera.position);
    renderPassManager.renderCapturePass(renderer);

    return waterSystem;
  }

  // ============================================
  // Public Getters/Setters — System & Config
  // ============================================

  /** The rendering backend being used ('webgpu' or 'webgl') */
  get backend(): "webgpu" | "webgl" {
    return this.oceanSim.getCapabilities().backend;
  }

  /**
   * The wave simulation instance.
   * Cast to `WebGLWaveSimulation` or `WebGPUWaveSimulation` based on `backend`
   * to access backend-specific parameters.
   */
  get simulation(): IWaveSimulation {
    return this.oceanSim;
  }

  /** The camera used for rendering */
  get camera(): THREE.PerspectiveCamera {
    return this._camera;
  }

  /** Update the camera used for rendering and clipmap tracking */
  set camera(cam: THREE.PerspectiveCamera) {
    this._camera = cam;
    this.renderPassManager.setCamera(cam);
    this._underwaterController.setCamera(cam);
    this._rainSystem.setCamera(cam);
    this._sunShafts.setCamera(cam);
    this._wake.setCamera(cam);
    this._foamAccumulation?.setCamera(cam);
  }

  /** The Three.js scene containing the water */
  get scene(): THREE.Scene {
    return this._scene;
  }

  /** Whether the water grid follows the camera position. Default: true. */
  get cameraTracking(): boolean {
    return this._cameraTracking;
  }

  set cameraTracking(value: boolean) {
    this._cameraTracking = value;
  }

  /** Wireframe rendering mode */
  get wireframe(): boolean {
    return this.waterMaterial.wireframe;
  }

  set wireframe(value: boolean) {
    this.waterMaterial.wireframe = value;
  }

  /** Render pass manager for depth, scene color, mask, and water depth passes. */
  get rendering(): RenderPassManager {
    return this.renderPassManager;
  }

  // ============================================
  // Public Getters/Setters — Clip Plane
  // ============================================

  /** Distance from camera to the clip plane. */
  get clipPlaneDistance(): number {
    return this.waterMaterial.clipPlaneDistance;
  }

  set clipPlaneDistance(value: number) {
    this.waterMaterial.clipPlaneDistance = value;
  }

  /** Waterline meniscus effect at the clip plane boundary. */
  get waterline(): Waterline {
    return this._waterline;
  }

  // ============================================
  // Public Getters/Setters — Waves
  // ============================================

  /** Wave simulation uniforms (amplitude, windSpeed, choppiness, etc.) */
  get waves(): WaveUniforms {
    return this._waveUniforms;
  }

  // ============================================
  // Public Getters/Setters — Appearance
  // ============================================

  /**
   * Whether the camera is below the water surface this frame. Always `false`
   * while underwater effects are disabled. Useful for gating app-level
   * content that only makes sense on one side of the surface (audio, UI,
   * post-fog FX composites).
   */
  get cameraSubmerged(): boolean {
    return this._underwaterController.cameraSubmerged;
  }

  /** Water color */
  get color(): WaterColor {
    return this._waterColor;
  }

  /** Surface fresnel */
  get fresnel(): Fresnel {
    return this._fresnel;
  }

  /** Atmospheric fog (post-processing) */
  get fog(): AtmosphericFog {
    return this.atmosphericFogPass;
  }

  /** Rain particles and ripple simulation. */
  get rain(): RainSystem {
    return this._rainSystem;
  }

  /**
   * Wave-crest spray particles. Returns `null` on the WebGL backend, which
   * does not support the GPU compute pipeline the spray system requires.
   */
  get spray(): SpraySystem | null {
    return this._spray;
  }

  /** Sun sparkle */
  get sparkle(): Sparkle {
    return this._sparkle;
  }

  /** Screen-space reflections */
  get ssr(): SSR {
    return this._ssr;
  }

  /** Subsurface scattering */
  get sss(): SSS {
    return this._sss;
  }

  /**
   * Lighting subsystem. Access sun uniforms via `water.lighting.sun` and
   * the directional light via `water.lighting.sunLight`. Ambient fill
   * comes from the sky's environment lighting, scaled by
   * `water.environment.intensity`.
   */
  get lighting(): Lighting {
    return this._lighting;
  }

  /**
   * Environment subsystem. Owns `scene.environmentNode` (the active sky
   * provider's prefiltered PMREM, scaled by intensity and brightness, lighting
   * every scene mesh) and the `water.environment.intensity` trim.
   */
  get environment(): Environment {
    return this._environment;
  }

  // ============================================
  // Public Getters/Setters — Foam
  // ============================================

  /** Foam shader classes (surface, wave crest, shoreline) */
  get foam(): {
    surface: SurfaceFoam;
    waves: WaveFoam;
    shoreline: ShorelineFoam;
  } {
    return {
      surface: this._surfaceFoam,
      waves: this._waveFoam,
      shoreline: this._shorelineFoam,
    };
  }

  // ============================================
  // Public Getters/Setters — Subsystems
  // ============================================

  /** Ocean floor component */
  get floor(): OceanFloor {
    return this.oceanFloor;
  }

  /** Sun shafts (god rays) effect */
  get sunShafts(): SunShafts {
    return this._sunShafts;
  }

  /** Underwater haze effect */
  get underwater(): Underwater {
    return this._underwater;
  }

  /** Underwater UV distortion (refraction warp) */
  get underwaterDistortion(): UnderwaterDistortion {
    return this._underwaterDistortion;
  }

  /** Underwater ambient particles */
  get particles(): UnderwaterParticles {
    return this._particles;
  }

  // ============================================
  // Public Methods — Lifecycle
  // ============================================

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
  async update(deltaTime: number): Promise<void> {
    if (this._disposed) return;

    if (!this._deterministic) {
      this._timeAccumulator += deltaTime;
      await this._step(deltaTime);
    } else {
      this._accumulator += deltaTime;
      let stepsRemaining = MAX_CATCHUP_STEPS;
      while (this._accumulator >= this._stepSize && stepsRemaining > 0) {
        this._tick++;
        await this._step(this._stepSize);
        this._accumulator -= this._stepSize;
        stepsRemaining--;
      }
      // Discard any accumulator residue if the host can't keep up. This
      // prevents the simulation from spiral-of-death-ing on a slow host.
      if (stepsRemaining === 0) this._accumulator = 0;
    }
    await this._renderPasses();
  }

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
  syncToTick(tick: number): void {
    if (!this._deterministic) {
      throw new Error(
        "WaterSystem.syncToTick is only available in deterministic mode. " +
          "Construct with `{ deterministic: true }` to use tick-based sync.",
      );
    }
    if (!Number.isFinite(tick) || !Number.isInteger(tick)) {
      throw new Error(
        `WaterSystem.syncToTick: tick must be a finite integer (got ${tick}).`,
      );
    }
    this._tick = tick;
    // Push the (animationSpeed-scaled) wave-phase time to the ocean sim. The
    // sim's `_explicitTimeThisFrame` flag bypasses its own accumulator on the
    // next update, so the snap is exact. `_gpuTime` is folded so arbitrary
    // tick magnitudes (POSIX-derived ticks ~1e11, server-broadcast ticks,
    // etc.) all map into a float32-safe range.
    this.oceanSim.setTime(this._gpuTime * this._waveUniforms.animationSpeed);
    // Drop the accumulator: the caller is asserting a new authoritative time,
    // so any leftover host-time below a substep is no longer meaningful.
    this._accumulator = 0;
  }

  /**
   * Advance the simulation by one fixed substep. Runs the integrators that
   * must agree across substeps (FFT, foam accumulation, buoyancy, wake,
   * spray, particles); per-frame render passes are handled in
   * {@link _renderPasses} so they fire exactly once per displayed frame even
   * when the substep loop drains zero or many ticks.
   */
  private async _step(deltaTime: number): Promise<void> {
    // Compute the folded GPU time once per substep and reuse it for every
    // shader-bound consumer. The wave sim, material, rain, spray, ocean
    // floor, and underwater haze all see the same folded value, so they
    // stay phase-coherent.
    const gpuTime = this._gpuTime;
    this.waterMaterial.timeUniform.value = gpuTime;

    // animationSpeed is a plain number (not a uniform node), so it needs explicit sync
    this.oceanSim.animationSpeed = this._waveUniforms.animationSpeed;
    // Push folded time to the wave sim every step. This both keeps two
    // clients in agreement after a sync and keeps the wave sim's internal
    // time bounded — it cannot drift past the fold across many updates.
    this.oceanSim.setTime(gpuTime * this._waveUniforms.animationSpeed);

    await this.oceanSim.update(deltaTime);

    this.buoyancy.setCameraPosition(
      this._camera.position.x,
      this._camera.position.z,
    );
    await this.buoyancy.update(deltaTime);

    // Spray must run *after* both the wave sim (cascade buffers) and
    // buoyancy (emitter object Y is settled to this frame's water). Sampling
    // probe matrices before buoyancy compares stale probe Y against the
    // current frame's displaced surface, which mis-detects crossings and
    // under-reports the rigid-body velocity used as the firing gate.
    if (this._spray) {
      await this._spray.tick(deltaTime, gpuTime);
    }

    this.oceanFloor.update(gpuTime);

    // Registered subsystems tick in registration order. The
    // underwater-state controller needs `buoyancy.update` to complete
    // first (it reads `getCameraWaterHeight`), which is satisfied
    // because the registry iterates after the buoyancy await above.
    for (const s of this._subsystems) {
      await s.step?.(deltaTime, gpuTime);
    }
  }

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
  private async _renderPasses(): Promise<void> {
    // Camera-coupled per-frame state must be read here, after the last
    // event-loop yield — reading it in `_step` samples a camera the input
    // handlers may still move before the frame renders.
    this._camera.getWorldDirection(this._cameraForward);
    this.waterMaterial.updateCameraForward(this._cameraForward);
    if (this._cameraTracking) {
      this.updateClipmapPosition(this._camera.position);
    }
    this.renderPassManager.getCurrentSky()?.followCamera(this._camera);

    this.renderer.info.reset();
    for (const s of this._subsystems) {
      await s.renderPass?.(this.renderer);
    }
  }

  /**
   * Render the scene. Call after update() in your render loop.
   */
  render(): void {
    this.renderer.render(this._scene, this._camera);
  }

  /**
   * Handle window resize. Called automatically if autoResize is enabled.
   *
   * @param width - New width (defaults to window.innerWidth)
   * @param height - New height (defaults to window.innerHeight)
   */
  resize(width?: number, height?: number): void {
    const w = width ?? window.innerWidth;
    const h = height ?? window.innerHeight;

    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);

    this.renderPassManager.resize();
    this._rebindDepthTextures();

    // Resize hook fans out to any registered subsystem that owns a
    // render target with screen-coupled dimensions (SunShafts owns its
    // intensity pass; everyone else no-ops).
    for (const s of this._subsystems) {
      s.resize?.(w, h);
    }
  }

  /**
   * Dispose of all resources.
   */
  dispose(): void {
    this._disposed = true;

    // Release the scene fog so materials rendered after disposal build clean.
    (this._scene as SceneWithFogNode).fogNode = null;

    // Non-registered subsystems disposed by name (they are recreated
    // across the lifecycle and the registry does not track them).
    this.oceanSim.dispose();
    this.buoyancy.dispose();
    this._scene.remove(this._particles.getMesh());
    this._particles.dispose();
    if (this._spray) {
      this._scene.remove(this._spray.getMesh());
      this._spray.dispose();
    }
    this._sampler.dispose();

    this._scene.remove(this.clipmap.getObject());
    this.clipmap.dispose();

    this.waterMaterial.dispose();
    this._waterColor.dispose();

    this.renderPassManager.dispose();

    this._scene.remove(this.oceanFloor.getMesh());
    this.oceanFloor.dispose();

    // Registered subsystems dispose via the registry — Lighting, RainSystem,
    // PostProcessingPipeline, UnderwaterStateController, etc.
    for (const s of this._subsystems) {
      s.dispose?.();
    }
  }

  // ============================================
  // Public Methods — Quality
  // ============================================

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
  async setQualityLevel(
    quality: QualityLevel,
    params: WaterPreset,
  ): Promise<void> {
    if (quality === this._config.quality) return;
    await this._rebuildForQuality(
      QUALITY_LEVELS[quality],
      quality,
      normalizeWaterSceneConfig(params),
    );
  }

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
  async setCascadeResolution(
    index: number,
    resolution: number,
    params: WaterPreset,
  ): Promise<void> {
    if (this._config.cascades[index]?.resolution === resolution) return;

    const quality = this._config.quality;
    const cascades = this._config.cascades.map((c, i) =>
      i === index ? { ...c, resolution } : { ...c },
    );
    const qualityConfig: QualityLevelConfig = {
      ...QUALITY_LEVELS[quality],
      cascades,
    };

    await this._rebuildForQuality(
      qualityConfig,
      quality,
      normalizeWaterSceneConfig(params),
    );
  }

  /**
   * Shared rebuild path for {@link setQualityLevel} and
   * {@link setCascadeResolution}: disposes and recreates every
   * quality-dependent subsystem for the given config, then updates
   * `_config` to match.
   */
  private async _rebuildForQuality(
    qualityConfig: QualityLevelConfig,
    quality: QualityLevel,
    params: WaterSceneConfig,
  ): Promise<void> {
    // Dispose quality-dependent subsystems (preserve scene children).
    // renderPassManager survives the rebuild — it holds sky, dynamic
    // objects, mask objects, and render targets that are not
    // quality-dependent.
    this.oceanSim.dispose();
    this._sampler.dispose();
    this._scene.remove(this.clipmap.getObject());
    this.clipmap.dispose();
    this.waterMaterial.dispose();

    // Recreate wave simulation
    const oceanSim = createWaveSimulation(this.renderer, {
      cascades: params.waves.fft.cascades,
      foamWindBias: this._waveFoam._windBiasNode,
      qualityConfig,
      seed: this._seed,
      waveUniforms: this._waveUniforms,
    });
    oceanSim.init();
    await oceanSim.initializeBuffers(this.renderer);
    this.oceanSim = oceanSim;

    // The foam accumulator survives the quality switch (it's a registered
    // subsystem); only its injection is bound to the wave sim, so it rebinds to
    // the new one here. Its targets + sampler are sim-independent, so the
    // material below keeps a valid foam sampler. Resolution / world extent are
    // re-applied by its `onQualityChanged` hook in the registry loop.
    this._foamAccumulation?.setOceanSim(oceanSim);

    // Recreate material using stable shader class instances from this WaterSystem
    const waterMaterial = new WaterSurfaceMaterial(
      oceanSim,
      this.getSharedMaterialUniforms(),
      undefined,
      quality,
    );
    waterMaterial.ssr.maxDistance = qualityConfig.ssrMaxDistance;
    waterMaterial.ssr.stepCount = qualityConfig.ssrStepCount;
    this.waterMaterial = waterMaterial;

    // Recreate geometry
    this.clipmap = new WaterSurfaceGeometry(
      {
        levels: params.clipmap.levels,
        segments: qualityConfig.segments,
        baseSize: params.clipmap.baseSize,
        infinityRingExtent: this._camera.far * 0.95,
      },
      waterMaterial,
    );
    this._scene.add(this.clipmap.getObject());
    this._wireClipmapFollowers();

    // Recreate wave sampler and rebind buoyancy. The follow-up
    // `_fireCascadeChanged` below routes the cascade-uniform refresh
    // through the same path the floor / sun-shafts use.
    const waveSampler = createWaveSampler(oceanSim, this.renderer);
    this._sampler = waveSampler;
    this.buoyancy.setSampler(waveSampler);

    // Rebind spray compute passes against the new wave sim + cascade sampler.
    // Emitter registrations, particle pool, and defaults all survive; alive
    // particles re-anchor to the new surface on the next simulate dispatch.
    if (this._spray && waterMaterial.cascadeSampler) {
      this._spray.setOceanSim(oceanSim, waterMaterial.cascadeSampler);
    }

    // Recreate particles (they bind to material uniforms). Swap the registry
    // entry so `_rebindDepthTextures` reaches the new instance automatically.
    const particlesIdx = this._subsystems.indexOf(this._particles);
    this._scene.remove(this._particles.getMesh());
    this._particles.dispose();
    this._particles = new UnderwaterParticles(
      params.postProcessing.underwaterParticles,
      {
        clipDistance: waterMaterial.clipPlaneDistanceUniform,
        cameraForward: waterMaterial.cameraForwardUniform,
      },
    );
    this._scene.add(this._particles.getMesh());
    this._subsystems[particlesIdx] = this._particles;

    // Repoint the underwater controller at the new material + particles.
    this._underwaterController.rebind({
      material: waterMaterial,
      particles: this._particles,
    });

    // Rebind the render pass manager in place. Sky, mask objects, and
    // render targets all survive; only the water-facing
    // references (clipmap, material) need updating.
    this.renderPassManager.rebind({
      clipmap: this.clipmap,
      waterMaterial,
    });

    // Rebind every depth-texture consumer against the new render targets.
    this._rebindDepthTextures();

    // Quality-changed hook fans out to any registered subsystem with
    // quality-dependent resources. SunShafts rebuilds its intensity
    // pass at the new resolution scale; everyone else no-ops.
    for (const s of this._subsystems) {
      await s.onQualityChanged?.(quality, qualityConfig);
    }

    // Update config
    this._config = Object.freeze({
      quality,
      cascades: qualityConfig.cascades.map((c) => ({ ...c })),
    });

    // Apply all params to new subsystems, then clamp effect enabled states to
    // what this quality level supports (heavy effects off on low-end tiers).
    // The clamp only forces effects off, so preset/user "off" choices persist.
    this.applyParams(params);
    this.clampFeaturesToQuality(qualityConfig.features);
    this.syncFadeEndToWaterExtent();

    // Initialize the new simulation
    this._camera.updateMatrixWorld(true);
    oceanSim.update(0);
    this.clipmap.update(this._camera.position);
    this.renderPassManager.renderCapturePass(this.renderer);
  }

  // ============================================
  // Public Methods — Configuration
  // ============================================

  /**
   * Load a preset, replacing all current parameters.
   *
   * Accepts either a built-in preset name or a custom WaterPreset object.
   * Updates all uniforms and subsystems. Does not affect the sky —
   * if you want the sky to match the preset, update it separately.
   *
   * @param preset - A built-in preset name or a complete WaterPreset object
   */
  loadPreset(preset: PresetName | WaterPreset): void {
    const params =
      typeof preset === "string"
        ? getPresetParams(preset)
        : normalizeWaterSceneConfig(preset);
    this.applyParams(params);
  }

  /**
   * Set (or clear) the active sky provider. Mesh lifecycle,
   * `scene.environment`, and all subsystem rebinds are handled internally;
   * the outgoing provider is never disposed.
   */
  setSky(sky: SkyProvider | null): void {
    // Core infrastructure first: hooks below may query rpm.getCurrentSky().
    this.renderPassManager.setSky(sky);
    for (const s of this._subsystems) {
      s.onSkyChanged?.(sky);
    }
  }

  /**
   * Resize the cascade set from a single largest tile size (meters). Finer
   * cascades and their band edges derive automatically.
   */
  setMaxScale(maxScale: number): void {
    this.oceanSim.setMaxScale(maxScale);
    this._fireCascadeChanged();
  }

  /**
   * Manually set the water grid center position.
   * Only effective when {@link cameraTracking} is disabled.
   *
   * @param x - World X coordinate
   * @param z - World Z coordinate
   */
  setPosition(x: number, z: number): void {
    this._manualPosition.set(x, 0, z);
    this.updateClipmapPosition(this._manualPosition);
  }

  /**
   * Rebuild the clipmap geometry with new LOD levels or base size.
   * Mesh resolution (segments) is owned by the active quality level — change
   * it via {@link setQualityLevel} or by editing the `QUALITY_LEVELS` entry,
   * not here.
   */
  rebuildGeometry(
    config: Partial<Omit<ClipmapConfig, "segments" | "infinityRingExtent">>,
  ): void {
    // Infinity ring extent is always derived from the camera far plane, not
    // from the caller — overrides are ignored.
    const effective: Partial<ClipmapConfig> = {
      ...config,
      infinityRingExtent: this._camera.far * 0.95,
    };
    this.clipmap.rebuild(effective, this.waterMaterial);
    this.syncFadeEndToWaterExtent();
  }

  /**
   * Get the current clipmap configuration.
   */
  getGeometryConfig(): Readonly<ClipmapConfig> {
    return this.clipmap.getConfig();
  }

  /**
   * Recreate the ocean floor with new options.
   * Use this to change mesh resolution, texture mode, or other options that
   * require recreating the geometry/material.
   */
  async recreateOceanFloor(options: Partial<OceanFloorOptions>): Promise<void> {
    const oldMesh = this.oceanFloor.getMesh();
    this._scene.remove(oldMesh);
    this.oceanFloor.dispose();

    const newFloor = await OceanFloor.create({
      size: this.clipmap.getTotalSize(),
      depth: -oldMesh.position.y,
      windDirection: this._waveUniforms.windDirection,
      ...options,
    });

    // Place the new floor at the clipmap's current follow position so a
    // resolution change doesn't flash the mesh to the origin for a frame.
    const snapped = this.clipmap.getSnappedPosition();
    newFloor.setFollowPosition(snapped.x, snapped.y);

    this._scene.add(newFloor.getMesh());

    this.oceanFloor = newFloor;

    // The floor is a registered cascade subscriber — fire the
    // notification so the new instance pulls cascade-0 wave texture
    // and buffer params from the sim. The other subscribers (sun
    // shafts, material, buoyancy) re-do their no-op idempotent reads.
    this._fireCascadeChanged();
  }

  // ============================================
  // Public Methods — Utilities
  // ============================================

  /**
   * Query the water height at a world position.
   * Uses the buoyancy system's sampler — dispatches a GPU compute and readback.
   *
   * @param x - World X coordinate
   * @param z - World Z coordinate
   * @returns Promise resolving to the water height (Y displacement) at the position
   */
  async getHeightAt(x: number, z: number): Promise<number> {
    if (this._disposed) return 0;

    const sampler = this.buoyancy.getSampler();
    this._heightQueryPos.set(x, 0, z);
    sampler.setPositions([this._heightQueryPos]);
    await sampler.update();

    if (this._disposed) return 0;

    return sampler.getSample(0).height;
  }

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
  get postProcessing(): PostProcessingPipeline {
    return this._postProcessing;
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Fan out the current render-pass depth textures to every registered
   * subsystem that caches them. Called once at construction, once after
   * every `resize`, and once after every `setQualityLevel` — the render
   * targets backing these textures change identity in both cases, so
   * cached `TextureNode` values must be re-pointed.
   */
  private _rebindDepthTextures(): void {
    for (const s of this._subsystems) {
      s.bindDepthTextures?.(this.renderPassManager);
    }
  }

  /**
   * Apply all parameters from a preset.
   */
  private applyParams(params: WaterSceneConfig): void {
    // Shader class updates (each class owns its own uniforms)
    // Both WebGL and WebGPU use FFT-based waves with shared WaveUniforms
    this._waveUniforms.update(params.waves.fft);

    this._lighting.applyParams(params);
    this._environment.applyParams(params);
    this._wake.applyParams(params);
    this.color.update(params.color);
    this.color.waterDepth = params.oceanFloor.depth;
    this.oceanFloor.setDepth(params.oceanFloor.depth);
    this.oceanFloor.setVisible(params.oceanFloor.enabled);
    this.fresnel.update(params.fresnel.surface);
    this.sss.update(params.sss);
    this.sparkle.update(params.sparkle);
    this.fog.update(params.fog);
    this.foam.surface.update(params.foam.surface);
    this.foam.waves.update(params.foam.waves);
    this.foam.shoreline.update(params.foam.shoreline);
    this.ssr.update(params.ssr);

    this._underwaterDistortion.update(params.postProcessing.underwater);
    this._underwater.tintColor = params.postProcessing.underwater.tintColor;

    this._rainSystem.update(params.postProcessing.rain);

    // Wave-crest spray (WebGPU only; null on other backends)
    this._spray?.update(params.spray);

    // Underwater particles
    this._particles.updateParams(params.postProcessing.underwaterParticles);

    // Ocean floor caustics
    this.oceanFloor.updateCausticsConfig(params.oceanFloor.caustics);

    // Sun shafts
    this._sunShafts.update(params.oceanFloor.sunShafts);

    this.updateAllCascadeConfigs(params);
  }

  /**
   * Clamp effect enabled states to the quality level's capabilities. A quality
   * feature flag can only force an effect off — keeping heavy effects like SSR
   * disabled on low-end tiers — and never forces one on. Called after
   * applyParams, so a preset's or user's "off" choice survives a quality switch
   * instead of being re-enabled by the new level's defaults.
   */
  private clampFeaturesToQuality(
    features: QualityLevelConfig["features"],
  ): void {
    this._ssr.enabled = this._ssr.enabled && features.ssr;
    this._sss.enabled = this._sss.enabled && features.sss;
    this._sparkle.enabled = this._sparkle.enabled && features.sparkle;
    this._surfaceFoam.enabled =
      this._surfaceFoam.enabled && features.surfaceFoam;
    // The foam field reads this same enable node, so it follows automatically.
    this._waveFoam.enabled = this._waveFoam.enabled && features.turbulentFoam;
    this._shorelineFoam.enabled =
      this._shorelineFoam.enabled && features.shorelineFoam;
  }

  /**
   * Sync distance-based fadeEnd values.
   * Fresnel fades at the outermost LOD's edge. Fog fadeEnd is preset-driven
   * and user-tunable via `water.fog.fadeEnd`, not auto-synced.
   */
  private syncFadeEndToWaterExtent(): void {
    this.fresnel.fadeEnd = this.clipmap.getTotalSize() / 2;
  }

  /**
   * Move the clipmap to follow the camera. The clipmap's snapped-position
   * listeners (registered in `_wireClipmapFollowers`) propagate the new
   * position to the water material's offset uniform and the ocean floor
   * mesh — no explicit fan-out here.
   */
  private updateClipmapPosition(cameraPosition: THREE.Vector3): void {
    this.clipmap.update(cameraPosition);
  }

  /**
   * Register every consumer that needs to follow the clipmap's snapped
   * position. Called after construction and after every clipmap rebuild
   * (the new clipmap starts with an empty listener list).
   */
  private _wireClipmapFollowers(): void {
    this.clipmap.addSnappedPositionListener((x, z) => {
      this.waterMaterial.clipmapOffsetUniform.value.set(x, z);
    });
    this.clipmap.addSnappedPositionListener((x, z) => {
      this.oceanFloor.setFollowPosition(x, z);
    });
  }

  private updateAllCascadeConfigs(params: WaterSceneConfig): void {
    // Amplitude is applied globally in the FFT shader via the shared wave
    // uniform, so it does not flow through here.
    this.oceanSim.setMaxScale(params.waves.fft.cascades.maxScale);
    this._fireCascadeChanged();
  }

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
  private _fireCascadeChanged(): void {
    this.oceanFloor.onCascadeChanged(this.oceanSim);
    this.waterMaterial.onCascadeChanged(this.oceanSim);
    this.buoyancy.onCascadeChanged(this.oceanSim);
    for (const s of this._subsystems) {
      s.onCascadeChanged?.(this.oceanSim);
    }
  }
}
