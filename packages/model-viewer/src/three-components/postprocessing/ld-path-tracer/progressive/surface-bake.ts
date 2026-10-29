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

import {DataTexture, FloatType, NearestFilter, NoColorSpace, RGBAFormat, WebGLRenderer} from 'three';
import {PathTracingRenderer} from 'three-gpu-pathtracer/src/core/PathTracingRenderer.js';
import {PhysicalPathTracingMaterial} from 'three-gpu-pathtracer/src/materials/pathtracing/PhysicalPathTracingMaterial.js';

const KEEP_UNIFORM = new Set([
  'resolution',
  'seed',
  'opacity',
  'cameraWorldMatrix',
  'invProjectionMatrix',
  'physicalCamera',
  'sobolTexture',
  'stratifiedTexture',
  'stratifiedOffsetTexture',
  'ldPosition',
  'ldNormal',
  'ldBake',
  'ldUnoccluded',
]);

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
 * The bake is the path tracer's own shader. The first ray starts just
 * outside the texel and aims back at it, so the hit, the BSDF and the
 * bounces are the library code. A second pass disables hits after that
 * first surface so the result can be divided by the unoccluded value.
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
 * One sample of the path tracer per texel. `front` and `back` are the two
 * hemispheres. `open` is the same rays with the scene ignored after the
 * first hit, which is the unoccluded divisor.
 */
export class SurfaceFactorBake {
  private readonly renderer: PathTracingRenderer;
  private readonly position: DataTexture;
  private readonly normal: DataTexture;
  private resolution = 1;
  private frontNormal = new Float32Array(4);
  mask: Uint8Array;

  constructor(
      gl: WebGLRenderer,
      private readonly source: PhysicalPathTracingMaterial,
  ) {
    this.renderer = new PathTracingRenderer(gl);
    this.renderer.tiles.set(1, 1);
    this.renderer.stableTiles = true;
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
    sharePathTracerScene(this.source, this.renderer.material);
    const before = this.renderer.samples;
    this.renderer.update();
    if (this.renderer.samples === before && !this.renderer.isCompiling) {
      this.renderer.update();
    }
    return this.renderer.samples;
  }

  read(gl: WebGLRenderer): Float32Array {
    const resolution = this.resolution;
    const pixels = new Float32Array(resolution * resolution * 4);
    const target = this.renderer.target;
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
    this.renderer.dispose();
  }
}

/** Copy the nearest written texel into empty gutter pixels. Written texels stay. */
export const dilateFactor = (
    value: Float32Array, resolution: number, radius: number): Float32Array => {
  let current = value;
  for (let pass = 0; pass < radius; pass++) {
    const next = current.slice();
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const idx = y * resolution + x;
        if (current[idx] >= 0) {
          continue;
        }
        for (let ky = -1; ky <= 1 && next[idx] < 0; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const sx = x + kx;
            const sy = y + ky;
            if (sx < 0 || sy < 0 || sx >= resolution || sy >= resolution) {
              continue;
            }
            const neighbor = current[sy * resolution + sx];
            if (neighbor >= 0) {
              next[idx] = neighbor;
              break;
            }
          }
        }
      }
    }
    current = next;
  }
  return current;
};

export const meanFactor = (value: Float32Array): number => {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    if (value[i] >= 0) {
      sum += value[i];
      count++;
    }
  }
  return count > 0 ? sum / count : 1;
};
