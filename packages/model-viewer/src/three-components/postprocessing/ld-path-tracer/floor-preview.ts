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

import {Camera, Color, DataTexture, Matrix4, Mesh, PerspectiveCamera, Plane, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,} from 'three';

import {FLOOR_PREVIEW_SHADOW, FloorFootprint, PathTracerFloorMode,} from './floor-matte.js';

const PREVIEW_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const PREVIEW_FRAGMENT = /* glsl */ `
uniform vec2 center;
uniform vec2 halfExtent;
uniform float radius;
uniform float shadowStrength;
uniform float reflectionStrength;
uniform sampler2D reflectionMap;
uniform mat4 mirrorMatrix;
varying vec3 vWorld;

void main() {
  vec2 outside = max(vec2(0.0), abs(vWorld.xz - center) - halfExtent);
  float dist = length(outside);
  float falloff = exp(-3.0 * pow(dist / max(radius, 1e-4), 2.0));
  vec3 incident = normalize(vWorld - cameraPosition);
  float cosTheta = clamp(dot(vec3(0.0, 1.0, 0.0), -incident), 0.0, 1.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - cosTheta, 5.0);
  vec4 clip = mirrorMatrix * vec4(vWorld, 1.0);
  vec2 uv = clip.xy / max(clip.w, 1e-4) * 0.5 + 0.5;
  vec4 reflected = texture2D(reflectionMap, uv);
  float onScreen = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0) * step(0.0, clip.w);
  float weight = reflected.a * fresnel * reflectionStrength * falloff * onScreen;
  float shadow = shadowStrength * falloff;
  float alpha = 1.0 - (1.0 - shadow) * (1.0 - weight);
  if (alpha < 0.004) discard;
  vec3 straight = alpha > 1e-4 ? (reflected.rgb * weight) / alpha : vec3(0.0);
  gl_FragColor = vec4(straight, alpha);
}
`;

/**
 * Raster stand-in for the holdout floor. Unlit, so the environment never
 * tints it. The traced image fades over this and uses the same footprint.
 */
export class PathTracerFloorPreview {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private readonly mirrorCamera = new PerspectiveCamera();
  private readonly mirrorMatrix = new Matrix4();
  private readonly clipPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly clear = new Color();
  private target: WebGLRenderTarget|null = null;
  private readonly emptyReflection = new DataTexture(
      new Uint8Array([0, 0, 0, 0]), 1, 1, RGBAFormat);

  constructor() {
    const material = new ShaderMaterial({
      uniforms: {
        center: {value: new Vector2()},
        halfExtent: {value: new Vector2(1, 1)},
        radius: {value: 1},
        shadowStrength: {value: FLOOR_PREVIEW_SHADOW},
        reflectionStrength: {value: 0},
        reflectionMap: {value: null},
        mirrorMatrix: {value: new Matrix4()},
      },
      vertexShader: PREVIEW_VERTEX,
      fragmentShader: PREVIEW_FRAGMENT,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
    this.mesh = new Mesh(new PlaneGeometry(1, 1), material);
    this.mesh.name = 'PathTracerFloorPreview';
    this.mesh.frustumCulled = false;
    this.mesh.userData.noHit = true;
    this.mesh.userData.pathTracerFloorPreview = true;
    this.mesh.layers.set(0);
    this.emptyReflection.needsUpdate = true;
    material.uniforms.reflectionMap.value = this.emptyReflection;
  }

  sync(
      footprint: FloorFootprint,
      mode: PathTracerFloorMode,
      reflectionStrength: number,
      ) {
    const material = this.mesh.material;
    const center = material.uniforms.center.value as Vector2;
    const half = material.uniforms.halfExtent.value as Vector2;
    center.set(footprint.centerX, footprint.centerZ);
    half.set(footprint.halfX, footprint.halfZ);
    material.uniforms.radius.value = footprint.radius;
    material.uniforms.shadowStrength.value =
        mode === 'none' ? 0 : FLOOR_PREVIEW_SHADOW;
    material.uniforms.reflectionStrength.value =
        mode === 'shadow-reflection' ? reflectionStrength : 0;
  }

  /**
   * Draws the subject from the mirrored camera into the preview texture.
   * The clear is transparent, so a ray that would have hit the environment
   * contributes nothing.
   */
  renderReflection(
      renderer: WebGLRenderer,
      scene: Scene,
      camera: Camera,
      floorY: number,
      mode: PathTracerFloorMode,
      ) {
    if (!(camera instanceof PerspectiveCamera) || mode !== 'shadow-reflection') {
      return;
    }
    const width = Math.max(1, renderer.domElement.width);
    const height = Math.max(1, renderer.domElement.height);
    if (this.target == null) {
      this.target = new WebGLRenderTarget(width, height);
    } else if (this.target.width !== width || this.target.height !== height) {
      this.target.setSize(width, height);
    }
    const mirror = this.mirrorCamera;
    mirror.copy(camera);
    mirror.layers.mask = camera.layers.mask;
    mirror.position.copy(camera.position);
    mirror.position.y = floorY * 2 - camera.position.y;
    const direction = new Vector3();
    camera.getWorldDirection(direction);
    const look = camera.position.clone().add(direction);
    look.y = floorY * 2 - look.y;
    mirror.up.set(0, -1, 0);
    mirror.lookAt(look);
    mirror.updateMatrixWorld(true);
    this.mirrorMatrix.multiplyMatrices(
        mirror.projectionMatrix, mirror.matrixWorldInverse);
    this.mesh.material.uniforms.mirrorMatrix.value.copy(this.mirrorMatrix);
    this.mesh.material.uniforms.reflectionMap.value = this.target.texture;

    const previousTarget = renderer.getRenderTarget();
    const previousAlpha = renderer.getClearAlpha();
    const previousClip = renderer.clippingPlanes;
    const previousBackground = scene.background;
    const previewWasVisible = this.mesh.visible;
    renderer.getClearColor(this.clear);
    this.clipPlane.constant = -floorY;
    this.mesh.visible = false;
    scene.background = null;
    renderer.clippingPlanes = [this.clipPlane];
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    try {
      renderer.render(scene, mirror);
    } finally {
      this.mesh.visible = previewWasVisible;
      scene.background = previousBackground;
      renderer.clippingPlanes = previousClip;
      renderer.setClearColor(this.clear, previousAlpha);
      renderer.setRenderTarget(previousTarget);
    }
  }

  dispose() {
    this.target?.dispose();
    this.target = null;
    this.emptyReflection.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
