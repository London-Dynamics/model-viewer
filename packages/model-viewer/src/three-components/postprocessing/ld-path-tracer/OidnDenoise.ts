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

import {initUNetFromURL} from 'oidn-web';

import './webgpu-types.js';
import {Camera, Color, DataTexture, FloatType, LinearFilter, LinearSRGBColorSpace, Material, Mesh, MeshBasicMaterial, MeshNormalMaterial, NoToneMapping, Object3D, RGBAFormat, Scene, Texture, UnsignedByteType, WebGLRenderer, WebGLRenderTarget,} from 'three';

const OIDN_AUX_WEIGHTS_URL =
    'https://cdn.jsdelivr.net/gh/gkjohnson/three-gpu-pathtracer@v0.0.27/example/src/denoise/rt_hdr_alb_nrm.tza';

type OidnUNet = Awaited<ReturnType<typeof initUNetFromURL>>;

type Phase = 'idle'|'running'|'complete'|'failed';

/**
 * Runs the upstream Open Image Denoise network once on a finished WebGL
 * path-trace. oidn-web reads CPU images, so this copies the float render
 * target (and rasterized albedo / normal guides) instead of using the
 * WebGPU-only OIDNDenoiser class.
 */
export class OidnDenoise {
  private phase: Phase = 'idle';
  private enabledFlag = false;
  private generation = 0;
  private width = 0;
  private height = 0;
  private image: Float32Array|null = null;
  private textureInternal: DataTexture|null = null;
  private abort: (() => void)|null = null;
  private unetPromise: Promise<OidnUNet>|null = null;
  private byteTarget: WebGLRenderTarget|null = null;
  private readonly clearColor = new Color();

  constructor(private readonly onFrame: () => void) {}

  get enabled() {
    return this.enabledFlag;
  }

  /** True while a finished trace should stay on screen instead of sampling. */
  get holding() {
    return this.enabledFlag &&
        (this.phase === 'running' || this.phase === 'complete');
  }

  /** True until the current denoise pass has finished or failed. */
  get pending() {
    return this.enabledFlag && this.phase === 'running';
  }

  /** True once the denoised image is ready to show. */
  get complete() {
    return this.enabledFlag && this.phase === 'complete';
  }

  /** True when the denoise pass failed and the raw trace should show. */
  get failed() {
    return this.enabledFlag && this.phase === 'failed';
  }

  get texture(): Texture|null {
    return this.textureInternal;
  }

  setEnabled(enabled: boolean) {
    if (this.enabledFlag === enabled) {
      return;
    }
    this.enabledFlag = enabled;
    this.reset();
  }

  reset() {
    this.generation++;
    this.abort?.();
    this.abort = null;
    this.phase = 'idle';
    this.textureInternal?.dispose();
    this.textureInternal = null;
    this.image = null;
    this.width = 0;
    this.height = 0;
  }

  dispose() {
    this.reset();
    this.byteTarget?.dispose();
    this.byteTarget = null;
    const pending = this.unetPromise;
    this.unetPromise = null;
    pending?.then((unet) => unet.dispose()).catch(() => {});
  }

  start(
      renderer: WebGLRenderer, scene: Scene, camera: Camera,
      target: WebGLRenderTarget) {
    if (!this.enabledFlag || this.phase === 'failed') {
      return;
    }
    if (this.phase === 'running' || this.phase === 'complete') {
      if (target.width === this.width && target.height === this.height) {
        return;
      }
      this.reset();
    }
    if (target.width <= 0 || target.height <= 0) {
      return;
    }

    const generation = this.generation;
    try {
      const bottomUp = readFloatTarget(renderer, target);
      sanitizeHdr(bottomUp);
      const color = flipRows(bottomUp, target.width, target.height);
      const guides = this.captureGuides(
          renderer, scene, camera, target.width, target.height);
      this.seedTexture(bottomUp, target.width, target.height);
      this.phase = 'running';
      void this.denoise(generation, color, guides.albedo, guides.normal);
    } catch (error) {
      this.fail(error);
    }
  }

