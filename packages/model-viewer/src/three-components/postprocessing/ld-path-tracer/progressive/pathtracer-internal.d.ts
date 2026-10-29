declare module 'three-gpu-pathtracer/src/materials/pathtracing/PhysicalPathTracingMaterial.js' {
  import {ShaderMaterial} from 'three';

  export class PhysicalPathTracingMaterial extends ShaderMaterial {
    bounces: number;
    transmissiveBounces: number;
    filterGlossyFactor: number;
    setDefine(name: string, value?: number|string): boolean;
  }
}

declare module 'three-gpu-pathtracer/src/core/PathTracingRenderer.js' {
  import {Vector2, WebGLRenderer, WebGLRenderTarget} from 'three';

  import {PhysicalPathTracingMaterial} from 'three-gpu-pathtracer/src/materials/pathtracing/PhysicalPathTracingMaterial.js';

  export class PathTracingRenderer {
    constructor(renderer: WebGLRenderer);
    material: PhysicalPathTracingMaterial;
    tiles: Vector2;
    stableTiles: boolean;
    samples: number;
    isCompiling: boolean;
    target: WebGLRenderTarget;
    setSize(width: number, height: number): void;
    reset(): void;
    update(): void;
    dispose(): void;
  }
}
