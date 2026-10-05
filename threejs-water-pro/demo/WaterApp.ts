// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  WaterSystem,
  getPresetParams,
  applyPresetToParams,
  normalizeWaterColorConfig,
  type PresetName,
  type QualityLevel,
  type WaterColorConfig,
  type WaterPresetConfig,
} from "threejs-water-pro";

import { AudioManager } from "./audio/AudioManager";
import {
  loadAllModels,
  addModelsToScene,
  type LoadedModels,
} from "./scene/ModelLoader";
import { FishManager } from "./scene/FishManager";
import { FogTestGrid } from "./scene/FogTestGrid";
import { UnderwaterScenery } from "./scene/UnderwaterScenery";
import { SkyManager } from "./scene/SkyManager";
import { WaterDebug, type WaterDebugParams } from "./scene/WaterDebug";
import {
  setupPostProcessing,
  type PostProcessingUniforms,
} from "./scene/PostProcessing";
import { ParamsStore, deepMerge } from "./persistence/ParamsStore";
import { ShipController } from "./ship/ShipController";
import { CameraController } from "./ship/CameraController";
import { ShipHUD } from "./ship/ShipHUD";
import { extractPresetParams } from "./ui/Controls";
import { LoadingOverlay } from "./ui/LoadingOverlay";
import { PerformanceTracker } from "./utils/PerformanceTracker";

export type AntialiasingMode = "none" | "fxaa" | "smaa";

interface DemoParams extends WaterPresetConfig {
  activePreset: PresetName;
  antialiasing: AntialiasingMode;
  buoyancy: WaterDebugParams;
  debug: {
    forceWebGL: boolean;
  };
  hdriUrl: string;
}

// Earlier demo snapshots may contain fields from an abandoned color model;
// start clean before restoring the supported physical or custom shape.
const WIP_STORAGE_KEY = "wip-params-v4";

/** Restore demo state while treating the color discriminated union atomically. */
function mergeDemoParams(target: DemoParams, source: unknown): void {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new TypeError("Saved demo parameters must be an object.");
  }

  const sourceRecord = source as Record<string, unknown>;
  const { color: colorInput, ...rest } = sourceRecord;
  const color =
    colorInput === undefined
      ? undefined
      : normalizeWaterColorConfig(colorInput as WaterColorConfig);

  deepMerge(target, rest);
  if (color) target.color = color;
}

async function createRenderer(): Promise<THREE.WebGPURenderer> {
  const forceWebGL =
    !navigator.gpu || localStorage.getItem("forceWebGL") === "true";
  // Disable renderer AA - use post-process FXAA instead to avoid depth blending at edges
  const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  return renderer;
}

export class WaterApp {
  // Set once in init(), exposed through getters below.
  private _renderer!: THREE.WebGPURenderer;
  private _waterSystem!: WaterSystem;
  private _camera!: THREE.PerspectiveCamera;
  private _controls!: OrbitControls;
  private _models!: LoadedModels;
  private _skyManager!: SkyManager;
  private _rig!: WaterDebug;
  private _shipController!: ShipController;
  private _cameraController!: CameraController;
  private _shipHUD!: ShipHUD;
  private _scenery!: UnderwaterScenery;
  private _postProcessingUniforms!: PostProcessingUniforms;

  // Internal state
  private fishManager!: FishManager;
  private postProcessing!: THREE.PostProcessing;
  private scenePass!: THREE.PassNode;
  private performanceTracker!: PerformanceTracker;
  private paramsStore!: ParamsStore<DemoParams>;
  private readonly loadingOverlay = new LoadingOverlay();
  /** Fog × transparency verification rig; created lazily on first enable. */
  private _fogTestGrid: FogTestGrid | null = null;
  private lastFrameTime = performance.now();
  /** Frames the render loop has actually drawn. Sampled by the demo FPS
   * readouts so they measure the render rate, not the display's vsync cadence. */
  private _frameCount = 0;
  private isChangingQuality = false;
  /** The currently-running `animate` frame, so a quality switch can wait for it
   * to finish rendering before disposing the resources it's still drawing. */
  private _frameInFlight: Promise<void> | null = null;