  private async denoise(
      generation: number, color: Float32Array, albedo: ImageData,
      normal: ImageData) {
    try {
      const unet = await this.getUnet();
      if (generation !== this.generation) {
        return;
      }
      this.abort = unet.tileExecute({
        color: {data: color, width: this.width, height: this.height},
        albedo,
        normal,
        done: (output) => {
          if (generation !== this.generation) {
            return;
          }
          this.paintDenoised(output.data as Float32Array);
          this.phase = 'complete';
          this.abort = null;
          this.onFrame();
        },
        progress: (output) => {
          if (generation !== this.generation) {
            return;
          }
          this.paintDenoised(output.data as Float32Array);
          this.onFrame();
        },
      });
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      this.fail(error);
      this.onFrame();
    }
  }

  private getUnet() {
    if (this.unetPromise == null) {
      this.unetPromise = initUNetFromURL(OIDN_AUX_WEIGHTS_URL, undefined, {
                           aux: true,
                           hdr: true,
                         }).catch((error: unknown) => {
        this.unetPromise = null;
        throw error;
      });
    }
    return this.unetPromise;
  }

  private seedTexture(bottomUp: Float32Array, width: number, height: number) {
    this.textureInternal?.dispose();
    this.image = new Float32Array(bottomUp);
    this.width = width;
    this.height = height;
    for (let i = 3; i < this.image.length; i += 4) {
      this.image[i] = 1;
    }
    const texture = new DataTexture(
        this.image, width, height, RGBAFormat, FloatType);
    texture.colorSpace = LinearSRGBColorSpace;
    texture.flipY = false;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    this.textureInternal = texture;
  }

  /** Copies finished HDR tiles into the bottom-up display texture. */
  private paintDenoised(topDown: Float32Array) {
    const image = this.image;
    if (image == null || topDown.length < image.length) {
      return;
    }
    const {width, height} = this;
    const stride = width * 4;
    for (let y = 0; y < height; y++) {
      const srcRow = y * stride;
      const dstRow = (height - 1 - y) * stride;
      for (let x = 0; x < width; x++) {
        const src = srcRow + x * 4;
        const red = topDown[src];
        const green = topDown[src + 1];
        const blue = topDown[src + 2];
        if (topDown[src + 3] === 0 || !Number.isFinite(red) ||
            !Number.isFinite(green) || !Number.isFinite(blue)) {
          continue;
        }
        const dst = dstRow + x * 4;
        // A failed tile comes back as exact black and would erase the sample.
        if (red <= 1e-6 && green <= 1e-6 && blue <= 1e-6 &&
            image[dst] + image[dst + 1] + image[dst + 2] > 0.05) {
          continue;
        }
        image[dst] = red;
        image[dst + 1] = green;
        image[dst + 2] = blue;
        image[dst + 3] = 1;
      }
    }
    if (this.textureInternal != null) {
      this.textureInternal.needsUpdate = true;
    }
  }

  private captureGuides(
      renderer: WebGLRenderer, scene: Scene, camera: Camera, width: number,
      height: number) {
    const target = this.ensureByteTarget(width, height);
    const previousTarget = renderer.getRenderTarget();
    const previousToneMapping = renderer.toneMapping;
    const previousOutput = renderer.outputColorSpace;
    const previousAutoClear = renderer.autoClear;
    const previousBackground = scene.background;
    const previousOverride = scene.overrideMaterial;
    renderer.getClearColor(this.clearColor);
    const previousClearAlpha = renderer.getClearAlpha();
    const normalMaterial = new MeshNormalMaterial();
    normalMaterial.toneMapped = false;

    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.autoClear = true;
    renderer.setRenderTarget(target);
    scene.background = null;

    try {
      scene.overrideMaterial = normalMaterial;
      renderer.setClearColor(0x8080ff, 1);
      renderer.render(scene, camera);
      const normal = new ImageData(
          readByteTarget(renderer, target), width, height);

      scene.overrideMaterial = null;
      const saved = swapAlbedoMaterials(scene);
      try {
        renderer.setClearColor(0xffffff, 1);
        renderer.render(scene, camera);
      } finally {
        restoreMaterials(saved);
      }
      const albedo = new ImageData(
          readByteTarget(renderer, target), width, height);
      return {albedo, normal};
    } finally {
      normalMaterial.dispose();
      scene.background = previousBackground;
      scene.overrideMaterial = previousOverride;
      renderer.toneMapping = previousToneMapping;
      renderer.outputColorSpace = previousOutput;
      renderer.autoClear = previousAutoClear;
      renderer.setClearColor(this.clearColor, previousClearAlpha);
      renderer.setRenderTarget(previousTarget);
    }
  }

