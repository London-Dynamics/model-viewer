import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  WaterSystem,
  BuoyancyDebugVisualizer,
  SprayDebugVisualizer,
  WakeDebugVisualizer,
  Sky,
  getPresetParams,
  applyPresetToParams,
  type PresetName,
  type QualityLevel,
  type WaterPreset,
} from "threejs-water-pro";

import { AudioManager } from "./audio/AudioManager";
import {
  loadAllModels,
  addModelsToScene,
  type LoadedModels,
} from "./scene/ModelLoader";
import { FishManager } from "./scene/FishManager";
import { HdriManager } from "./scene/HdriManager";
import { SceneVisibility } from "./scene/SceneVisibility";
import {
  setupPostProcessing,
  type PostProcessingUniforms,
} from "./scene/PostProcessing";
import { ParamsStore, deepMerge } from "./persistence/ParamsStore";
import { ShipController } from "./ship/ShipController";
import { CameraController } from "./ship/CameraController";
import { ShipHUD } from "./ship/ShipHUD";
import {
  computeBuoyancySampling,
  computeSprayProbes,
} from "./ship/shipHullPoints";
import { extractPresetParams } from "./ui/Controls";
import { LoadingOverlay } from "./ui/LoadingOverlay";
import {
  PerformanceTracker,
  DynamicResolutionManager,
} from "./utils/PerformanceTracker";

// Demo-specific buoyancy config (not part of library presets)
interface BuoyancyObjectParams {
  enabled: boolean;
  showSamplePoints: boolean;
  multiPoint: boolean;
  heightOffset: number;
  tiltAmount: number;
  heightSmoothing: number;
  tiltSmoothing: number;
}

export type AntialiasingMode = "none" | "fxaa" | "smaa";

interface DemoParams extends WaterPreset {
  activePreset: PresetName;
  antialiasing: AntialiasingMode;
  buoyancy: {
    ship: BuoyancyObjectParams;
    buoy: BuoyancyObjectParams;
  };
  debug: {
    forceWebGL: boolean;
  };
  hdriUrl: string;
}

