/**
 * Subsystem contract.
 *
 * `WaterSystem` is a thin shell that owns time, lifecycle, preset routing,
 * a registry of subsystems, and iteration. Everything that is specific to
 * a single piece of behaviour — rain, spray, sun shafts, lighting,
 * underwater state, post-processing composition — lives behind this
 * interface. See the "Subsystem Boundaries" section of `AGENTS.md` for the
 * rule and rationale.
 *
 * All hooks are optional. A subsystem only implements the ones it cares
 * about. `WaterSystem` iterates the registry and `?.`-skips the rest.
 */
import type * as THREE from "three/webgpu";
import type { SkyProvider } from "../components/sky/SkyProvider";
import type { QualityLevel, QualityLevelConfig } from "../config/QualityLevels";
import type { WaterSceneConfig } from "../config/presets/types";
import type { RenderPassManager } from "../rendering/RenderPassManager";
import type { IWaveSimulation } from "../simulation/waves";
/**
 * The contract every water subsystem implements.
 *
 * Lifecycle: `WaterSystem` constructs the subsystem, calls `bind*` /
 * `applyParams` once, then iterates `step` and `renderPass` on every
 * frame. On a quality switch it calls `onQualityChanged`; on resize it
 * re-fires `bindDepthTextures` and (if applicable) `onRenderTargetsRebuilt`.
 *
 * Subsystems must be self-gating: a disabled subsystem's `step` / `renderPass`
 * should early-out, not depend on `WaterSystem` to skip the call.
 */
export interface WaterSubsystem {
    /**
     * Bind / re-bind any references to depth textures owned by
     * `RenderPassManager`. Called once after construction and again on
     * every `resize` and `setQualityLevel`. The render targets backing
     * these textures change identity across resize and quality switches,
     * so subsystems that cache `TextureNode` instances must rebind here.
     */
    bindDepthTextures?(rp: RenderPassManager): void;
    /**
     * Fired whenever the wave simulation's cascade configuration changes —
     * preset load, quality switch, manual cascade-config update, or a full
     * sim rebuild. The event carries no payload: subscribers pull whichever
     * cascade index, normal texture, resolution, or scale they need from
     * the simulation, which remains the source of truth.
     */
    onCascadeChanged?(sim: IWaveSimulation): void;
    /**
     * Fired when `RenderPassManager` rebuilds its non-depth render targets
     * (scene colour, SSR G-buffer, mask). Subsystems that read these
     * textures rebind here.
     */
    onRenderTargetsRebuilt?(rp: RenderPassManager): void;
    /**
     * Fired whenever `WaterSystem.setSky` installs a new sky provider (or
     * `null`). The event carries the provider itself — subscribers that need
     * to react (rebinding a material, fanning out to render passes, wiring a
     * provider's animated sun) pull whatever they need from it. Mirrors
     * {@link onCascadeChanged}'s "notify, don't push values" pattern.
     */
    onSkyChanged?(sky: SkyProvider | null): void;
    /**
     * Resize hook fired from `WaterSystem.resize`. Subsystems that own
     * render targets with their own dimensions (e.g. `SunShaftPass`)
     * implement this to resize and re-bind their output textures.
     */
    resize?(width: number, height: number): void;
    /**
     * Quality-level switch. Subsystems that own quality-dependent GPU
     * resources (compute pipelines, storage buffers) dispose and recreate
     * here. Subsystems whose resources are independent of quality no-op.
     */
    onQualityChanged?(quality: QualityLevel, config: QualityLevelConfig): Promise<void> | void;
    /**
     * Apply a full scene preset. The subsystem reads only the slice it
     * cares about; `WaterSystem` does not destructure or route per-subsystem.
     */
    applyParams?(params: WaterSceneConfig): void;
    /**
     * Per-substep simulation work. Called once per fixed-step substep in
     * deterministic mode, once per host frame otherwise. `gpuTime` is the
     * folded wave-phase time safe to push to shaders.
     */
    step?(deltaTime: number, gpuTime: number): Promise<void> | void;
    /**
     * Per-displayed-frame render-pass work. Called exactly once per frame
     * after the substep loop drains, in registry order.
     *
     * Implementations must not await real GPU work (readbacks, fences).
     * These passes must stay in the same task as the host's subsequent
     * render: a genuine event-loop yield here would let camera-mutating
     * input events (e.g. OrbitControls drag handlers) run between a capture
     * pass and the final render, misaligning every screen-space sample.
     */
    renderPass?(renderer: THREE.WebGPURenderer): Promise<void> | void;
    /**
     * Release GPU resources, listeners, and scene attachments. Optional —
     * some subsystems are pure shader / node-graph builders with no
     * resources to release.
     */
    dispose?(): void;
}
//# sourceMappingURL=types.d.ts.map