/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {DataTexture, FloatType, LinearSRGBColorSpace, NearestFilter, NoColorSpace, RGBAFormat, ShaderMaterial, UnsignedByteType, WebGLRenderer, WebGLRenderTarget} from 'three';
import {DenoiseMaterial} from 'three-gpu-pathtracer';
import {PathTracingRenderer} from 'three-gpu-pathtracer/src/core/PathTracingRenderer.js';
import {PhysicalPathTracingMaterial} from 'three-gpu-pathtracer/src/materials/pathtracing/PhysicalPathTracingMaterial.js';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

const replaceOnce = (
    source: string, needle: string, next: string, label: string): string => {
  const at = source.indexOf(needle);
  if (at < 0) {
    throw new Error('surface bake patch missed ' + label);
  }
  if (source.indexOf(needle, at + needle.length) >= 0) {
    throw new Error('surface bake patch ambiguous ' + label);
  }
  return source.slice(0, at) + next + source.slice(at + needle.length);
};

/**
 * Same path-tracing shader the shadow view runs. ldBake 0 keeps the
 * camera ray. ldBake 1 starts that ray just outside a texel. The hit,
 * BSDF, BVH and bounces are untouched library code.
 */
export const installSurfaceBake = (material: PhysicalPathTracingMaterial) => {
  if (material.fragmentShader.includes('uniform int ldBake;')) {
    return;
  }
  material.fragmentShader = replaceOnce(
      material.fragmentShader,
      'void main() {',
      `uniform sampler2D ldPosition;
uniform sampler2D ldNormal;
uniform int ldBake;
void main() {`,
      'uniforms');
  material.fragmentShader = replaceOnce(
      material.fragmentShader,
      'Ray ray = getCameraRay();',
      `Ray ray;
					if ( ldBake == 1 ) {
						vec4 ldPos = texture2D( ldPosition, vUv );
						if ( ldPos.w < 0.5 ) {
							gl_FragColor = vec4( 0.0 );
							return;
						}
						vec3 ldN = normalize( texture2D( ldNormal, vUv ).xyz );
						// Just outside the surface, aimed back at it, so the
						// library shades that hit the same way a camera ray would.
						ray.origin = ldPos.xyz + ldN * 0.02;
						ray.direction = - ldN;
					} else {
						ray = getCameraRay();
					}`,
      'camera ray');
  material.uniforms.ldPosition = {value: null};
  material.uniforms.ldNormal = {value: null};
  material.uniforms.ldBake = {value: 0};
  material.needsUpdate = true;
};

/** A failed float readback used to become 0.0001 and blank the shadow. */
export const usableFactorScale = (value: number): number =>
    value > 0.02 && value < 8 ? value : 1;

/**
 * Blits a float path-tracer target to RGBA8. ANGLE Metal returns zeros from
 * readPixels of a 32-bit float target; 8-bit readback does not.
 */
export class FactorEncoder {
  private byteTarget: WebGLRenderTarget|null = null;
  private quad: FullScreenQuad|null = null;

  encode(
      gl: WebGLRenderer, source: WebGLRenderTarget, width: number,
      height: number): Uint8Array {
    if (this.byteTarget == null || this.byteTarget.width !== width ||
        this.byteTarget.height !== height) {
      this.byteTarget?.dispose();
      this.byteTarget = new WebGLRenderTarget(width, height, {
        type: UnsignedByteType,
        format: RGBAFormat,
        depthBuffer: false,
      });
    }
    if (this.quad == null) {
      this.quad = new FullScreenQuad(new ShaderMaterial({
        uniforms: {tDiffuse: {value: null}},
        vertexShader: `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D tDiffuse;
          varying vec2 vUv;
          void main() {
            vec4 sample = texture2D(tDiffuse, vUv);
            gl_FragColor = vec4(
                clamp(sample.rgb, 0.0, 1.0),
                sample.a > 0.5 ? 1.0 : 0.0);
          }
        `,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }));
    }
    const material = this.quad.material as ShaderMaterial;
    source.texture.colorSpace = LinearSRGBColorSpace;
    material.uniforms.tDiffuse.value = source.texture;
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(this.byteTarget);
    this.quad.render(gl);
    gl.setRenderTarget(previous);
    const bytes = new Uint8Array(width * height * 4);
    gl.readRenderTargetPixels(this.byteTarget, 0, 0, width, height, bytes);
    return bytes;
  }