const WIP_STORAGE_KEY = "wip-params";

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
  // Private state
  private renderer!: THREE.WebGPURenderer;
  private fishManager!: FishManager;
  /** Bow + stern ship wake generators (index 0 = bow, 1 = stern). */
  public readonly shipWakeIds: number[] = [];
  public readonly islandBuoyWakeIds: number[] = [];
  private postProcessing!: THREE.PostProcessing;
  private scenePass!: THREE.PassNode;
  private performanceTracker!: PerformanceTracker;
  private dynamicResolution!: DynamicResolutionManager;
  private paramsStore!: ParamsStore<DemoParams>;
  private readonly loadingOverlay = new LoadingOverlay();
  private readonly hdri = new HdriManager();
  private _visibility!: SceneVisibility;
  private lastFrameTime = performance.now();
  private isChangingQuality = false;
  /** The currently-running `animate` frame, so a quality switch can wait for it
   * to finish rendering before disposing the resources it's still drawing. */
  private _frameInFlight: Promise<void> | null = null;

  // Public readonly fields (set once during init)
  public readonly waterSystem!: WaterSystem;
  public readonly camera!: THREE.PerspectiveCamera;
  public readonly controls!: OrbitControls;
  public readonly models!: LoadedModels;
  public readonly sky!: Sky;
  public readonly buoyancyDebugVisualizer!: BuoyancyDebugVisualizer;
  public readonly sprayDebugVisualizer!: SprayDebugVisualizer;
  public readonly wakeDebugVisualizer!: WakeDebugVisualizer;
  public readonly shipController!: ShipController;
  public readonly cameraController!: CameraController;
  public readonly shipBuoyancyId: number = -1;
  public readonly islandBuoyIds: number[] = [];
  public readonly audioManager = new AudioManager();
  public shipHUD!: ShipHUD;
  public postProcessingUniforms!: PostProcessingUniforms;

  public params: DemoParams = {
    ...getPresetParams("dusk"),
    activePreset: "dusk",
    antialiasing: "smaa" as AntialiasingMode,
    buoyancy: {
      ship: {
        enabled: true,
        showSamplePoints: false,
        multiPoint: true,
        heightOffset: -1.7,
        tiltAmount: 0.5,
        heightSmoothing: 0,
        tiltSmoothing: 0.02,
      },
      buoy: {
        enabled: true,
        showSamplePoints: false,
        multiPoint: true,
        heightOffset: -0.9,
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
    dynamicResolution: false,
    targetFps: 30,
    minPixelRatio: 0.5,
    maxPixelRatio: Math.min(window.devicePixelRatio, 1),
  };

  public static async create(): Promise<WaterApp> {
    const app = new WaterApp();
    await app.init();
    return app;
  }

  protected async init(): Promise<void> {
    this.initParamsStore();
    this.assign("renderer", await createRenderer());
    this.initCamera();

    const scene = new THREE.Scene();
    const [models, waterSystem] = await Promise.all([
      loadAllModels(),
      WaterSystem.create(
        this.renderer,
        scene,
        this.camera,
        this.performanceParams.quality,
        { deterministic: false },
      ),
    ]);
    this.assign("models", models);
    this.assign("waterSystem", waterSystem);

    // Sky must construct after WaterSystem so it can capture the
    // Lighting-owned sun direction uniform in the disk overlay shader.
    await this.initSky();

    waterSystem.loadPreset(this.params);
    waterSystem.setSky(this.sky);
    for (const mesh of this.sky.getMeshes()) scene.add(mesh);

    await this.initScene(scene);
    this._visibility = new SceneVisibility(this.models, this.fishManager);

    this.initControls();
    this.setupBuoyancy();
    this.initShipControls();
    this.setupWaterMask();

    this.rebuildPostProcessing();
    this.initPerformanceTracking();
    this.setupEventListeners();

    await this.renderer.compileAsync(waterSystem.scene, this.camera);

    this.paramsStore.startAutoSave();
    this._scheduleFrame();
  }

  // ════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════

  /** HDRI options exposed for the Sky UI folder. */
  public get hdriOptions(): ReadonlyArray<{ label: string; url: string }> {
    return this.hdri.options;
  }

  public get visibility(): SceneVisibility {
    return this._visibility;
  }

  /**
   * Renderer tone-mapping operator, exposed for the Post-Processing UI. The
   * operator is baked into the post-processing output node, so callers must
   * {@link rebuildPostProcessing} after changing it.
   */
  public get toneMapping(): THREE.ToneMapping {
    return this.renderer.toneMapping;
  }
  public set toneMapping(value: THREE.ToneMapping) {
    this.renderer.toneMapping = value;
  }

  /** Tone-mapping exposure (output brightness). Applied live as a uniform. */
  public get toneMappingExposure(): number {
    return this.renderer.toneMappingExposure;
  }
  public set toneMappingExposure(value: number) {
    this.renderer.toneMappingExposure = value;
  }

  public rebuildPostProcessing(): void {
    const result = setupPostProcessing(
      this.renderer,
      this.waterSystem,
      this.params,
      this.params.antialiasing,
    );
    this.postProcessing = result.postProcessing;
    this.postProcessingUniforms = result.uniforms;
    this.scenePass = result.scenePass;
  }

  public setPixelRatio(ratio: number): void {
    this.dynamicResolution.setPixelRatio(ratio, this.renderer);
  }

  public async applyPreset(preset: PresetName | WaterPreset): Promise<void> {
    if (typeof preset === "string") {
      this.params.activePreset = preset;
    }
    const resolved =
      typeof preset === "string" ? getPresetParams(preset) : preset;
    this.waterSystem.loadPreset(preset);
    applyPresetToParams(this.params, preset);

    this.sky.applySunOverlay({
      enabled: this.params.sky.sun.diskEnabled,
      radius: this.params.sky.sun.diskRadius,
      color: this.params.sky.sun.diskColor,
      emissiveColor: this.params.sky.sun.diskEmissiveColor,
      emissiveIntensity: this.params.sky.sun.diskEmissiveIntensity,
    });

    this.sky.brightnessUniform.value = this.params.sky.brightness;
    this.sky.reflectionBlurDistanceUniform.value = this.params.sky.reflectionBlurDistance;
    this.sky.reflectionDistanceBlurUniform.value = this.params.sky.reflectionDistanceBlur;
    this.sky.reflectionRoughnessUniform.value = this.params.sky.reflectionRoughness;

    // If the preset specifies an image sky source, load it. Presets without
    // `sky.source` leave the current texture alone.
    if (resolved.sky.source?.type === "hdri") {
      await this.setHDRI(resolved.sky.source.url);
    }
  }

  /**
   * Load the equirect at `url` (relative to `demo/public/`) and swap it in
   * on the active sky. Records the choice on `params.hdriUrl` and
   * `params.sky.source` so it persists across auto-saves and preset exports.
   */
  public async setHDRI(url: string): Promise<void> {
    this.params.hdriUrl = url;
    this.params.sky.source = { type: "hdri", url };
    await this.hdri.apply(url, this.sky, this.renderer);
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
      await this.waterSystem.setQualityLevel(currentQuality, this.params);
      this.rebuildPostProcessing();
      await this.renderer.compileAsync(this.waterSystem.scene, this.camera);

      // Render a frame before hiding the overlay to ensure water is visible
      await this.waterSystem.update(0);
      if (this.params.postProcessing.enabled) {
        this.postProcessing.render();
      } else {
        this.waterSystem.render();
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
      // (`object: ui.water.spray, key: "size"`, see src/shaders/CLAUDE.md)
      // and bypass `this.params` entirely. Deep-merge — not assign —
      // preserves object identity for any UI control that *does* still bind
      // to a sub-object of `this.params`.
      const live = extractPresetParams(this.waterSystem, this.sky, this.params);
      deepMerge(this.params, live);
    });
    this.paramsStore.load();

    // Drop a persisted HDRI URL that no longer matches any bundled option —
    // e.g. an asset was renamed / removed since the user last loaded it.
    if (!this.hdri.isValid(this.params.hdriUrl)) {
      this.params.hdriUrl = this.hdri.options[0].url;
    }
  }

  private initCamera(): void {
    this.assign(
      "camera",
      new THREE.PerspectiveCamera(
        60,
        window.innerWidth / window.innerHeight,
        0.1,
        50000,
      ),
    );
    this.camera.position.set(-300, 50, 300);
    this.camera.lookAt(0, 0, 0);
  }

  private async initSky(): Promise<void> {
    const equirect = await this.hdri.load(this.params.hdriUrl);
    const skyParams = this.params.sky;
    const sun = skyParams.sun;
    this.assign(
      "sky",
      new Sky({
        equirect,
        brightness: skyParams.brightness,
        reflectionBlurDistance: skyParams.reflectionBlurDistance,
        reflectionDistanceBlur: skyParams.reflectionDistanceBlur,
        reflectionRoughness: skyParams.reflectionRoughness,
        sunDirection: this.waterSystem.lighting.sun.direction,
        sunOverlay: {
          enabled: sun.diskEnabled,
          radius: sun.diskRadius,
          color: sun.diskColor,
          emissiveColor: sun.diskEmissiveColor,
          emissiveIntensity: sun.diskEmissiveIntensity,
        },
      }),
    );
  }

  private async initScene(scene: THREE.Scene): Promise<void> {
    addModelsToScene(scene, this.models);
    this.fishManager = new FishManager(scene);
    await this.fishManager.load();
  }

  private initControls(): void {
    this.assign(
      "controls",
      new OrbitControls(this.camera, this.renderer.domElement),
    );
    // Frame both the ship and the island in the opening view: orbit their
    // midpoint and pull the camera well back and up.
    const midpoint = this.models.shipModel.position
      .clone()
      .add(this.models.islandModel.position)
      .multiplyScalar(0.5);
    this.controls.target.copy(midpoint);
    this.camera.position.set(
      midpoint.x - 700,
      midpoint.y + 120,
      midpoint.z + 700,
    );
    this.controls.enableDamping = true;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 3000;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.update();
  }

  private initShipControls(): void {
    this.assign(
      "shipController",
      new ShipController(
        this.models.shipModel,
        this.shipBuoyancyId,
        this.waterSystem,
      ),
    );

    this.assign(
      "cameraController",
      new CameraController(
        this.camera,
        this.renderer.domElement,
        this.models.shipModel,
        this.shipController,
        this.controls,
      ),
    );
    this.cameraController.onModeChange((mode) => {
      this.syncActiveCamera();
      if (mode === "thirdPerson") {
        this.shipController.enable();
      } else {
        this.shipController.disable();
      }
    });
    this.cameraController.enable();

    this.shipHUD = new ShipHUD(this.audioManager);
  }

  private initPerformanceTracking(): void {
    this.performanceTracker = new PerformanceTracker();
    this.performanceTracker.setBackend(this.waterSystem.backend);
    this.dynamicResolution = new DynamicResolutionManager(
      this.performanceParams.maxPixelRatio,
    );
    this.dynamicResolution.setPixelRatio(
      this.performanceParams.maxPixelRatio,
      this.renderer,
    );
  }

  private setupBuoyancy(): void {
    this.assign(
      "buoyancyDebugVisualizer",
      new BuoyancyDebugVisualizer(this.waterSystem.scene),
    );
    const showDebug =
      this.params.buoyancy.ship.showSamplePoints ||
      this.params.buoyancy.buoy.showSamplePoints;
    this.buoyancyDebugVisualizer.setEnabled(showDebug);

    // Wake generator indicators (off by default; toggled from the Wake folder).
    this.assign(
      "wakeDebugVisualizer",
      new WakeDebugVisualizer(this.waterSystem.scene),
    );

    const shipParams = this.params.buoyancy.ship;
    // Inset the bow/stern sample points inboard of the bounding-box tips so they
    // ride the hull. The bow needs a far larger inset than the stern because the
    // bowsprit stretches the AABB forward well past the actual bow.
    const shipSampling = computeBuoyancySampling(this.models.shipModel, {
      bow: 90,
      stern: 20,
    });
    this.assign(
      "shipBuoyancyId",
      this.waterSystem.buoyancy.addObject(this.models.shipModel, {
        multiPoint: shipParams.multiPoint,
        heightOffset: shipParams.heightOffset,
        rotationInfluence: shipParams.tiltAmount,
        heightSmoothing: shipParams.heightSmoothing,
        rotationSmoothing: shipParams.tiltSmoothing,
        useBoundingBox: false,
        ...shipSampling,
      }),
    );

    const buoyParams = this.params.buoyancy.buoy;
    (this.islandBuoyIds as number[]).length = 0;
    (this.islandBuoyWakeIds as number[]).length = 0;
    for (const buoy of this.models.islandBuoys) {
      (this.islandBuoyIds as number[]).push(
        this.waterSystem.buoyancy.addObject(buoy, {
          multiPoint: buoyParams.multiPoint,
          heightOffset: buoyParams.heightOffset,
          rotationInfluence: buoyParams.tiltAmount,
          heightSmoothing: buoyParams.heightSmoothing,
          rotationSmoothing: buoyParams.tiltSmoothing,
        }),
      );
      // (Buoy wake generators disabled — debugging the wake with a single
      // generator at the ship's bow.)
    }

    // Single generator at the bow (debugging the wake). Offset is derived from
    // the hull bounding box, so it tracks the model's size.
    (this.shipWakeIds as number[]).length = 0;
    (this.shipWakeIds as number[]).push(
      this.waterSystem.wake.addGenerator(this.models.shipModel, {
        depth: 10.0,
        radius: 36.5,
        offset: new THREE.Vector3(0, 0, -100),
      }),
    );

    this.assign(
      "sprayDebugVisualizer",
      new SprayDebugVisualizer(this.waterSystem.scene),
    );
    this.sprayDebugVisualizer.setEnabled(false);

    if (this.waterSystem.spray) {
      this.waterSystem.spray.addEmitter(this.models.shipModel, {
        probes: computeSprayProbes(this.models.shipModel),
      });
    }
  }

  private setupWaterMask(): void {
    if (this.models.shipWaterMask) {
      this.waterSystem.masking.add(this.models.shipWaterMask);
    }
  }

  private setupEventListeners(): void {
    window.addEventListener("resize", () => this.waterSystem.resize());

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
    const cam = this.cameraController.activeCamera;
    this.waterSystem.camera = cam;
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

    this.shipController.update(deltaTime);
    this.cameraController.update(deltaTime);
    this.shipHUD.update(this.shipController, this.cameraController);

    if (this.cameraController.shouldUpdateOrbitControls) {
      this.controls.update();
    }

    const activeCamera = this.cameraController.activeCamera;
    this.audioManager.update(
      this.params.waves.fft.windSpeed,
      deltaTime,
      activeCamera.position.y,
    );

    if (this.waterSystem.underwater.enabled) {
      this.fishManager.update(deltaTime);
    }

    await this.waterSystem.update(deltaTime);

    if (this.buoyancyDebugVisualizer.isEnabled()) {
      this.buoyancyDebugVisualizer.update(
        this.waterSystem.buoyancy.getDebugData(),
      );
    }

    if (this.sprayDebugVisualizer.isEnabled() && this.waterSystem.spray) {
      this.sprayDebugVisualizer.update(
        this.waterSystem.spray.getProbeDebugData(),
      );
    }

    if (this.wakeDebugVisualizer.isEnabled()) {
      this.wakeDebugVisualizer.update(this.waterSystem.wake.getDebugData());
    }

    this.renderer.info.reset();

    if (this.params.postProcessing.enabled) {
      this.postProcessing.render();
    } else {
      this.waterSystem.render();
    }

    const avgFrameTime = this.performanceTracker.update(
      deltaTime,
      this.renderer,
    );
    this.dynamicResolution.update(
      avgFrameTime,
      this.renderer,
      this.performanceParams,
    );
    this.performanceTracker.setPixelRatio(this.renderer.getPixelRatio());

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

  /**
   * Assignment to readonly fields during init.
   * Fields are readonly to prevent external mutation but need to be set once during init().
   */
  private assign(key: string, value: unknown): void {
    (this as Record<string, unknown>)[key] = value;
  }
}