  public readonly audioManager = new AudioManager();

  public params: DemoParams = {
    ...getPresetParams("blackFlag"),
    activePreset: "blackFlag",
    antialiasing: "smaa" as AntialiasingMode,
    buoyancy: {
      ship: {
        enabled: true,
        showSamplePoints: false,
        multiPoint: true,
        heightOffset: -0.3,
        tiltAmount: 0.5,
        heightSmoothing: 0.1,
        tiltSmoothing: 0.25,
      },
      buoy: {
        enabled: true,
        showSamplePoints: false,
        multiPoint: true,
        heightOffset: -0.05,
        tiltAmount: 0.5,
        heightSmoothing: 0,
        tiltSmoothing: 0.04,
      },
    },
    debug: {
      forceWebGL: false,
    },
    hdriUrl: "hdris/citrus_orchard_road_puresky_4k.jpg",
  };

  public performanceParams = {
    quality: "high" as QualityLevel,
    showMonitor: true,
    pixelRatio: 1,
  };

  public static async create(): Promise<WaterApp> {
    const app = new WaterApp();
    await app.init();
    return app;
  }

  protected async init(): Promise<void> {
    this.initParamsStore();
    this._renderer = await createRenderer();
    this.initCamera();

    const scene = new THREE.Scene();

    const [models, waterSystem] = await Promise.all([
      loadAllModels(),
      WaterSystem.create(
        this._renderer,
        scene,
        this._camera,
        this.performanceParams.quality,
        { deterministic: false },
      ),
    ]);
    this._models = models;
    this._waterSystem = waterSystem;

    waterSystem.loadPreset(this.params);

    this._skyManager = await SkyManager.create({
      params: this.params,
      renderer: this._renderer,
      waterSystem,
    });

    await this.initScene(scene);
    this._scenery = new UnderwaterScenery(this._models, this.fishManager);
    this._scenery.setFloorDepth(this.params.oceanFloor.depth);

    this.initControls();
    this._rig = new WaterDebug(waterSystem, this._models, this.params.buoyancy);
    this.initShipControls();

    this.rebuildPostProcessing();
    this.initPerformanceTracking();
    this.setupEventListeners();

    await this._renderer.compileAsync(waterSystem.scene, this._camera);

    this.paramsStore.startAutoSave();
    this._scheduleFrame();
  }

  // ════════════════════════════════════════
  // Core accessors
  // ════════════════════════════════════════

  public get waterSystem(): WaterSystem {
    return this._waterSystem;
  }

  public get camera(): THREE.PerspectiveCamera {
    return this._camera;
  }

  public get controls(): OrbitControls {
    return this._controls;
  }

  public get models(): LoadedModels {
    return this._models;
  }

  /** Model↔water bindings (buoyancy, wake, spray) and their debug visualizers. */
  public get rig(): WaterDebug {
    return this._rig;
  }

  public get shipController(): ShipController {
    return this._shipController;
  }

  public get cameraController(): CameraController {
    return this._cameraController;
  }

  public get shipHUD(): ShipHUD {
    return this._shipHUD;
  }

  public get scenery(): UnderwaterScenery {
    return this._scenery;
  }

  public get postProcessingUniforms(): PostProcessingUniforms {
    return this._postProcessingUniforms;
  }

  /**
   * Monotonic count of frames the render loop has actually drawn. Increments
   * once per rendered frame in {@link animate} and stalls while a quality
   * switch pauses rendering. Sampling its delta over wall-clock yields the
   * true render rate, as opposed to a bare `requestAnimationFrame` counter
   * which reports the display's vsync cadence regardless of render speed.
   */
  public get frameCount(): number {
    return this._frameCount;
  }

  /** Both skies, the active source, and the HDRI asset list. */
  public get skyManager(): SkyManager {
    return this._skyManager;
  }

  // ════════════════════════════════════════
  // Debug & rendering options
  // ════════════════════════════════════════

  /** The fog × transparency test rig, if it has been shown at least once. */
  public get fogTestGrid(): FogTestGrid | null {
    return this._fogTestGrid;
  }