  private ensureByteTarget(width: number, height: number) {
    if (this.byteTarget == null) {
      this.byteTarget = new WebGLRenderTarget(width, height, {
        type: UnsignedByteType,
        format: RGBAFormat,
        minFilter: LinearFilter,
        magFilter: LinearFilter,
        depthBuffer: true,
      });
      this.byteTarget.texture.colorSpace = LinearSRGBColorSpace;
    } else {
      this.byteTarget.setSize(width, height);
    }
    return this.byteTarget;
  }

  private fail(error: unknown) {
    console.warn('[model-viewer] OIDN denoise failed.', error);
    this.abort?.();
    this.abort = null;
    this.phase = 'failed';
  }
}

const sanitizeHdr = (pixels: Float32Array) => {
  for (let i = 0; i < pixels.length; i += 4) {
    const red = pixels[i];
    const green = pixels[i + 1];
    const blue = pixels[i + 2];
    pixels[i] = red > 0 ? red : 0;
    pixels[i + 1] = green > 0 ? green : 0;
    pixels[i + 2] = blue > 0 ? blue : 0;
    pixels[i + 3] = 1;
  }
};

const readFloatTarget = (
    renderer: WebGLRenderer, target: WebGLRenderTarget): Float32Array => {
  const pixels = new Float32Array(target.width * target.height * 4);
  renderer.readRenderTargetPixels(
      target, 0, 0, target.width, target.height, pixels);
  return pixels;
};

const readByteTarget = (
    renderer: WebGLRenderer, target: WebGLRenderTarget): Uint8ClampedArray => {
  const pixels = new Uint8Array(target.width * target.height * 4);
  renderer.readRenderTargetPixels(
      target, 0, 0, target.width, target.height, pixels);
  return new Uint8ClampedArray(
      flipRows(pixels, target.width, target.height));
};

const flipRows = <T extends Float32Array|Uint8Array>(
    src: T, width: number, height: number): T => {
  const dst = new (src.constructor as new (length: number) => T)(src.length);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    const from = (height - 1 - y) * stride;
    dst.set(src.subarray(from, from + stride), y * stride);
  }
  return dst;
};

const swapAlbedoMaterials = (root: Object3D) => {
  const saved: Array<{mesh: Mesh, material: Mesh['material']}> = [];
  const created: MeshBasicMaterial[] = [];
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh || !mesh.visible) {
      return;
    }
    const source = mesh.material;
    const replacement = Array.isArray(source) ?
        source.map((material) => albedoMaterial(material, created)) :
        albedoMaterial(source, created);
    saved.push({mesh, material: source});
    mesh.material = replacement;
  });
  return {saved, created};
};

const albedoMaterial = (source: Material, created: MeshBasicMaterial[]) => {
  const colored = source as MeshBasicMaterial;
  const material = new MeshBasicMaterial({
    color: colored.color ?? 0xffffff,
    map: colored.map ?? null,
    toneMapped: false,
    side: colored.side,
  });
  created.push(material);
  return material;
};

const restoreMaterials = (
    swapped: ReturnType<typeof swapAlbedoMaterials>) => {
  for (const entry of swapped.saved) {
    entry.mesh.material = entry.material;
  }
  for (const material of swapped.created) {
    material.dispose();
  }
};
