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

import {DataTexture, FloatType, LinearSRGBColorSpace, NearestFilter, NoColorSpace, RGBAFormat, WebGLRenderer, WebGLRenderTarget} from 'three';
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
      'int traceScene(',
      `uniform sampler2D ldPosition;
uniform sampler2D ldNormal;
uniform int ldBake;
uniform int ldUnoccluded;
int ldPrimaryDone = 0;
int traceScene(`,
      'traceScene');
  material.fragmentShader = replaceOnce(
      material.fragmentShader,
      'int result = NO_HIT;',
      `if ( ldUnoccluded == 1 && ldPrimaryDone == 1 ) {
			surfaceHit.dist = 1e20;
			return NO_HIT;
		}
		int result = NO_HIT;`,
      'unoccluded miss');
  material.fragmentShader = replaceOnce(
      material.fragmentShader,
      'Ray ray = getCameraRay();',
      `Ray ray;
					ldPrimaryDone = 0;
					if ( ldBake == 1 ) {
						vec4 ldPos = texelFetch( ldPosition, ivec2( gl_FragCoord.xy ), 0 );
						if ( ldPos.w < 0.5 ) {
							gl_FragColor = vec4( 0.0 );
							return;
						}
						vec3 ldN = normalize( texelFetch( ldNormal, ivec2( gl_FragCoord.xy ), 0 ).xyz );
						ray.origin = ldPos.xyz + ldN * 0.01;
						ray.direction = - ldN;
					} else {
						ray = getCameraRay();
					}`,
      'camera ray');
  material.fragmentShader = replaceOnce(
      material.fragmentShader,
      'int hitType = traceScene( ray, state.fogMaterial, surfaceHit );',
      `int hitType = traceScene( ray, state.fogMaterial, surfaceHit );
						if ( i == 0 ) ldPrimaryDone = 1;`,
      'primary done');
  material.uniforms.ldPosition = {value: null};
  material.uniforms.ldNormal = {value: null};
  material.uniforms.ldBake = {value: 0};
  material.uniforms.ldUnoccluded = {value: 0};
  material.needsUpdate = true;
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
  mask: Uint8Array;

  constructor(gl: WebGLRenderer, source: PhysicalPathTracingMaterial) {
    this.renderer = new PathTracingRenderer(gl);
    this.renderer.tiles.set(1, 1);
    this.renderer.stableTiles = true;
    installSurfaceBake(source);
    const discarded = this.renderer.material;
    this.renderer.material = source;
    if (discarded !== source) {
      discarded.dispose();
    }
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
    material.uniforms.ldUnoccluded.value = 0;
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
    material.uniforms.ldUnoccluded.value = pass === 'open' ? 1 : 0;
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
    const pixels = new Float32Array(resolution * resolution * 4);
    const target = this.denoised ?? this.renderer.target;
    gl.readRenderTargetPixels(target, 0, 0, resolution, resolution, pixels);
    const value = new Float32Array(resolution * resolution);
    value.fill(-1);
    for (let i = 0; i < value.length; i++) {
      if (this.mask[i] !== 1) {
        continue;
      }
      value[i] = (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3;
    }
    return value;
  }

  dispose() {
    this.position.dispose();
    this.normal.dispose();
    this.denoised?.dispose();
    this.denoiseQuad?.dispose();
    this.denoiseMaterial?.dispose();
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