  /** Show/hide the fog × transparency test grid (Debug menu); created on first show. */
  public get showTransparencyTest(): boolean {
    return this._fogTestGrid?.enabled ?? false;
  }
  public set showTransparencyTest(value: boolean) {
    if (!value && !this._fogTestGrid) return;
    if (!this._fogTestGrid) {
      this._fogTestGrid = new FogTestGrid(this._waterSystem);
    }
    this._fogTestGrid.enabled = value;
  }

  /**
   * Renderer tone-mapping operator, exposed for the Post-Processing UI. The
   * operator is baked into the post-processing output node, so callers must
   * {@link rebuildPostProcessing} after changing it.
   */
  public get toneMapping(): THREE.ToneMapping {
    return this._renderer.toneMapping;
  }
  public set toneMapping(value: THREE.ToneMapping) {
    this._renderer.toneMapping = value;
  }

  /** Tone-mapping exposure (output brightness). Applied live as a uniform. */
  public get toneMappingExposure(): number {
    return this._renderer.toneMappingExposure;
  }
  public set toneMappingExposure(value: number) {
    this._renderer.toneMappingExposure = value;
  }

  // ════════════════════════════════════════
  // Public methods
  // ════════════════════════════════════════

  public rebuildPostProcessing(): void {
    const result = setupPostProcessing(
      this._renderer,
      this._waterSystem,
      this.params,
      this.params.antialiasing,
    );
    this.postProcessing = result.postProcessing;
    this._postProcessingUniforms = result.uniforms;
    this.scenePass = result.scenePass;
  }

  public setPixelRatio(ratio: number): void {
    this.performanceParams.pixelRatio = ratio;
    this._renderer.setPixelRatio(ratio);
    this._waterSystem.resize();
  }

  public async applyPreset(
    preset: PresetName | WaterPresetConfig,
  ): Promise<void> {
    if (typeof preset === "string") {
      this.params.activePreset = preset;
    }
    const resolved =
      typeof preset === "string" ? getPresetParams(preset) : preset;
    this._waterSystem.loadPreset(preset);
    applyPresetToParams(this.params, preset);
    this._scenery.setFloorDepth(this.params.oceanFloor.depth);
    await this._skyManager.applyPreset(resolved.sky);
  }

  public async updateQualityLevel(): Promise<void> {
    const currentQuality = this.performanceParams.quality;
    this.isChangingQuality = true;
    this.loadingOverlay.show();

    // Let any in-flight frame finish rendering with the current (valid)
    // resources before `setQualityLevel` disposes them — otherwise that frame's
    // depth pass draws a disposed material and the pipeline comes back null.
    // New frames are already blocked by the `isChangingQuality` guard.
    if (this._frameInFlight) {
      try {
        await this._frameInFlight;
      } catch {
        // The frame reports its own errors; we only need it to have settled.
      }
    }

    try {
      await this._waterSystem.setQualityLevel(currentQuality, this.params);
      this.rebuildPostProcessing();
      await this._renderer.compileAsync(this._waterSystem.scene, this._camera);

      // Render a frame before hiding the overlay to ensure water is visible
      await this._waterSystem.update(0);
      if (this.params.postProcessing.enabled) {
        this.postProcessing.render();
      } else {
        this._waterSystem.render();
      }
    } catch (error) {
      console.error("[Quality] Error during quality change:", error);
      throw error;
    } finally {
      this.isChangingQuality = false;
      this.loadingOverlay.hide();
    }
  }

  // ════════════════════════════════════════
  // Init helpers
  // ════════════════════════════════════════

  private initParamsStore(): void {
    this.paramsStore = new ParamsStore(WIP_STORAGE_KEY, this.params, () => {
      // Many UI controls bind directly to the live shader-class instance
      // (`object: ui.water.spray, key: "size"`, see src/shaders/AGENTS.md)
      // and bypass `this.params` entirely. Deep-merge — not assign —
      // preserves object identity for any UI control that *does* still bind
      // to a sub-object of `this.params`.
      const live = extractPresetParams(
        this._waterSystem,
        this._skyManager.sky,
        this.params,
      );
      mergeDemoParams(this.params, live);
    }, mergeDemoParams);
    this.paramsStore.load();
  }

