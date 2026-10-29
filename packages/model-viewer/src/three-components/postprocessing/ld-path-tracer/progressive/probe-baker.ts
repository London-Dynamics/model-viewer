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

import {Camera, HalfFloatType, LinearSRGBColorSpace, NoToneMapping, PerspectiveCamera, PMREMGenerator, RGBAFormat, Scene, Texture, Vector3, WebGLCubeRenderTarget, WebGLRenderer, WebGLRenderTarget} from 'three';

const FACES = [
  {x: 1, y: 0, z: 0, ux: 0, uy: -1, uz: 0},
  {x: -1, y: 0, z: 0, ux: 0, uy: -1, uz: 0},
  {x: 0, y: 1, z: 0, ux: 0, uy: 0, uz: 1},
  {x: 0, y: -1, z: 0, ux: 0, uy: 0, uz: -1},
  {x: 0, y: 0, z: 1, ux: 0, uy: -1, uz: 0},
  {x: 0, y: 0, z: -1, ux: 0, uy: -1, uz: 0},
];

export class ProbeBaker {
  private readonly camera = new PerspectiveCamera(90, 1, 0.02, 50);
  private product: WebGLCubeRenderTarget|null = null;
  private empty: WebGLCubeRenderTarget|null = null;
  private pmrem: PMREMGenerator|null = null;
  private productMap: WebGLRenderTarget|null = null;
  private emptyMap: WebGLRenderTarget|null = null;
  private face = 0;
  private pass: 'product'|'empty'|'pmrem'|'done' = 'product';
  readonly position = new Vector3();

  constructor(readonly resolution: number) {
  }

  get done(): boolean {
    return this.pass === 'done';
  }

  get environmentMap(): WebGLRenderTarget|null {
    return this.emptyMap;
  }

  get productMapTarget(): WebGLRenderTarget|null {
    return this.productMap;
  }

  setPosition(x: number, y: number, z: number, far: number) {
    this.position.set(x, y, z);
    this.camera.far = Math.max(1, far);
    this.camera.near = Math.min(0.02, far * 0.001);
    this.camera.updateProjectionMatrix();
  }

  step(
      renderer: WebGLRenderer,
      scene: Scene,
      background: Texture|null,
      hideProduct: (hide: boolean) => void,
      ): boolean {
    if (this.pass === 'done') {
      return false;
    }
    if (this.product == null) {
      const options = {
        type: HalfFloatType,
        format: RGBAFormat,
        generateMipmaps: false,
        colorSpace: LinearSRGBColorSpace,
        depthBuffer: true,
      };
      this.product = new WebGLCubeRenderTarget(this.resolution, options);
      this.empty = new WebGLCubeRenderTarget(this.resolution, options);
    }
    if (this.pass === 'pmrem') {
      this.pmrem = this.pmrem ?? new PMREMGenerator(renderer);
      this.productMap = this.pmrem.fromCubemap(this.product!.texture);
      this.emptyMap = this.pmrem.fromCubemap(this.empty!.texture);
      this.pass = 'done';
      return true;
    }
    const target = this.pass === 'product' ? this.product! : this.empty!;
    const face = FACES[this.face];
    this.camera.position.copy(this.position);
    this.camera.up.set(face.ux, face.uy, face.uz);
    this.camera.lookAt(
        this.position.x + face.x,
        this.position.y + face.y,
        this.position.z + face.z);
    this.camera.updateMatrixWorld();
    const previousTarget = renderer.getRenderTarget();
    const previousTone = renderer.toneMapping;
    const previousSpace = renderer.outputColorSpace;
    const previousBackground = scene.background;
    const previousAutoClear = renderer.autoClear;
    if (this.pass === 'empty') {
      hideProduct(true);
    }
    // The grounded skybox is a mesh with a PMREM map. It occludes the
    // equirect background and the upper cube faces go black, which is what
    // turns a glossy hardtop black.
    const covered: {object: {visible: boolean}; visible: boolean}[] = [];
    scene.traverse((object) => {
      if (object.userData?.noHit === true && object.visible) {
        covered.push({object, visible: true});
        object.visible = false;
      }
    });
    if (background != null) {
      scene.background = background;
    }
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace;
    renderer.autoClear = true;
    renderer.setRenderTarget(target, this.face);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(previousTarget);
    renderer.toneMapping = previousTone;
    renderer.outputColorSpace = previousSpace;
    renderer.autoClear = previousAutoClear;
    scene.background = previousBackground;
    for (const entry of covered) {
      entry.object.visible = entry.visible;
    }
    if (this.pass === 'empty') {
      hideProduct(false);
    }
    this.face++;
    if (this.face >= 6) {
      this.face = 0;
      this.pass = this.pass === 'product' ? 'empty' : 'pmrem';
    }
    return true;
  }

  dispose() {
    this.product?.dispose();
    this.empty?.dispose();
    this.productMap?.dispose();
    this.emptyMap?.dispose();
    this.pmrem?.dispose();
    this.product = null;
    this.empty = null;
    this.productMap = null;
    this.emptyMap = null;
    this.pmrem = null;
    this.pass = 'done';
  }
}

export const placeProbe = (
    center: Vector3,
    size: Vector3,
    camera: Camera,
    index: number,
    count: number,
    target: Vector3,
    ): Vector3 => {
  const radius = Math.max(size.x, size.y, size.z, 0.2) * 0.75;
  const direction = new Vector3();
  camera.getWorldDirection(direction);
  direction.y = 0;
  if (direction.lengthSq() < 1e-6) {
    direction.set(0, 0, 1);
  }
  direction.normalize();
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const rx = direction.x * cos - direction.z * sin;
  const rz = direction.x * sin + direction.z * cos;
  target.set(
      center.x + rx * radius, center.y + size.y * 0.15, center.z + rz * radius);
  return target;
};
