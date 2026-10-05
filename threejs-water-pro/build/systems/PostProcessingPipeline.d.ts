/**
 * Post-processing pipeline.
 *
 * Owns two related concerns:
 *
 * 1. **Node-graph composition.** The hard-coded chain
 *    `underwater → screen-space caustics → sun shafts → rain`
 *    that produces the final TSL output node for Three.js post-processing.
 *    (Atmospheric fog is not a pass — it applies per material via
 *    `scene.fogNode`, so it is already in the scene colour.)
 *    Exposed as {@link buildNode}.
 *
 * 2. **Per-frame conditional pass gating.** Which of the screen-space
 *    setup passes (depth, mask, scene colour, water depth, sun shaft,
 *    SSR G-buffer, SSR ray march) actually run on a given frame depends
 *    on which post-processing effects are enabled and whether the
 *    camera is underwater. Exposed as {@link renderPass}.
 *
 * Both methods read state from the consumer subsystems directly, so
 * `WaterSystem` does not need to thread enabled-flags through.
 */
import type * as THREE from "three/webgpu";
import type { Node, PassNode } from "three/webgpu";
import type { Underwater } from "../rendering/postprocessing";
import type { UnderwaterDistortion } from "../shaders/underwaterDistortion";
import type { SunShafts } from "../shaders/sunShafts";
import type { SSR } from "../shaders/ssr";
import type { RainSystem } from "./rain/RainSystem";
import type { RenderPassManager } from "../rendering/RenderPassManager";
import type { WaterSubsystem } from "./types";
/**
 * Fixed set of refs the pipeline composes and gates. The pipeline does
 * not own any of these — `WaterSystem` does — but it is the single
 * place that knows how to wire them into a render-pass schedule and a
 * TSL node-graph chain.
 */
export interface PostProcessingPipelineRefs {
    rainSystem: RainSystem;
    rpm: RenderPassManager;
    ssr: SSR;
    sunShafts: SunShafts;
    underwater: Underwater;
    underwaterDistortion: UnderwaterDistortion;
}
export declare class PostProcessingPipeline implements WaterSubsystem {
    private readonly _refs;
    constructor(refs: PostProcessingPipelineRefs);
    /**
     * Build the TSL node graph that applies the water system's
     * post-processing effects to a scene pass.
     *
     * Call once during post-processing setup and pass the result to your
     * `postProcessing.outputNode = ...`. The returned node chains live
     * uniform references — UI tweaks propagate without rebuilding.
     *
     * Order is fixed: underwater fog picks above/below water per fragment
     * (atmospheric fog is already in the scene colour — it applies per
     * material via `scene.fogNode`), sun shafts composite on top, and rain
     * composites last so the streaks layer above everything else but below
     * the user's downstream effects. Caustics are baked into the ocean-floor
     * material itself, so they're already in the scene colour and need no
     * post-process layer.
     *
     * @param scenePass - The Three.js post-processing scene pass.
     * @param inputColor - Optional input colour to chain after. Defaults
     *   to the scene pass's output texture.
     */
    buildNode(scenePass: PassNode, inputColor?: Node): Node;
    /**
     * Fire the per-displayed-frame render passes that prepare the
     * textures sampled by the post-processing chain and the water
     * material's surface composition. Hooked into the {@link WaterSubsystem}
     * `renderPass` slot so `WaterSystem` iterates it through the registry.
     *
     * - **Scene capture** always runs — the water material samples its
     *   depth for shoreline alpha fade and its colour for refraction; the
     *   transparent sub-passes run only when underwater is enabled (only
     *   the fog decomposition consumes them).
     * - **Mask pass** runs only when at least one masking object is
     *   registered with the render pass manager.
     * - **Water depth pass** always runs — the surface refraction samples
     *   it for the refracted column's surface depth, and the underwater fog
     *   for per-pixel submersion.
     * - **Sun shaft pass** is delegated to `SunShafts.renderPass`, which
     *   self-gates on its own enabled flag plus the underwater state.
     * - **SSR G-buffer + SSR pass** — both draws are skipped when SSR is
     *   disabled. The persistent result target is cleared once on the
     *   enabled-to-disabled transition (and after resize), then left untouched.
     */
    renderPass(renderer: THREE.WebGPURenderer): Promise<void>;
    dispose(): void;
}
//# sourceMappingURL=PostProcessingPipeline.d.ts.map