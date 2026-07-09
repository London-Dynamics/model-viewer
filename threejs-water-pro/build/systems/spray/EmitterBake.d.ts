/**
 * Authored probe bake for spray emitters.
 *
 * Each probe is a hand-placed emission point on the registered object,
 * specified in object-local space. The bake is a trivial pack of the
 * probe data into Float32Arrays uploaded once at registration; the
 * emission compute reads them per frame.
 *
 * The probe pattern is documented in production AAA water tech — see e.g.
 * Wronski's GDC 2014 *Assassin's Creed IV: Black Flag — Road to Next-Gen
 * Graphics* talk and the developer explanation summarized in
 * https://simonschreibt.de/gat/black-flag-waterplane/
 * (where buoyancy probe spheres on the ship measure local velocity and
 * trigger sized particle splashes).
 */
import * as THREE from "three/webgpu";
/**
 * Per-emitter / per-probe tunables. Every spray parameter that can vary
 * between bursts lives here. Both {@link AddEmitterOptions} (extends
 * `Partial<EmitterParams>`) and {@link SprayProbe} (extends
 * `Partial<EmitterParams>`) accept any subset as overrides; resolution
 * order at registration is `defaults → emitter → probe` (probe wins).
 *
 * Excludes the master toggle (lives on `SpraySystem.enabled`) and the
 * per-emitter `active` flag (lives on the state buffer).
 */
export interface EmitterParams {
    /** Bottom-fade start (0–1, billboard-vertical). Alpha = 0 below this height. */
    bottomFadeStart: number;
    /** Bottom-fade stop (0–1, billboard-vertical). Alpha = 1 at and above this height. */
    bottomFadeStop: number;
    /** Maximum particle lifetime in seconds. */
    duration: number;
    /** Length of the alpha fade-out tail (s), measured backwards from death. */
    fadeOutTime: number;
    /** Opacity multiplier (0–1). */
    opacity: number;
    /** Extra cooldown (s) on top of `duration + jitter` between fires. */
    respawnTime: number;
    /** Base billboard side length (m). */
    size: number;
    /** Maximum random delay (s) between trigger and visible spawn. */
    spawnJitterTime: number;
    /** Width multiplier (perpendicular to up). */
    stretchX: number;
    /** Height multiplier (along up). */
    stretchY: number;
    /** Distance (m) below the displaced surface to anchor the billboard bottom. */
    submersionDepth: number;
    /** Per-particle height multiplier coefficient (frozen at spawn). */
    velocityHeightFactor: number;
    /** Per-particle uniform-scale coefficient (frozen at spawn). */
    velocityScaleFactor: number;
    /** Min relative impact speed (m/s) at the moment of crossing. */
    velocityThreshold: number;
}
/** Default per-emitter params, used when no override is supplied. */
export declare const DEFAULT_EMITTER_PARAMS: EmitterParams;
/** Frozen list of {@link EmitterParams} keys for typed iteration. */
export declare const EMITTER_PARAM_KEYS: Array<keyof EmitterParams>;
/**
 * Authored emission probe — a single object-local position with optional
 * per-probe overrides for any {@link EmitterParams} field.
 *
 * Resolution order at registration is `defaults → emitter overrides →
 * probe overrides`. The resolved values are baked into the probe's GPU
 * slot at registration. Subsequent emitter-level edits (`spray.size = …`
 * or `updateEmitter(id, { size })`) update only the keys this probe
 * **didn't** override, so a probe authored with `{ size: 50 }` keeps its
 * size of 50 even after a global `spray.size = 25` broadcast.
 */
export interface SprayProbe extends Partial<EmitterParams> {
    /**
     * Whether the probe fires. Disabled probes are kept in the buffer (so
     * indices are stable for runtime toggling) but skipped by the emission
     * compute. Default `true`.
     */
    enabled?: boolean;
    /** Position in object-local space (m). */
    local: THREE.Vector3;
}
export interface BakedProbes {
    /** Number of valid probes packed. */
    count: number;
    /** Per-probe initial enabled flag (1 = enabled, 0 = disabled). */
    enabled: Uint8Array;
    /**
     * Per-probe param overrides extracted from the source `SprayProbe`s.
     * Length === `count`. Empty objects mean the probe inherits everything
     * from the emitter / system defaults.
     */
    overrides: Array<Partial<EmitterParams>>;
    /** Object-local positions, packed `[x0, y0, z0, x1, y1, z1, ...]`. */
    positions: Float32Array;
}
/** Pack authored probes into the float array the emission compute expects. */
export declare function bakeFromProbes(probes: ReadonlyArray<SprayProbe>): BakedProbes;
//# sourceMappingURL=EmitterBake.d.ts.map