  dispose() {
    this.byteTarget?.dispose();
    this.byteTarget = null;
    this.quad?.dispose();
    this.quad = null;
  }
}

const KEEP_UNIFORM = new Set([
  'resolution', 'seed', 'opacity', 'cameraWorldMatrix', 'invProjectionMatrix',
  'physicalCamera', 'sobolTexture', 'stratifiedTexture',
  'stratifiedOffsetTexture', 'ldPosition', 'ldNormal', 'ldBake',
]);

/** Copy the live scene uniforms onto the atlas material. The view stays stock. */
export const sharePathTracerScene = (
    source: PhysicalPathTracingMaterial,
    dest: PhysicalPathTracingMaterial) => {
  for (const key of Object.keys(source.uniforms)) {
    if (KEEP_UNIFORM.has(key) || dest.uniforms[key] == null) {
      continue;
    }
    dest.uniforms[key].value = source.uniforms[key].value;
  }
  dest.bounces = source.bounces;
  dest.transmissiveBounces = source.transmissiveBounces;
  dest.filterGlossyFactor = 0;
  for (const key of Object.keys(source.defines)) {
    if (key.startsWith('FEATURE_') || key === 'RANDOM_TYPE') {
      dest.setDefine(key, source.defines[key]);
    }
  }
};

export type SurfaceBakePass = 'front'|'back'|'open';

/**
 * Atlas samples of the shadow view's path tracer. The renderer is given
 * that material, so the bake cannot drift onto a second shader.
 */
export class SurfaceFactorBake {
  private readonly renderer: PathTracingRenderer;
  private readonly position: DataTexture;
  private readonly normal: DataTexture;
  private resolution = 1;
  private frontNormal = new Float32Array(4);
  private denoised: WebGLRenderTarget|null = null;
  private denoiseMaterial: DenoiseMaterial|null = null;
  private denoiseQuad: FullScreenQuad|null = null;
  private readonly encoder = new FactorEncoder();
  mask: Uint8Array;

