export { WakeSystem } from "./WakeSystem";
export { WakeDebugVisualizer } from "./WakeDebugVisualizer";
import * as THREE from "three/webgpu";
/**
 * Resolved per-generator injection parameters.
 *
 * Each frame, the segment the object swept (`lastWorldPos → currentWorldPos`)
 * stamps a velocity impulse into the wake field. The impulse magnitude is
 * `strength × objectSpeed`; the field's wave equation then propagates and
 * fades it. Wave speed and damping are field-global (one medium), not
 * per-generator.
 */
export interface WakeGeneratorInjectionOptions {
    /**
     * How deep (metres) the hull displaces water over its footprint. Positive;
     * the surface is pushed down by this much under the hull (and a crest of
     * displaced water rises around it). Sets the wake amplitude; does not scale
     * with speed.
     */
    depth: number;
    /**
     * Local-frame offset (metres) from the object's origin to the injection
     * point: `+Z` forward (bow), `+X` right; `Y` is ignored since the field sits
     * at the waterline. Applied through the object's world rotation, so a bow
     * offset stays at the bow as it turns. Same convention as buoyancy
     * `sampleOffset`. Register a second generator with a stern offset for a
     * bow-plus-stern wake.
     */
    offset: THREE.Vector3;
    /** Footprint radius of the hull over the swept path, in metres (sets wake width). */
    radius: number;
    /**
     * Frame-to-frame world-position deltas greater than this (in metres) are
     * treated as a teleport — no injection for that frame.
     */
    teleportThreshold: number;
}
/**
 * A wake generator — any registered object whose world motion injects a
 * disturbance into the wake field each frame. Registered via
 * {@link WakeSystem.addGenerator}.
 */
export interface WakeGenerator {
    /** Whether this generator is currently injecting. */
    active: boolean;
    /** Unique ID assigned by the system. */
    id: number;
    /** Whether the next update call is the first one for this generator. */
    isFirstFrame: boolean;
    /** World position observed on the previous update call. */
    lastWorldPos: THREE.Vector3;
    /** The Three.js object whose world position drives wake injection. */
    object: THREE.Object3D;
    /** Resolved injection parameters with defaults filled in. */
    options: WakeGeneratorInjectionOptions;
}
/** Options accepted by {@link WakeSystem.addGenerator}. */
export interface WakeGeneratorOptions extends Partial<WakeGeneratorInjectionOptions> {
    /** Whether this generator starts active. Default: true. */
    active?: boolean;
}
/** Default injection parameters applied to options not supplied at registration. */
export declare const DEFAULT_WAKE_GENERATOR_OPTIONS: WakeGeneratorInjectionOptions;
/**
 * Per-generator debug snapshot produced by {@link WakeSystem.getDebugData} and
 * rendered by {@link WakeDebugVisualizer}.
 */
export interface WakeDebugData {
    /** Generator ID. */
    id: number;
    /** World-space injection point (object position shifted by the local offset). */
    position: THREE.Vector3;
    /** Footprint radius in world metres (sets the wake width). */
    radius: number;
    /** Hull push-down depth in world metres (how far the hull displaces water). */
    depth: number;
    /** Whether the generator is currently injecting. */
    active: boolean;
}
/** Appearance configuration for {@link WakeDebugVisualizer}. */
export interface WakeDebugConfig {
    /** Radius of the injection-point marker sphere, in world metres. */
    markerSize: number;
    /** Colour of an active generator's indicator. */
    activeColor: number;
    /** Colour of an inactive generator's indicator. */
    inactiveColor: number;
    /** Segment count of the footprint-radius ring. */
    ringSegments: number;
}
//# sourceMappingURL=index.d.ts.map