  private initCamera(): void {
    this._camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      5000,
    );
    this._camera.position.set(-15, 2.5, 15);
    this._camera.lookAt(0, 0, 0);
  }

  private async initScene(scene: THREE.Scene): Promise<void> {
    addModelsToScene(scene, this._models);
    this.fishManager = new FishManager(scene);
    await this.fishManager.load();
  }

  private initControls(): void {
    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    // Open framed on the ship: keep the camera pulled back and up, with the
    // orbit target at the ship's deck height.
    const shipPosition = this._models.shipModel.position.clone();
    this._controls.target.copy(shipPosition.add(new THREE.Vector3(0, 5, 0)));
    this._camera.position.set(shipPosition.x - 50, 15, shipPosition.z + 25);
    this._controls.enableDamping = true;
    this._controls.minDistance = 2;
    this._controls.maxDistance = 150;
    this._controls.update();
  }

  private initShipControls(): void {
    this._shipController = new ShipController(
      this._models.shipModel,
      this._rig.shipBuoyancyId,
      this._waterSystem,
    );

    this._cameraController = new CameraController(
      this._camera,
      this._renderer.domElement,
      this._models.shipModel,
      this._shipController,
      this._controls,
    );
    this._cameraController.onModeChange((mode) => {
      this.syncActiveCamera();
      if (mode === "thirdPerson") {
        this._shipController.enable();
      } else {
        this._shipController.disable();
      }
    });
    this._cameraController.enable();

    this._shipHUD = new ShipHUD(this.audioManager);
  }

  private initPerformanceTracking(): void {
    this.performanceTracker = new PerformanceTracker();
    this.performanceTracker.setBackend(this._waterSystem.backend);
    this.setPixelRatio(this.performanceParams.pixelRatio);
  }

  private setupEventListeners(): void {
    window.addEventListener("resize", () => this._waterSystem.resize());

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.lastFrameTime = performance.now();
      }
    });

    const initAudio = async () => {
      await this.audioManager.init();
      document.removeEventListener("click", initAudio);
      document.removeEventListener("keydown", initAudio);
      document.removeEventListener("touchstart", initAudio);
    };
    document.addEventListener("click", initAudio);
    document.addEventListener("keydown", initAudio);
    document.addEventListener("touchstart", initAudio);
  }

  private syncActiveCamera(): void {
    const cam = this._cameraController.activeCamera;
    this._waterSystem.camera = cam;
    if (this.scenePass) {
      this.scenePass.camera = cam;
    }
  }

  private animate = async (): Promise<void> => {
    const now = performance.now();
    const deltaTime = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    if (this.isChangingQuality) {
      this._scheduleFrame();
      return;
    }

    this._shipController.update(deltaTime);
    this._cameraController.update(deltaTime);
    this._shipHUD.update(this._shipController, this._cameraController);

    if (this._cameraController.shouldUpdateOrbitControls) {
      this._controls.update();
    }

    const activeCamera = this._cameraController.activeCamera;
    this._fogTestGrid?.update(activeCamera);
    this.audioManager.update(
      this.params.waves.fft.windSpeed,
      deltaTime,
      activeCamera.position.y,
    );

    if (this._waterSystem.underwater.enabled) {
      this.fishManager.update(deltaTime);
    }

    await this._waterSystem.update(deltaTime);

    this._rig.update();

    this._renderer.info.reset();

    if (this.params.postProcessing.enabled) {
      this.postProcessing.render();
    } else {
      this._waterSystem.render();
    }

    this._frameCount++;

    this.performanceTracker.update(deltaTime, this._renderer);
    this.performanceTracker.setPixelRatio(this._renderer.getPixelRatio());

    this._scheduleFrame();
  };

  /**
   * Schedule the next frame, tracking the running promise in
   * {@link _frameInFlight} so a quality switch can await the in-flight frame
   * before disposing the GPU resources it is still rendering.
   */
  private _scheduleFrame(): void {
    requestAnimationFrame(() => {
      this._frameInFlight = this.animate().finally(() => {
        this._frameInFlight = null;
      });
    });
  }
}
