import type { PresetName, WaterPreset } from "threejs-water-pro";
import type { WaterApp } from "../WaterApp";
import {
  syncAmbient,
  syncPostProcessingUniforms,
  syncSunPosition,
} from "./folders";

/**
 * Thin orchestration layer for UI controls.
 * Provides access to app systems and coordinates multi-system operations.
 * Domain-specific sync logic lives in the folder modules.
 */
export class UIManager {
  readonly app: WaterApp;

  constructor(app: WaterApp) {
    this.app = app;
  }

  get water() {
    return this.app.waterSystem;
  }

  get params() {
    return this.app.params;
  }

  get performanceParams() {
    return this.app.performanceParams;
  }

  get audioManager() {
    return this.app.audioManager;
  }

  get shipController() {
    return this.app.shipController;
  }

  get cameraController() {
    return this.app.cameraController;
  }

  /** Whether the current backend is WebGL (vs WebGPU). */
  get isWebGL(): boolean {
    return this.water.backend === "webgl";
  }

  get postProcessingUniforms() {
    return this.app.postProcessingUniforms;
  }

  // ============================================
  // Orchestration Methods (coordinate multiple systems)
  // ============================================

  async applyPreset(preset: PresetName | WaterPreset): Promise<void> {
    await this.app.applyPreset(preset);
    syncSunPosition(this);
    syncAmbient(this);
    syncPostProcessingUniforms(this);
  }

  async updateQualityLevel(): Promise<void> {
    await this.app.updateQualityLevel();
    syncSunPosition(this);
    syncAmbient(this);
  }
}