  constructor(
      gl: WebGLRenderer,
      private readonly source: PhysicalPathTracingMaterial,
  ) {
    this.renderer = new PathTracingRenderer(gl);
    this.renderer.tiles.set(1, 1);
    this.renderer.stableTiles = true;
    // Own copy of the shader. The camera view keeps the stock material so a
    // bake uniform cannot blank it.
    installSurfaceBake(this.renderer.material);
    this.position = new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType);
    this.normal = new DataTexture(new Float32Array(4), 1, 1, RGBAFormat, FloatType);
    for (const texture of [this.position, this.normal]) {
      texture.colorSpace = NoColorSpace;
      texture.minFilter = NearestFilter;
      texture.magFilter = NearestFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
    }
    this.mask = new Uint8Array(1);
    const material = this.renderer.material;
    material.uniforms.ldPosition.value = this.position;
    material.uniforms.ldNormal.value = this.normal;
    material.uniforms.ldBake.value = 1;
  }

  get samples(): number {
    return this.renderer.samples;
  }

  setSurfaces(surface: Float32Array, count: number, resolution: number) {
    this.resolution = resolution;
    const texels = resolution * resolution;
    const position = new Float32Array(texels * 4);
    const normal = new Float32Array(texels * 4);
    this.mask = new Uint8Array(texels);
    for (let i = 0; i < count; i++) {
      const o = i * 8;
      const x = Math.min(resolution - 1, Math.max(0, Math.floor(surface[o + 6] * resolution)));
      const y = Math.min(resolution - 1, Math.max(0, Math.floor(surface[o + 7] * resolution)));
      const slot = y * resolution + x;
      if (this.mask[slot] === 1) {
        continue;
      }
      this.mask[slot] = 1;
      position[slot * 4] = surface[o];
      position[slot * 4 + 1] = surface[o + 1];
      position[slot * 4 + 2] = surface[o + 2];
      position[slot * 4 + 3] = 1;
      normal[slot * 4] = surface[o + 3];
      normal[slot * 4 + 1] = surface[o + 4];
      normal[slot * 4 + 2] = surface[o + 5];
      normal[slot * 4 + 3] = 1;
    }
    this.frontNormal = normal.slice();
    this.position.image = {data: position, width: resolution, height: resolution};
    this.normal.image = {data: normal, width: resolution, height: resolution};
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
    this.renderer.setSize(resolution, resolution);
    this.setPass('front');
  }

  setPass(pass: SurfaceBakePass) {
    const material = this.renderer.material;
    material.uniforms.ldBake.value = 1;
    const data = this.normal.image.data as Float32Array;
    const sign = pass === 'back' ? -1 : 1;
    for (let i = 0; i < this.mask.length; i++) {
      if (this.mask[i] !== 1) {
        continue;
      }
      data[i * 4] = this.frontNormal[i * 4] * sign;
      data[i * 4 + 1] = this.frontNormal[i * 4 + 1] * sign;
      data[i * 4 + 2] = this.frontNormal[i * 4 + 2] * sign;
    }
    this.normal.needsUpdate = true;
    this.renderer.reset();
  }

  step(): number {
    sharePathTracerScene(this.source, this.renderer.material);
    this.renderer.material.uniforms.ldBake.value = 1;
    const before = this.renderer.samples;
    this.renderer.update();
    if (this.renderer.samples === before && !this.renderer.isCompiling) {
      this.renderer.update();
    }
    return this.renderer.samples;
  }

  /** The path tracer's own denoise, applied once the few shadow samples are in. */
  denoise(gl: WebGLRenderer) {
    const source = this.renderer.target;
    if (this.denoised == null || this.denoised.width !== this.resolution) {
      this.denoised?.dispose();
      this.denoised = new WebGLRenderTarget(this.resolution, this.resolution, {
        type: FloatType,
        format: RGBAFormat,
        depthBuffer: false,
      });
    }
    if (this.denoiseMaterial == null) {
      this.denoiseMaterial = new DenoiseMaterial({
        sigma: 10,
        kSigma: 2,
        threshold: 0.35,
      });
      this.denoiseQuad = new FullScreenQuad(this.denoiseMaterial);
    }
    source.texture.colorSpace = LinearSRGBColorSpace;
    this.denoiseMaterial.map = source.texture;
    const previous = gl.getRenderTarget();
    gl.setRenderTarget(this.denoised);
    this.denoiseQuad!.render(gl);
    gl.setRenderTarget(previous);
  }

  read(gl: WebGLRenderer): Float32Array {
    const resolution = this.resolution;
    const source = this.denoised ?? this.renderer.target;
    const bytes = this.encoder.encode(gl, source, resolution, resolution);
    const value = new Float32Array(resolution * resolution);
    value.fill(-1);
    let peak = 0;
    for (let i = 0; i < value.length; i++) {
      if (this.mask[i] !== 1) {
        continue;
      }
      const sample = (bytes[i * 4] + bytes[i * 4 + 1] + bytes[i * 4 + 2]) / (3 * 255);
      value[i] = sample;
      if (sample > peak) {
        peak = sample;
      }
    }
    if (!(peak > 0)) {
      console.warn(
          '[model-viewer] Shadow bake readback is black. The GPU path did not return texels.');
    }
    return value;
  }

  dispose() {
    this.position.dispose();
    this.normal.dispose();
    this.denoised?.dispose();
    this.denoiseQuad?.dispose();
    this.denoiseMaterial?.dispose();
    this.encoder.dispose();
    this.renderer.dispose();
  }
}

/** Bright texels are the open faces. Their level is the unoccluded divisor. */
export const openLevel = (value: Float32Array): number => {
  const samples: number[] = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] >= 0) {
      samples.push(value[i]);
    }
  }
  if (samples.length === 0) {
    return 1;
  }
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] > peak) {
      peak = samples[i];
    }
  }
  // A float readback that came back empty must not become a 0.0001 divisor.
  if (!(peak > 0.02)) {
    return 1;
  }
  samples.sort((a, b) => a - b);
  // Skip the brightest spikes. Open faces sit in the band under them.
  const start = Math.floor(samples.length * 0.6);
  const end = Math.max(start + 1, Math.floor(samples.length * 0.85));
  let sum = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    sum += samples[i];
    count++;
  }
  return count > 0 ? sum / count : 1;
};
