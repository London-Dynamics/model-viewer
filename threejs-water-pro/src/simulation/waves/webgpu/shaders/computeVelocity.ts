/**
 * Surface velocity compute shader.
 *
 * Runs once per cascade per frame, after the FFT has written the current
 * displacement buffer and before the normals pass. For each texel:
 *
 *   velocity[idx] = (displacement[idx] - prevDisplacement[idx]) / deltaTime
 *   prevDisplacement[idx] = displacement[idx]
 *
 * The velocity is the per-texel world-space surface motion (m/s) — the time
 * derivative of the full displacement vector. Consumers (e.g., wave spray)
 * can sample it bilinearly at any world position to get the orbital velocity
 * of a water particle at that point.
 *
 * A small deltaTime floor prevents division-by-zero on the first frame.
 */
import { Fn, instanceIndex, vec4 } from "three/tsl";
import type { TSLBuffer, TSLUniformNode } from "../../../../types/tsl";

export interface VelocityShaderParams {
  displacementBuffer: TSLBuffer;
  prevDisplacementBuffer: TSLBuffer;
  velocityBuffer: TSLBuffer;
  deltaTime: TSLUniformNode;
  resolution: number;
}

export const createVelocityShader = ({
  displacementBuffer,
  prevDisplacementBuffer,
  velocityBuffer,
  deltaTime,
  resolution,
}: VelocityShaderParams) => {
  return Fn(() => {
    const idx = instanceIndex;

    const curr = displacementBuffer.element(idx);
    const prev = prevDisplacementBuffer.element(idx);

    // Clamp dt to avoid a divide-by-zero on the first frame (when prev is
    // uninitialized zeros, the first velocity will be a spurious huge value;
    // the clamp at least keeps it finite).
    const dt = deltaTime.max(0.001);

    const vx = curr.x.sub(prev.x).div(dt);
    const vy = curr.y.sub(prev.y).div(dt);
    const vz = curr.z.sub(prev.z).div(dt);

    velocityBuffer.element(idx).assign(vec4(vx, vy, vz, 0.0));
    prevDisplacementBuffer.element(idx).assign(curr);
  })().compute(resolution * resolution);
};
