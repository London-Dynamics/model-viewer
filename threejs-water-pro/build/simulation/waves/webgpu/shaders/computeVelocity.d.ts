import type { TSLBuffer, TSLUniformNode } from "../../../../types/tsl";
export interface VelocityShaderParams {
    displacementBuffer: TSLBuffer;
    prevDisplacementBuffer: TSLBuffer;
    velocityBuffer: TSLBuffer;
    deltaTime: TSLUniformNode;
    resolution: number;
}
export declare const createVelocityShader: ({ displacementBuffer, prevDisplacementBuffer, velocityBuffer, deltaTime, resolution, }: VelocityShaderParams) => import("three/webgpu").ComputeNode;
//# sourceMappingURL=computeVelocity.d.ts.map