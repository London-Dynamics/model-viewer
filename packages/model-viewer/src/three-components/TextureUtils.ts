/* @license
 * Copyright 2019 Google LLC. All Rights Reserved.
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

import {GainMapDecoderMaterial, HDRJPGLoader, QuadRenderer} from '@monogrid/gainmap-js';
import {BackSide, BoxGeometry, CubeCamera, CubeTexture, DataTexture, EquirectangularReflectionMapping, HalfFloatType, LinearSRGBColorSpace, Loader, Mesh, NoBlending, NoToneMapping, RGBAFormat, Scene, ShaderMaterial, SRGBColorSpace, Texture, TextureLoader, Vector3, WebGLCubeRenderTarget, WebGLRenderer} from 'three';
import {HDRLoader} from 'three/examples/jsm/loaders/HDRLoader.js';

import {deserializeUrl, timePasses} from '../utilities.js';
import {CacheEvictionPolicy} from '../utilities/cache-eviction-policy.js';

import EnvironmentScene from './EnvironmentScene.js';

export interface EnvironmentMapAndSkybox {
  environmentMap: Texture;
  skybox: Texture|null;
}

const GENERATED_SIGMA = 0.04;
// The maximum length of the blur for loop. Smaller sigmas will use fewer
// samples and exit early, but not recompile the shader.
const MAX_SAMPLES = 20;

const HDR_FILE_RE = /\.hdr(\.js)?$/;

export default class TextureUtils {
  /**
   * Unused environment-image and skybox-image textures to keep. Images a
   * viewer still holds are never evicted and do not consume this budget. The
   * default is 0: switching images disposes the previous texture and the
   * PMREM Three.js generated from it. Renderer teardown still clears the rest.
   */
  private static imageCacheLimit = 0;
  private static readonly live = new Set<TextureUtils>();

  static get environmentImageCacheSize(): number {
    return TextureUtils.imageCacheLimit;
  }

  static set environmentImageCacheSize(value: number) {
    TextureUtils.imageCacheLimit = value;
    for (const utils of TextureUtils.live) {
      utils.environmentImagePolicy.evictionThreshold = value;
    }
  }

  public lottieLoaderUrl = '';

  private _ldrLoader: TextureLoader|null = null;
  private _imageLoader: HDRJPGLoader|null = null;
  private _hdrLoader: HDRLoader|null = null;
  private _lottieLoader: Loader|null = null;

  private generatedEnvironmentMap: Promise<CubeTexture>|null = null;
  private generatedEnvironmentMapAlt: Promise<CubeTexture>|null = null;

  private skyboxCache = new Map<string, Promise<Texture>>();
  private environmentImagePolicy!: CacheEvictionPolicy<string>;
  private readonly disposedEnvironmentImages = new WeakSet<Texture>();
  /**
   * LDR skyboxes are rendered into a target by the gainmap decoder. The
   * texture we cache is that target's texture; disposing the texture alone
   * does not release the target.
   */
  private readonly environmentImageTargets =
      new Map<Texture, {dispose: () => void}>();

  private blurMaterial: ShaderMaterial|null = null;
  private blurScene: Scene|null = null;

  constructor(private threeRenderer: WebGLRenderer) {
    this.environmentImagePolicy = new CacheEvictionPolicy<string>(
        {
          delete: (url: string) => {
            this.deleteEnvironmentImage(url);
          },
        },
        TextureUtils.environmentImageCacheSize,
        {unusedOnly: true});
    TextureUtils.live.add(this);
  }

  /**
   * Marks an environment or skybox URL as displayed. The decoded texture is
   * not evicted while any caller still holds it.
   */
  retainEnvironmentImage(url: string) {
    this.environmentImagePolicy.retain(url);
  }

  /**
   * Drops one hold on an environment or skybox URL. When the last hold is
   * gone and the unused budget is full, the texture and its PMREM are
   * disposed.
   */
  releaseEnvironmentImage(url: string) {
    this.environmentImagePolicy.release(url);
  }

  private ldrLoader(withCredentials: boolean): TextureLoader {
    if (this._ldrLoader == null) {
      this._ldrLoader = new TextureLoader();
    }
    this._ldrLoader.setWithCredentials(withCredentials);
    return this._ldrLoader;
  }

  private imageLoader(withCredentials: boolean): HDRJPGLoader {
    if (this._imageLoader == null) {
      this._imageLoader = new HDRJPGLoader(this.threeRenderer);
    }
    this._imageLoader.setWithCredentials(withCredentials);
    return this._imageLoader;
  }

  private hdrLoader(withCredentials: boolean): HDRLoader {
    if (this._hdrLoader == null) {
      this._hdrLoader = new HDRLoader();
      this._hdrLoader.setDataType(HalfFloatType);
    }
    this._hdrLoader.setWithCredentials(withCredentials);
    return this._hdrLoader;
  }

  async getLottieLoader(withCredentials: boolean): Promise<any> {
    if (this._lottieLoader == null) {
      const {LottieLoader} =
          await import(/* webpackIgnore: true */ this.lottieLoaderUrl);
      this._lottieLoader = new LottieLoader() as Loader;
    }
    this._lottieLoader.setWithCredentials(withCredentials);
    return this._lottieLoader;
  }

  async loadImage(url: string, withCredentials: boolean): Promise<Texture> {
    const texture: Texture = await new Promise<Texture>(
        (resolve, reject) => this.ldrLoader(withCredentials)
                                 .load(url, resolve, () => {}, reject));
    texture.name = url;
    texture.flipY = false;

    return texture;
  }

  async loadLottie(url: string, quality: number, withCredentials: boolean):
      Promise<Texture> {
    const loader = await this.getLottieLoader(withCredentials);
    loader.setQuality(quality);
    const texture: Texture = await new Promise<Texture>(
        (resolve, reject) => loader.load(url, resolve, () => {}, reject));
    texture.name = url;

    return texture;
  }

  async loadEquirect(
      url: string, withCredentials = false,
      progressCallback: (progress: number) => void = () => {}):
      Promise<Texture> {
    try {
      const isHDR: boolean = HDR_FILE_RE.test(url);
      const loader = isHDR ? this.hdrLoader(withCredentials) :
                             this.imageLoader(withCredentials);
      const texture: Texture = await new Promise<Texture>(
          (resolve, reject) => loader.load(
              url,
              (result) => {
                const {renderTarget} =
                    result as QuadRenderer<1016, GainMapDecoderMaterial>;
                if (renderTarget != null) {
                  const {texture} = renderTarget;
                  // Keep the decoded target. dispose(false) frees the
                  // decoder's source images and leaves this target alive.
                  result.dispose(false);
                  this.environmentImageTargets.set(texture, renderTarget);
                  resolve(texture);
                } else {
                  resolve(result as DataTexture);
                }
              },
              (event: {loaded: number, total: number}) => {
                progressCallback(event.loaded / event.total * 0.9);
              },
              reject));

      progressCallback(1.0);

      texture.name = url;
      texture.mapping = EquirectangularReflectionMapping;

      if (!isHDR) {
        texture.colorSpace = SRGBColorSpace;
      }

      return texture;

    } finally {
      if (progressCallback) {
        progressCallback(1);
      }
    }
  }

  /**
   * Returns a { skybox, environmentMap } object with the targets/textures
   * accordingly. `skybox` is a WebGLRenderCubeTarget, and `environmentMap`
   * is a Texture from a WebGLRenderCubeTarget.
   */
  async generateEnvironmentMapAndSkybox(
      skyboxUrl: string|null = null, environmentMapUrl: string|null = null,
      progressCallback: (progress: number) => void = () => {},
      withCredentials = false): Promise<EnvironmentMapAndSkybox> {
    const useAltEnvironment = environmentMapUrl !== 'legacy';
    if (environmentMapUrl === 'legacy' || environmentMapUrl === 'neutral') {
      environmentMapUrl = null;
    }
    environmentMapUrl = deserializeUrl(environmentMapUrl);

    let skyboxLoads: Promise<Texture|null> = Promise.resolve(null);
    let environmentMapLoads: Promise<Texture>;

    // If we have a skybox URL, attempt to load it as a cubemap
    if (!!skyboxUrl) {
      skyboxLoads = this.loadEquirectFromUrl(
          skyboxUrl, withCredentials, progressCallback);
    }

    if (!!environmentMapUrl) {
      // We have an available environment map URL
      environmentMapLoads = this.loadEquirectFromUrl(
          environmentMapUrl, withCredentials, progressCallback);
    } else if (!!skyboxUrl) {
      // Fallback to deriving the environment map from an available skybox
      environmentMapLoads = this.loadEquirectFromUrl(
          skyboxUrl, withCredentials, progressCallback);
    } else {
      // Fallback to generating the environment map
      environmentMapLoads = useAltEnvironment ?
          this.loadGeneratedEnvironmentMapAlt() :
          this.loadGeneratedEnvironmentMap();
    }

    const [environmentMap, skybox] =
        await Promise.all([environmentMapLoads, skyboxLoads]);

    if (environmentMap == null) {
      throw new Error('Failed to load environment map.');
    }

    return {environmentMap, skybox};
  }

  /**
   * Loads an equirect Texture from a given URL, for use as a skybox.
   */
  private async loadEquirectFromUrl(
      url: string, withCredentials: boolean,
      progressCallback: (progress: number) => void): Promise<Texture> {
    if (!this.skyboxCache.has(url)) {
      const skyboxMapLoads =
          this.loadEquirect(url, withCredentials, progressCallback);

      this.skyboxCache.set(url, skyboxMapLoads);
    }

    return this.skyboxCache.get(url)!;
  }

  private async GenerateEnvironmentMap(scene: Scene, name: string) {
    await timePasses();

    const renderer = this.threeRenderer;
    const cubeTarget = new WebGLCubeRenderTarget(256, {
      generateMipmaps: false,
      type: HalfFloatType,
      format: RGBAFormat,
      colorSpace: LinearSRGBColorSpace,
      depthBuffer: true
    });
    const cubeCamera = new CubeCamera(0.1, 100, cubeTarget);
    const generatedEnvironmentMap = cubeCamera.renderTarget.texture;
    generatedEnvironmentMap.name = name;

    const outputColorSpace = renderer.outputColorSpace;
    const toneMapping = renderer.toneMapping;
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;

    cubeCamera.update(renderer, scene);

    this.blurCubemap(cubeTarget, GENERATED_SIGMA);

    renderer.toneMapping = toneMapping;
    renderer.outputColorSpace = outputColorSpace;

    return generatedEnvironmentMap;
  }

  /**
   * Loads a dynamically generated environment map.
   */
  private async loadGeneratedEnvironmentMap(): Promise<CubeTexture> {
    if (this.generatedEnvironmentMap == null) {
      this.generatedEnvironmentMap =
          this.GenerateEnvironmentMap(new EnvironmentScene('legacy'), 'legacy');
    }
    return this.generatedEnvironmentMap;
  }

  /**
   * Loads a dynamically generated environment map, designed to be neutral and
   * color-preserving. Shows less contrast around the different sides of the
   * object.
   */
  private async loadGeneratedEnvironmentMapAlt(): Promise<CubeTexture> {
    if (this.generatedEnvironmentMapAlt == null) {
      this.generatedEnvironmentMapAlt = this.GenerateEnvironmentMap(
          new EnvironmentScene('neutral'), 'neutral');
    }
    return this.generatedEnvironmentMapAlt;
  }

  private blurCubemap(cubeTarget: WebGLCubeRenderTarget, sigma: number) {
    if (this.blurMaterial == null) {
      this.blurMaterial = this.getBlurShader(MAX_SAMPLES);
      const box = new BoxGeometry();
      const blurMesh = new Mesh(box, this.blurMaterial!);
      this.blurScene = new Scene();
      this.blurScene.add(blurMesh);
    }
    const tempTarget = cubeTarget.clone();
    this.halfblur(cubeTarget, tempTarget, sigma, 'latitudinal');
    this.halfblur(tempTarget, cubeTarget, sigma, 'longitudinal');
    // Disposing this target after we're done with it somehow corrupts Safari's
    // whole graphics driver. It's random, but occurs more frequently on
    // lower-powered GPUs (macbooks with intel graphics, older iPhones). It goes
    // beyond just messing up the PMREM, as it also occasionally causes
    // visible corruption on the canvas and even on the rest of the page.
    /** tempTarget.dispose(); */
  }

  private halfblur(
      targetIn: WebGLCubeRenderTarget, targetOut: WebGLCubeRenderTarget,
      sigmaRadians: number, direction: 'latitudinal'|'longitudinal') {
    // Number of standard deviations at which to cut off the discrete
    // approximation.
    const STANDARD_DEVIATIONS = 3;

    const pixels = targetIn.width;
    const radiansPerPixel = isFinite(sigmaRadians) ?
        Math.PI / (2 * pixels) :
        2 * Math.PI / (2 * MAX_SAMPLES - 1);
    const sigmaPixels = sigmaRadians / radiansPerPixel;
    const samples = isFinite(sigmaRadians) ?
        1 + Math.floor(STANDARD_DEVIATIONS * sigmaPixels) :
        MAX_SAMPLES;

    if (samples > MAX_SAMPLES) {
      console.warn(`sigmaRadians, ${
          sigmaRadians}, is too large and will clip, as it requested ${
          samples} samples when the maximum is set to ${MAX_SAMPLES}`);
    }

    const weights = [];
    let sum = 0;

    for (let i = 0; i < MAX_SAMPLES; ++i) {
      const x = i / sigmaPixels;
      const weight = Math.exp(-x * x / 2);
      weights.push(weight);

      if (i == 0) {
        sum += weight;

      } else if (i < samples) {
        sum += 2 * weight;
      }
    }

    for (let i = 0; i < weights.length; i++) {
      weights[i] = weights[i] / sum;
    }

    const blurUniforms = this.blurMaterial!.uniforms;
    blurUniforms['envMap'].value = targetIn.texture;
    blurUniforms['samples'].value = samples;
    blurUniforms['weights'].value = weights;
    blurUniforms['latitudinal'].value = direction === 'latitudinal';
    blurUniforms['dTheta'].value = radiansPerPixel;

    const cubeCamera = new CubeCamera(0.1, 100, targetOut);
    cubeCamera.update(this.threeRenderer, this.blurScene!);
  }

  private getBlurShader(maxSamples: number) {
    const weights = new Float32Array(maxSamples);
    const poleAxis = new Vector3(0, 1, 0);
    const shaderMaterial = new ShaderMaterial({

      name: 'SphericalGaussianBlur',

      defines: {'n': maxSamples},

      uniforms: {
        'envMap': {value: null},
        'samples': {value: 1},
        'weights': {value: weights},
        'latitudinal': {value: false},
        'dTheta': {value: 0},
        'poleAxis': {value: poleAxis}
      },

      vertexShader: /* glsl */ `
      
      varying vec3 vOutputDirection;
  
      void main() {
  
        vOutputDirection = vec3( position );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  
      }
    `,

      fragmentShader: /* glsl */ `
        varying vec3 vOutputDirection;
  
        uniform samplerCube envMap;
        uniform int samples;
        uniform float weights[ n ];
        uniform bool latitudinal;
        uniform float dTheta;
        uniform vec3 poleAxis;
  
        vec3 getSample( float theta, vec3 axis ) {
  
          float cosTheta = cos( theta );
          // Rodrigues' axis-angle rotation
          vec3 sampleDirection = vOutputDirection * cosTheta
            + cross( axis, vOutputDirection ) * sin( theta )
            + axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );
  
          return vec3( textureCube( envMap, sampleDirection ) );
  
        }
  
        void main() {
  
          vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );
  
          if ( all( equal( axis, vec3( 0.0 ) ) ) ) {
  
            axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );
  
          }
  
          axis = normalize( axis );
  
          gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
          gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );
  
          for ( int i = 1; i < n; i++ ) {
  
            if ( i >= samples ) {
  
              break;
  
            }
  
            float theta = dTheta * float( i );
            gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
            gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );
  
          }
        }
      `,

      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      side: BackSide

    });

    return shaderMaterial;
  }

  private deleteEnvironmentImage(url: string) {
    const pending = this.skyboxCache.get(url);
    if (pending == null) {
      return;
    }
    this.skyboxCache.delete(url);
    pending.then(
        (texture) => {
          this.disposeEnvironmentImage(texture);
        },
        () => {
            // A rejected load has no texture to free.
        });
  }

  /**
   * Frees the equirect texture. Three.js's WebGLCubeUVMaps listens for the
   * texture's dispose event and disposes the PMREM render target it
   * generated from that equirect, so the reflection map does not stay on
   * the GPU after the source is dropped.
   */
  private disposeEnvironmentImage(texture: Texture) {
    if (this.disposedEnvironmentImages.has(texture)) {
      return;
    }
    this.disposedEnvironmentImages.add(texture);
    const image = texture.image as {close?: () => void} | null;
    if (image != null && typeof image.close === 'function') {
      image.close();
    }
    // texture.dispose() notifies WebGLCubeMaps / WebGLCubeUVMaps, which
    // dispose the background cube map or PMREM. A render-target texture's
    // own framebuffer is released by the target, not by that event.
    texture.dispose();
    const renderTarget = this.environmentImageTargets.get(texture);
    if (renderTarget != null) {
      this.environmentImageTargets.delete(texture);
      renderTarget.dispose();
    }
  }

  async dispose() {
    TextureUtils.live.delete(this);
    const pending = [...this.skyboxCache.values()];
    this.skyboxCache.clear();
    this.environmentImagePolicy.reset();
    await Promise.all(pending.map(async (promise) => {
      try {
        this.disposeEnvironmentImage(await promise);
      } catch {
        // A rejected load has no texture to free.
      }
    }));
    this.environmentImageTargets.clear();
    if (this.generatedEnvironmentMap != null) {
      (await this.generatedEnvironmentMap).dispose();
      this.generatedEnvironmentMap = null;
    }
    if (this.generatedEnvironmentMapAlt != null) {
      (await this.generatedEnvironmentMapAlt).dispose();
      this.generatedEnvironmentMapAlt = null;
    }
    if (this.blurMaterial != null) {
      this.blurMaterial.dispose();
    }
  }
}
