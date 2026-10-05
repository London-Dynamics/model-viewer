import type * as THREE from "three/webgpu";
import type { Node, UniformNode } from "three/webgpu";
/**
 * The seam every sky implementation binds to. The built-in {@link Sky}
 * (HDRI/cubemap dome) and external providers (e.g. `threejs-sky-pro`'s
 * procedural atmosphere) both implement this, so every water-pro consumer
 * types against the interface instead of a concrete class — swapping
 * providers is a single `WaterSystem.setSky(provider)` call.
 */
export interface SkyProvider {
    /**
     * Sampler for the sharp (unfiltered) sky colour along a world direction.
     * Used to tint distant fog.
     */
    createFogSampler(): (dir: Node) => Node;
    /**
     * Sampler for the prefiltered (roughness-blurred) sky colour along a
     * reflection direction. Returns linear HDR.
     *
     * The second argument is added roughness on top of the provider's own
     * base roughness; the water surface derives it from the sub-footprint
     * wave slope variance, so unresolved waves read a blurrier mip.
     */
    createReflectionSampler(): (dir: Node, roughness: Node) => Node;
    /** Release GPU resources and scene attachments owned by the provider. */
    dispose(): void;
    /**
     * Re-center any camera-relative geometry (e.g. a dome mesh) on the
     * current camera position. Called once per substep.
     */
    followCamera(camera: THREE.Camera): void;
    /**
     * Optional live brightness multiplier the provider applies to its emitted
     * sky radiance, as a TSL node (the built-in {@link Sky}'s brightness trim).
     * The environment texture is prefiltered from the unscaled sky, so water-pro
     * multiplies this node into the environment lighting to keep solid objects
     * lit consistently with the dimmed sky and reflections. Return a render- or
     * frame-group uniform so the value reaches every lit mesh. Absent → `1`.
     */
    getBrightnessNode?(): Node;
    /**
     * The provider's environment image — the single source for
     * `scene.environment`, rough reflections, and the sky-illuminance probe.
     * A raw equirect is fine; three prefilters it internally. The returned
     * reference must be stable between genuine texture rebuilds: water-pro
     * compares it by reference each frame and reruns the full `setSky`
     * rebind when it changes (a provider that returned a fresh object every
     * call would force a shader rebuild per frame).
     */
    getEnvironmentTexture(): THREE.Texture;
    /**
     * Scene meshes the provider renders as its direct-view backdrop (e.g. a
     * dome). `setSky` owns adding/removing these; callers never touch them
     * directly. Backdrop materials must set `material.fog = false`: the scene
     * they join carries `scene.fogNode`, and fogging a backdrop by its mesh
     * position produces a bogus distance and colour.
     */
    getMeshes(): THREE.Object3D[];
    /**
     * Optional live sun state for providers that animate the sun (time of
     * day, presets). When present, water-pro's `Lighting` copies these values
     * into its own `SunUniforms` every frame; when absent, water-pro's own
     * sun params stay authoritative. Providers with a fixed, user-set sun
     * (the built-in {@link Sky}) omit this.
     */
    getSun?(): {
        color: UniformNode<THREE.Color>;
        direction: UniformNode<THREE.Vector3>;
        intensity: UniformNode<number>;
    };
    /**
     * Optional visibility gate, for providers with a render cost worth
     * cutting while nothing on screen shows sky. The app owns the call:
     * water-pro cannot make it, because submersion does not imply the sky is
     * hidden — a submerged camera still sees it above the waterline and
     * through Snell's window — and there is no cheap test for full
     * occlusion. Absent for the built-in {@link Sky}, which has nothing to
     * cut.
     */
    setActive?(visible: boolean): void;
}
//# sourceMappingURL=SkyProvider.d.ts.map