// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type * as THREE from "three/webgpu";
import { Sky } from "threejs-water-pro";
import type { WaterSystem, WaterPresetConfig } from "threejs-water-pro";

import { HdriManager } from "./HdriManager";

/** The slice of the demo's params object the sky owns and persists into. */
interface SkyParamsSlice {
  hdriUrl: string;
  sky: WaterPresetConfig["sky"];
}

export interface SkyManagerOptions {
  params: SkyParamsSlice;
  renderer: THREE.WebGPURenderer;
  waterSystem: WaterSystem;
}

/**
 * Owns everything sky in the demo: the HDRI-backed {@link Sky} wired into
 * `waterSystem.setSky` and the HDRI asset list. Mutations are recorded on
 * the shared params object so they persist across auto-saves and preset
 * exports.
 */
export class SkyManager {
  private readonly _hdri = new HdriManager();
  private readonly _params: SkyParamsSlice;
  private readonly _renderer: THREE.WebGPURenderer;
  private readonly _waterSystem: WaterSystem;

  private _sky!: Sky;

  private constructor(options: SkyManagerOptions) {
    this._params = options.params;
    this._renderer = options.renderer;
    this._waterSystem = options.waterSystem;
  }

  /**
   * Build the HDRI sky from `params.hdriUrl` and wire it into the water
   * system. Must run after `WaterSystem.create` so the sky can capture the
   * Lighting-owned sun direction uniform in the disk overlay shader.
   */
  public static async create(options: SkyManagerOptions): Promise<SkyManager> {
    const manager = new SkyManager(options);
    const params = manager._params;

    // Drop a persisted HDRI URL that no longer matches any bundled option —
    // e.g. an asset was renamed / removed since the user last loaded it.
    if (!manager._hdri.isValid(params.hdriUrl)) {
      params.hdriUrl = manager._hdri.options[0].url;
    }

    const equirect = await manager._hdri.load(params.hdriUrl);
    const skyParams = params.sky;
    const sun = skyParams.sun;
    manager._sky = new Sky(manager._renderer, {
      equirect,
      brightness: skyParams.brightness,
      reflectionRoughness: skyParams.reflectionRoughness,
      sunDirection: manager._waterSystem.lighting.sun.direction,
      sunOverlay: {
        enabled: sun.diskEnabled,
        radius: sun.diskRadius,
        color: sun.diskColor,
        emissiveColor: sun.diskEmissiveColor,
        emissiveIntensity: sun.diskEmissiveIntensity,
      },
    });

    // Environment (a registered WaterSystem subsystem) adds the sky's
    // backdrop meshes to the scene and assigns scene.environment.
    manager._waterSystem.setSky(manager._sky);
    return manager;
  }

  /** HDRI options exposed for the Sky UI folder. */
  public get hdriOptions(): ReadonlyArray<{ label: string; url: string }> {
    return this._hdri.options;
  }

  public get sky(): Sky {
    return this._sky;
  }

  /**
   * Push the merged preset's sky values onto the HDRI sky's uniforms and sun
   * overlay. `presetSky` is the incoming preset's own sky slice: if it names
   * an image source, that HDRI is loaded; presets without `sky.source` leave
   * the current texture alone.
   */
  public async applyPreset(presetSky: WaterPresetConfig["sky"]): Promise<void> {
    const skyParams = this._params.sky;
    const sun = skyParams.sun;
    this._sky.applySunOverlay({
      enabled: sun.diskEnabled,
      radius: sun.diskRadius,
      color: sun.diskColor,
      emissiveColor: sun.diskEmissiveColor,
      emissiveIntensity: sun.diskEmissiveIntensity,
    });

    this._sky.brightness = skyParams.brightness;
    this._sky.reflectionRoughnessUniform.value = skyParams.reflectionRoughness;

    if (presetSky.source?.type === "hdri") {
      await this.setHDRI(presetSky.source.url);
    }
  }

  /**
   * Load the equirect at `url` (relative to `demo/public/`) and swap it in
   * on the HDRI sky. Records the choice on `params.hdriUrl` and
   * `params.sky.source`.
   */
  public async setHDRI(url: string): Promise<void> {
    this._params.hdriUrl = url;
    this._params.sky.source = { type: "hdri", url };
    await this._hdri.apply(url, this._sky, this._renderer);
  }
}
