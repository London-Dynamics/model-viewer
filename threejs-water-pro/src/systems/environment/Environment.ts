// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

/**
 * Environment subsystem.
 *
 * Owns `scene.environmentNode` — the prefiltered environment (PMREM) every
 * scene mesh is lit by — and the active sky provider's scene-mesh lifecycle.
 * Both are sky-provider-derived, so this is the sky-backdrop owner: the single
 * place that reacts to `onSkyChanged`.
 *
 * Image-based lighting is scaled inside `scene.environmentNode` by the product
 * of an intensity uniform and the sky's brightness node, rather than through
 * `scene.environmentIntensity`. That built-in scalar is read per material only
 * when the render object refreshes, so a bare change reaches only the meshes
 * that happen to refresh that frame. Both factors are render-group uniforms —
 * a shared buffer three.js updates once per render — so intensity and the sky's
 * brightness reach every lit mesh the same frame with no per-object refresh.
 */

import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import { pmremTexture, uniform, renderGroup, float } from "three/tsl";
import type { SkyProvider } from "../../components/sky/SkyProvider";
import type { WaterSceneConfig } from "../../config/presets/types";
import type { WaterSubsystem } from "../types";

export class Environment implements WaterSubsystem {
  private readonly _scene: THREE.Scene;
  /**
   * The user's IBL trim, multiplied into `scene.environmentNode`. A render-
   * group uniform so a change reaches every lit mesh the same frame; the sky's
   * brightness node is the other factor, composed in {@link _installEnvironment}.
   */
  private readonly _intensity = uniform(1.0).setGroup(renderGroup);
  private _activeSky: SkyProvider | null = null;
  private _envTexture: THREE.Texture | null = null;

  /**
   * Fired when the active provider replaces the texture behind
   * `getEnvironmentTexture()` (e.g. a quality-tier change rebuilds its bake
   * target). `WaterSystem.create` wires this to rerun the full `setSky`
   * rebind: compiled shader graphs captured the old texture at build time,
   * so reassigning the environment node alone would leave the water material's
   * reflection sampler pointing at a destroyed texture.
   */
  public onEnvironmentTextureChanged: (() => void) | null = null;

  constructor(scene: THREE.Scene) {
    this._scene = scene;
  }

  /**
   * Scene IBL intensity — scales the environment lighting on every lit mesh
   * (floor, ships, buoys). A trim on top of the active sky's own brightness,
   * which is folded in automatically so a dimmer sky lights solid objects
   * less, matching its dimmer reflections. Default `1.0`.
   */
  get intensity(): number {
    return this._intensity.value;
  }

  set intensity(value: number) {
    this._intensity.value = value;
  }

  applyParams(params: WaterSceneConfig): void {
    this.intensity = params.environment.intensity;
  }

  /**
   * Point `scene.environmentNode` at the provider's prefiltered environment
   * and swap its backdrop meshes into the scene. The previous provider's
   * meshes are removed first, so a provider swap is a single `setSky` call
   * with no app-side mesh bookkeeping.
   */
  onSkyChanged(sky: SkyProvider | null): void {
    if (this._activeSky) {
      for (const mesh of this._activeSky.getMeshes()) {
        this._scene.remove(mesh);
      }
    }
    if (sky) {
      for (const mesh of sky.getMeshes()) {
        this._scene.add(mesh);
      }
    }
    this._activeSky = sky;
    this._installEnvironment();
  }

  /**
   * Watches the provider's environment texture by reference. `_envTexture` is
   * the texture the current node was built from, so any difference means the
   * provider rebuilt its texture and every captured sampler is stale.
   */
  step(): void {
    if (!this._activeSky) return;
    if (this._activeSky.getEnvironmentTexture() !== this._envTexture) {
      this.onEnvironmentTextureChanged?.();
    }
  }

  dispose(): void {
    if (this._activeSky) {
      for (const mesh of this._activeSky.getMeshes()) {
        this._scene.remove(mesh);
      }
      this._activeSky = null;
    }
    this._scene.environment = null;
    this._scene.environmentNode = null;
    this._envTexture = null;
  }

  /**
   * Build the environment lighting node from the active sky's prefiltered
   * texture, scaled by the intensity trim and the sky's brightness node.
   * Rebuilding it with a new texture (on a provider swap) changes the node's
   * cache key, forcing every lit mesh to recompile against the new bake — the
   * reliable path for a texture swap. `scene.environment` is kept in sync for
   * any consumer that reads the raw texture; the node takes precedence for
   * lighting.
   */
  private _installEnvironment(): void {
    if (!this._activeSky) {
      this._scene.environment = null;
      this._scene.environmentNode = null;
      this._envTexture = null;
      return;
    }
    const texture = this._activeSky.getEnvironmentTexture();
    const brightness: Node = this._activeSky.getBrightnessNode?.() ?? float(1.0);
    this._envTexture = texture;
    this._scene.environment = texture;
    this._scene.environmentNode = pmremTexture(texture)
      .mul(this._intensity)
      .mul(brightness);
  }
}
