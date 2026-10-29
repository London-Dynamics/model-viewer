import {DataTexture, FloatType, GLSL3, NearestFilter, NoColorSpace, RGBAFormat, ShaderMaterial, Vector4, WebGLRenderTarget, WebGLRenderer} from 'three';
import {BVHShaderGLSL, MeshBVH, MeshBVHUniformStruct} from 'three-mesh-bvh';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

const viewport = new Vector4();
const scissor = new Vector4();

const fragmentShader = /* glsl */`
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;

#define BVH_STACK_DEPTH 90
${BVHShaderGLSL.common_functions}
${BVHShaderGLSL.bvh_struct_definitions}
${BVHShaderGLSL.bvh_ray_functions}

uniform BVH bvh;
uniform sampler2D samplePosition;
uniform sampler2D sampleNormal;
uniform float maxDistance;
uniform int sampleCount;

out vec4 fragColor;

float halton(int index, int base) {
  float f = 1.0;
  float result = 0.0;
  int i = index + 1;
  for (int n = 0; n < 12; n++) {
    if (i <= 0) {
      break;
    }
    f /= float(base);
    result += f * float(i - (i / base) * base);
    i /= base;
  }
  return result;
}

float castRays(vec3 origin, vec3 normal) {
  vec3 n = normalize(normal);
  vec3 helper = abs(n.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
  vec3 tangent = normalize(cross(helper, n));
  vec3 bitangent = cross(n, tangent);
  int occ = 0;
  int selfHits = 0;
  int count = sampleCount;
  if (count < 1) {
    count = 1;
  }
  if (count > 64) {
    count = 64;
  }
  for (int i = 0; i < 64; i++) {
    if (i >= count) {
      break;
    }
    float u = halton(i + 1, 2);
    float v = halton(i + 1, 3);
    float phi = 6.28318530718 * u;
    float cosTheta = sqrt(max(0.0, 1.0 - v));
    float sinTheta = sqrt(max(0.0, v));
    vec3 dir = tangent * (cos(phi) * sinTheta) +
        bitangent * (sin(phi) * sinTheta) + n * cosTheta;
    dir = normalize(dir);
    vec3 rayOrigin = origin + n * 0.0015;
    uvec4 faceIndices = uvec4(0u);
    vec3 faceNormal = vec3(0.0);
    vec3 bary = vec3(0.0);
    float side = 1.0;
    float dist = 1e20;
    bool hit = bvhIntersectFirstHit(
        bvh, rayOrigin, dir, faceIndices, faceNormal, bary, side, dist);
    if (!hit) {
      continue;
    }
    if (dist <= 0.003) {
      selfHits++;
      continue;
    }
    if (dist < maxDistance) {
      occ++;
    }
  }
  int valid = count - selfHits;
  if (valid <= 0) {
    return 1.0;
  }
  return 1.0 - float(occ) / float(valid);
}

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4 pos = texelFetch(samplePosition, coord, 0);
  if (pos.w < 0.5) {
    fragColor = vec4(0.0);
    return;
  }
  vec3 nrm = texelFetch(sampleNormal, coord, 0).xyz;
  // R is the geometric-normal hemisphere. G is the opposite side, which
  // the rasterizer shows on a double-sided back face.
  float front = castRays(pos.xyz, nrm);
  float back = castRays(pos.xyz, -nrm);
  fragColor = vec4(front, back, front, 1.0);
}
`;

