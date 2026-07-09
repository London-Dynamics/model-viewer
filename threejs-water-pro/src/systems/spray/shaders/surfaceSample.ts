/**
 * Shared displaced-surface sampling for the spray compute shaders.
 *
 * Both emission and simulate need the same combined FFT + Gerstner
 * displacement at a given world XZ, and both apply the same one-step
 * Newton correction for horizontal displacement (FFT/Gerstner at (X, Z)
 * returns the offset of the surface element that *originated* at (X, Z);
 * the visible surface height at (X, Z) is the dy of the element whose
 * displaced XZ lands there). Centralised here so the two compute shaders
 * stay in lock-step.
 */

import { computeGerstner } from "../../../shaders/gerstner";
import type { CascadeSampler } from "../../../shaders/cascadeSampler";
import type {
  FloatNode,
  Node,
  StorageBufferNode,
  UniformFloatNode,
} from "../../../shaders/types";
import type { TSLUniformNode } from "../../../types/tsl";

/** Gerstner wave bindings shared with the surface material. */
export interface SprayGerstnerBindings {
  waveBuffer: Node;
  waveCount: Node;
  time: Node;
  maxWaves: number;
}

/** Bindings required to sample the displaced surface inside a spray compute. */
export interface SurfaceSampleBindings {
  /** Shared cascade sampler (single source of truth for scale/resolution). */
  cascadeSampler: CascadeSampler;
  /** Cascade-0 displacement buffer. */
  displacementBuffer0: StorageBufferNode;
  /** Cascade-1 displacement buffer (optional). */
  displacementBuffer1?: StorageBufferNode;
  /** Gerstner wave bindings, or null if Gerstner is disabled. */
  gerstner: SprayGerstnerBindings | null;
}

/** XYZ displacement at a world XZ. */
export interface SurfaceDisplacement {
  dx: Node;
  dy: Node;
  dz: Node;
}

/**
 * Build a closure that returns the combined FFT + Gerstner displacement at
 * a given world XZ. Used as a primitive by `createSurfaceHeightSampler`
 * and directly by callers that need the raw displacement vector.
 */
export function createDisplacementSampler(
  bindings: SurfaceSampleBindings,
): (worldX: FloatNode, worldZ: FloatNode) => SurfaceDisplacement {
  const { cascadeSampler, displacementBuffer0, displacementBuffer1, gerstner } =
    bindings;

  return (worldX, worldZ) => {
    const fft = cascadeSampler.sampleDisplacement(
      worldX,
      worldZ,
      displacementBuffer0,
      displacementBuffer1,
    );
    let dx: Node = fft.displacement.x;
    let dy: Node = fft.displacement.y;
    let dz: Node = fft.displacement.z;

    if (gerstner) {
      const g = computeGerstner({
        worldX,
        worldZ,
        time: gerstner.time as TSLUniformNode,
        waveBuffer: gerstner.waveBuffer,
        waveCount: gerstner.waveCount as TSLUniformNode,
        maxWaves: gerstner.maxWaves,
      });
      dx = dx.add(g.displacement.x);
      dy = dy.add(g.displacement.y);
      dz = dz.add(g.displacement.z);
    }
    return { dx, dy, dz };
  };
}

/**
 * Build a closure that returns the displaced surface height at a given
 * world XZ. Performs one Newton step against the horizontal displacement
 * so the returned `surfaceY` matches the visible surface at (X, Z) rather
 * than the height of the element that originated there.
 */
export function createSurfaceHeightSampler(
  bindings: SurfaceSampleBindings,
  meanY: UniformFloatNode,
): (worldX: FloatNode, worldZ: FloatNode) => FloatNode {
  const sampleDisplacement = createDisplacementSampler(bindings);

  return (worldX, worldZ) => {
    const pass1 = sampleDisplacement(worldX, worldZ);
    const correctedX = (worldX as Node).sub(pass1.dx) as FloatNode;
    const correctedZ = (worldZ as Node).sub(pass1.dz) as FloatNode;
    const pass2 = sampleDisplacement(correctedX, correctedZ);
    return meanY.add(pass2.dy) as FloatNode;
  };
}