const vertexShader = /* glsl */`
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

/**
 * One draw shades a band of atlas rows. Each fragment traces a hemisphere
 * against the BVH textures, so a texel is not a CPU raycast.
 */
export class GpuAmbientOcclusion {
  private struct: MeshBVHUniformStruct|null = null;
  private material: ShaderMaterial|null = null;
  private quad: FullScreenQuad|null = null;
  private target: WebGLRenderTarget|null = null;
  private positionTex: DataTexture|null = null;
  private normalTex: DataTexture|null = null;
  private resolution = 0;
  private row = 0;
  failed = false;

  prepare(
      bvh: MeshBVH,
      surface: Float32Array,
      surfaceCount: number,
      resolution: number,
      distance: number,
      ): boolean {
    this.dispose();
    this.failed = false;
    this.resolution = resolution;
    this.row = 0;
    try {
      this.struct = new MeshBVHUniformStruct();
      this.struct.updateFrom(bvh);
    } catch (error) {
      console.warn('[model-viewer] GPU ambient occlusion could not upload the BVH.', error);
      this.failed = true;
      this.dispose();
      return false;
    }
    const position = new Float32Array(resolution * resolution * 4);
    const normal = new Float32Array(resolution * resolution * 4);
    for (let i = 0; i < surfaceCount; i++) {
      const o = i * 8;
      const x = Math.min(resolution - 1, Math.max(0, Math.floor(surface[o + 6] * resolution)));
      const y = Math.min(resolution - 1, Math.max(0, Math.floor(surface[o + 7] * resolution)));
      const texel = (y * resolution + x) * 4;
      if (position[texel + 3] !== 0) {
        continue;
      }
      position[texel] = surface[o];
      position[texel + 1] = surface[o + 1];
      position[texel + 2] = surface[o + 2];
      position[texel + 3] = 1;
      normal[texel] = surface[o + 3];
      normal[texel + 1] = surface[o + 4];
      normal[texel + 2] = surface[o + 5];
      normal[texel + 3] = 1;
    }
    this.positionTex = this.dataTexture(position, resolution);
    this.normalTex = this.dataTexture(normal, resolution);
    this.target = new WebGLRenderTarget(resolution, resolution, {
      type: FloatType,
      format: RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.target.texture.colorSpace = NoColorSpace;
    this.material = new ShaderMaterial({
      glslVersion: GLSL3,
      uniforms: {
        bvh: {value: this.struct},
        samplePosition: {value: this.positionTex},
        sampleNormal: {value: this.normalTex},
        maxDistance: {value: distance},
        sampleCount: {value: 64},
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.material);
    return true;
  }

  /** Shade the next band of rows. True when every row has been drawn. */
  step(renderer: WebGLRenderer): boolean {
    if (this.failed || this.quad == null || this.target == null) {
      this.failed = true;
      return true;
    }
    const resolution = this.resolution;
    if (this.row >= resolution) {
      return true;
    }
    const rows = this.row === 0 ? 2 : Math.min(24, resolution - this.row);
    // setViewport multiplies by the canvas pixel ratio. The bake target is
    // already in texels, so pass CSS pixels that land on those texels.
    const ratio = renderer.getPixelRatio() || 1;
    const bandY = this.row / ratio;
    const bandH = rows / ratio;
    const bandW = resolution / ratio;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const previousScissorTest = renderer.getScissorTest();
    renderer.getViewport(viewport);
    renderer.getScissor(scissor);
    renderer.setRenderTarget(this.target);
    renderer.autoClear = false;
    if (this.row === 0) {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, bandW, resolution / ratio);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
    }
    renderer.setScissorTest(true);
    renderer.setViewport(0, bandY, bandW, bandH);
    renderer.setScissor(0, bandY, bandW, bandH);
    this.quad.render(renderer);
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    renderer.setScissorTest(previousScissorTest);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    this.row += rows;
    return this.row >= resolution;
  }

  read(renderer: WebGLRenderer): Float32Array {
    const buffer = new Float32Array(this.resolution * this.resolution * 4);
    const target = this.target;
    if (target == null) {
      return buffer;
    }
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.readRenderTargetPixels(
        target, 0, 0, this.resolution, this.resolution, buffer);
    renderer.setRenderTarget(previous);
    return buffer;
  }

  dispose() {
    this.quad?.dispose();
    this.material?.dispose();
    this.target?.dispose();
    this.positionTex?.dispose();
    this.normalTex?.dispose();
    this.struct?.dispose();
    this.quad = null;
    this.material = null;
    this.target = null;
    this.positionTex = null;
    this.normalTex = null;
    this.struct = null;
  }

  private dataTexture(data: Float32Array, resolution: number): DataTexture {
    const texture = new DataTexture(data, resolution, resolution, RGBAFormat, FloatType);
    texture.colorSpace = NoColorSpace;
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.needsUpdate = true;
    return texture;
  }
}
