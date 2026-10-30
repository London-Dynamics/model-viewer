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

import {Camera, Color, DoubleSide, HalfFloatType, InstancedMesh, Material, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, NoBlending, Object3D, PlaneGeometry, Scene, ShaderMaterial, Texture, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget} from 'three';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

import {ModelScene} from '../../../ModelScene.js';

/**
 * What the WebGPU trace contributes to the picture.
 *
 * - full: the trace is the picture (beauty).
 * - shadows: a white-diffuse trace divided by a real-time render of the same
 *   white scene gives a visibility ratio in [0, 1]. It multiplies the
 *   real-time render and darkens a ground catcher.
 * - lighting: a diffuse-proxy trace (real base colour, roughness 1, glass
 *   keeps transmission) replaces the real-time diffuse lighting. See
 *   compositeFragment for the formula.
 */
export type TraceMode = 'full'|'shadows'|'lighting';

/** Which picture to present: the composite, the raw trace, or real-time. */
export type TraceView = 'composite'|'trace'|'realtime';

export interface TraceCompositeOptions {
  mode: TraceMode;
  view: TraceView;
  /**
   * Comma separated. `semi-transparent` (alias `transparent`) matches any
   * material with transmission, opacity below 1 or alpha blending. Any other
   * token is a case-insensitive name with `*` wildcards, matched against the
   * mesh name and the material name. `mesh:` or `material:` limits a token to
   * one of the two.
   */
  exclude: string;
  /** Excluded meshes still block light in the trace when true. */
  excludedCastShadow: boolean;
  /** Ground catcher strength for shadows and lighting. 0 turns it off. */
  groundShadow: number;
}

export const DEFAULT_TRACE_COMPOSITE_OPTIONS: TraceCompositeOptions = {
  mode: 'full',
  view: 'composite',
  exclude: '',
  excludedCastShadow: false,
  groundShadow: 1,
};

const TRACE_MODES = new Set<TraceMode>(['full', 'shadows', 'lighting']);
const TRACE_VIEWS = new Set<TraceView>(['composite', 'trace', 'realtime']);

export const parseTraceMode = (value: unknown): TraceMode =>
    TRACE_MODES.has(value as TraceMode) ? value as TraceMode : 'full';

export const parseTraceView = (value: unknown): TraceView =>
    TRACE_VIEWS.has(value as TraceView) ? value as TraceView : 'composite';

/**
 * Composite passes read the trace as linear light. The WebGPU present writes
 * it with linear tone mapping at this exposure and sRGB encoding, so 8 bits
 * hold linear values up to 1 / TRACE_LINEAR_SCALE.
 */
export const TRACE_LINEAR_SCALE = 0.25;

/** Diffuse-proxy albedo floor, so metals still yield a visibility ratio. */
const PROXY_ALBEDO_FLOOR = 0.1;

interface ExclusionRule {
  target: 'any'|'mesh'|'material';
  pattern: RegExp;
}

export interface Exclusions {
  semiTransparent: boolean;
  rules: ExclusionRule[];
}

export const parseExclusions = (spec: string): Exclusions => {
  const result: Exclusions = {semiTransparent: false, rules: []};
  for (const raw of (spec ?? '').split(/[,;\n]+/)) {
    const token = raw.trim();
    if (token === '') {
      continue;
    }
    const lower = token.toLowerCase();
    if (lower === 'semi-transparent' || lower === 'transparent' ||
        lower === 'semitransparent') {
      result.semiTransparent = true;
      continue;
    }
    let target: ExclusionRule['target'] = 'any';
    let name = token;
    const colon = token.indexOf(':');
    if (colon > 0) {
      const prefix = lower.slice(0, colon);
      if (prefix === 'mesh' || prefix === 'material') {
        target = prefix;
        name = token.slice(colon + 1).trim();
      }
    }
    const source = name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    result.rules.push({target, pattern: new RegExp(`^${source}$`, 'i')});
  }
  return result;
};

const materialsOf = (mesh: Mesh): Material[] =>
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .filter((entry): entry is Material => entry != null);

export const isSemiTransparent = (material: Material): boolean => {
  const physical = material as MeshPhysicalMaterial;
  return (physical.transmission ?? 0) > 0 || material.opacity < 1 ||
      material.transparent === true;
};

/** Glass keeps transmission in the white and diffuse proxies. */
const isGlass = (material: Material): boolean => {
  const physical = material as MeshPhysicalMaterial;
  return (physical.transmission ?? 0) > 0 ||
      (material.transparent === true && material.opacity < 0.99);
};

export const isExcluded = (mesh: Mesh, exclusions: Exclusions): boolean => {
  const materials = materialsOf(mesh);
  if (exclusions.semiTransparent && materials.some(isSemiTransparent)) {
    return true;
  }
  const meshNames = [mesh.name, mesh.userData?.name].filter(
      (name): name is string => typeof name === 'string' && name !== '');
  return exclusions.rules.some((rule) => {
    if (rule.target !== 'material' &&
        meshNames.some((name) => rule.pattern.test(name))) {
      return true;
    }
    return rule.target !== 'mesh' &&
        materials.some((material) => rule.pattern.test(material.name));
  });
};

const hiddenFromTrace = (object: Object3D) =>
    object.userData?.progressiveOverlay === true ||
    object.userData?.noHit === true ||
    object.userData?.pathTracerShadowCatcher === true;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const glassProxy = (source: Material, tint: boolean): MeshPhysicalMaterial => {
  const physical = source as MeshPhysicalMaterial;
  return new MeshPhysicalMaterial({
    name: `${source.name}::trace-glass`,
    color: tint && physical.color ? physical.color.clone() : new Color(1, 1, 1),
    roughness: physical.roughness ?? 0,
    metalness: 0,
    transmission: physical.transmission ?? 0,
    thickness: physical.thickness ?? 0,
    ior: physical.ior ?? 1.5,
    opacity: source.opacity,
    transparent: source.transparent,
    side: source.side,
    depthWrite: source.depthWrite,
  });
};

const whiteProxy = (source: Material): Material => {
  if (isGlass(source)) {
    return glassProxy(source, false);
  }
  return new MeshStandardMaterial({
    name: `${source.name}::trace-white`,
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    side: source.side,
    alphaTest: source.alphaTest,
  });
};

const diffuseProxy = (source: Material): Material => {
  if (isGlass(source)) {
    return glassProxy(source, true);
  }
  const standard = source as MeshStandardMaterial;
  const metalness = clamp01(standard.metalness ?? 0);
  const color = (standard.color ?? new Color(1, 1, 1))
                    .clone()
                    .multiplyScalar(1 - metalness);
  const floor = PROXY_ALBEDO_FLOOR;
  color.setRGB(
      Math.max(color.r, floor), Math.max(color.g, floor),
      Math.max(color.b, floor));
  return new MeshStandardMaterial({
    name: `${source.name}::trace-diffuse`,
    color,
    map: standard.map ?? null,
    vertexColors: standard.vertexColors,
    roughness: 1,
    metalness: 0,
    side: source.side,
    alphaTest: source.alphaTest,
    transparent: source.transparent,
    opacity: source.opacity,
  });
};

/**
 * Linear-light composite. F is the full real-time render, A the same without
 * excluded meshes, P a real-time render of the trace proxy, T the trace.
 * All premultiplied, before tone mapping. P.a marks coverage: 1 model,
 * 0.5 ground catcher, 0 empty.
 *
 * shadows:  v = clamp(lum(T) / lum(P), 0, 1); C = A * v
 * lighting: v as above; C = T + (A - P) * v
 *   T replaces the real-time diffuse lighting P with the traced one, with
 *   shadows, occlusion and coloured bounce. What real-time adds on top of
 *   its own diffuse (A - P: reflections, clearcoat, sheen) is kept and
 *   occluded by v.
 * ground:   k = groundShadow * (1 - v); C = A * (1 - k); a = A.a + k (1 - A.a)
 * full:     C = T
 * Excluded meshes then go back on top: C += F - A.
 */
const compositeFragment = /* glsl */ `
uniform sampler2D tFull;
uniform sampler2D tBase;
uniform sampler2D tProxy;
uniform sampler2D tTrace;
uniform float traceScale;
uniform float groundShadow;
uniform float mode;
uniform float view;
uniform float hasBase;
uniform float hasProxy;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 F = texture2D(tFull, vUv);
  vec4 A = hasBase > 0.5 ? texture2D(tBase, vUv) : F;
  vec4 Tr = texture2D(tTrace, vUv);
  vec3 T = Tr.rgb / traceScale * Tr.a;
  vec4 P = hasProxy > 0.5 ? texture2D(tProxy, vUv) : vec4(0.0);
  vec4 result;
  if (view > 1.5) {
    result = F;
  } else if (view > 0.5) {
    result = vec4(T, Tr.a);
  } else {
    vec3 C = A.rgb;
    float a = A.a;
    if (mode < 0.5) {
      C = T;
      a = Tr.a;
    } else if (P.a > 0.25) {
      float r = luma(P.rgb);
      float v = r > 1e-5 ? clamp(luma(T) / r, 0.0, 1.0) : 1.0;
      if (P.a < 0.75) {
        float k = clamp(groundShadow, 0.0, 1.0) * (1.0 - v);
        C = A.rgb * (1.0 - k);
        a = A.a + k * (1.0 - A.a);
      } else if (mode < 1.5) {
        C = A.rgb * v;
      } else {
        C = max(T + (A.rgb - P.rgb) * v, vec3(0.0));
      }
    }
    C += F.rgb - A.rgb;
    a += F.a - A.a;
    result = vec4(max(C, vec3(0.0)), clamp(a, 0.0, 1.0));
  }
  gl_FragColor = result;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const compositeVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const makeTarget = () => new WebGLRenderTarget(1, 1, {
  type: HalfFloatType,
  samples: 4,
  depthBuffer: true,
});

/**
 * Builds the scene the WebGPU tracer sees in the composite modes, renders the
 * real-time passes into linear targets and mixes them with the trace.
 */
export class TraceComposite {
  private proxy: Scene|null = null;
  private proxyKey = '';
  private generation = 0;
  private excluded: Mesh[] = [];
  private readonly materialCache = new Map<Material, Material>();
  private cacheMode: TraceMode|null = null;
  private readonly groundGeometry = new PlaneGeometry(1, 1);
  private readonly groundTraceMaterial = new MeshStandardMaterial({
    name: 'trace-ground',
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    side: DoubleSide,
  });
  private readonly groundRasterMaterial: MeshStandardMaterial;
  private groundTrace: Mesh|null = null;
  private groundRaster: Mesh|null = null;
  private readonly full = makeTarget();
  private readonly base = makeTarget();
  private readonly proxyTarget = makeTarget();
  private readonly quad: FullScreenQuad;
  private readonly material: ShaderMaterial;
  private readonly size = new Vector2();
  private readonly clearColor = new Color();

  constructor() {
    // Same lighting as the trace ground, but alpha 0.5 marks catcher pixels.
    this.groundRasterMaterial = this.groundTraceMaterial.clone();
    this.groundRasterMaterial.blending = NoBlending;
    this.groundRasterMaterial.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\n\tgl_FragColor.a = 0.5;');
    };
    this.material = new ShaderMaterial({
      uniforms: {
        tFull: {value: null},
        tBase: {value: null},
        tProxy: {value: null},
        tTrace: {value: null},
        traceScale: {value: TRACE_LINEAR_SCALE},
        groundShadow: {value: 1},
        mode: {value: 0},
        view: {value: 0},
        hasBase: {value: 0},
        hasProxy: {value: 0},
      },
      vertexShader: compositeVertex,
      fragmentShader: compositeFragment,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      toneMapped: true,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /** Model load, geometry move or reset: rebuild the proxy next frame. */
  invalidate() {
    this.generation++;
  }

  excludedMeshes(): readonly Mesh[] {
    return this.excluded;
  }

  /**
   * The scene to trace, or null when the plain beauty path applies (full
   * mode with nothing excluded).
   */
  sync(scene: ModelScene, options: TraceCompositeOptions): Scene|null {
    const key = [
      this.generation,
      options.mode,
      options.exclude,
      options.excludedCastShadow,
      options.groundShadow > 0,
    ].join('|');
    if (key !== this.proxyKey) {
      this.proxyKey = key;
      this.rebuild(scene, options);
    }
    const proxy = this.proxy;
    if (proxy != null) {
      proxy.environment = scene.environment;
      proxy.environmentIntensity = scene.environmentIntensity;
      proxy.environmentRotation.copy(scene.environmentRotation);
      proxy.background = null;
    }
    return proxy;
  }

  private proxyMaterial(source: Material, mode: TraceMode): Material {
    if (mode === 'full') {
      return source;
    }
    let proxy = this.materialCache.get(source);
    if (proxy == null) {
      proxy = mode === 'shadows' ? whiteProxy(source) : diffuseProxy(source);
      this.materialCache.set(source, proxy);
    }
    return proxy;
  }

  private rebuild(scene: ModelScene, options: TraceCompositeOptions) {
    this.disposeProxy();
    if (this.cacheMode !== options.mode) {
      this.disposeMaterials();
      this.cacheMode = options.mode;
    }
    const exclusions = parseExclusions(options.exclude);
    const excluded: Mesh[] = [];
    const proxy = new Scene();
    proxy.name = 'TraceProxy';
    scene.updateMatrixWorld(true);
    const visit = (object: Object3D) => {
      if (!object.visible || hiddenFromTrace(object)) {
        return;
      }
      const mesh = object as Mesh;
      if (mesh.isMesh && mesh.geometry != null && mesh.material != null) {
        const out = isExcluded(mesh, exclusions);
        if (out) {
          excluded.push(mesh);
        }
        if (!out || options.excludedCastShadow) {
          proxy.add(this.cloneMesh(mesh, options.mode));
        }
      }
      for (const child of object.children) {
        visit(child);
      }
    };
    visit(scene);
    this.excluded = excluded;
    if (options.mode === 'full' && excluded.length === 0) {
      this.proxy = null;
      return;
    }
    if (options.mode !== 'full' && options.groundShadow > 0) {
      this.addGround(scene, proxy);
    }
    proxy.updateMatrixWorld(true);
    this.proxy = proxy;
  }

  private cloneMesh(mesh: Mesh, mode: TraceMode): Mesh {
    const materials = Array.isArray(mesh.material) ?
        mesh.material.map((entry) => this.proxyMaterial(entry, mode)) :
        this.proxyMaterial(mesh.material, mode);
    let clone: Mesh;
    const instanced = mesh as InstancedMesh;
    if (instanced.isInstancedMesh) {
      const copy = new InstancedMesh(mesh.geometry, materials, instanced.count);
      copy.instanceMatrix = instanced.instanceMatrix;
      copy.instanceColor = instanced.instanceColor;
      clone = copy;
    } else {
      clone = new Mesh(mesh.geometry, materials);
    }
    clone.name = mesh.name;
    clone.matrixAutoUpdate = false;
    clone.matrix.copy(mesh.matrixWorld);
    clone.matrixWorld.copy(mesh.matrixWorld);
    clone.frustumCulled = false;
    clone.renderOrder = mesh.renderOrder;
    clone.userData.traceSource = mesh.uuid;
    return clone;
  }

  private addGround(scene: ModelScene, proxy: Scene) {
    const {boundingBox, size} = scene;
    const center = boundingBox.getCenter(new Vector3());
    const extent = Math.max(size.x, size.y, size.z, 0.01) * 4;
    const gap = 0.001 * extent;
    const local = new Matrix4().compose(
        new Vector3(center.x, boundingBox.min.y - gap, center.z),
        new Object3D().rotateX(-Math.PI / 2).quaternion,
        new Vector3(extent, extent, 1));
    scene.target.updateMatrixWorld(true);
    const world = scene.target.matrixWorld.clone().multiply(local);
    const place = (material: Material) => {
      const ground = new Mesh(this.groundGeometry, material);
      ground.name = 'TraceGroundCatcher';
      ground.matrixAutoUpdate = false;
      ground.matrix.copy(world);
      ground.matrixWorld.copy(world);
      ground.frustumCulled = false;
      proxy.add(ground);
      return ground;
    };
    this.groundTrace = place(this.groundTraceMaterial);
    this.groundRaster = place(this.groundRasterMaterial);
    this.groundRaster.visible = false;
  }

  /** Real-time passes plus the mix, presented to the current target. */
  draw(
      renderer: WebGLRenderer, scene: ModelScene, camera: Camera,
      trace: Texture|null, options: TraceCompositeOptions) {
    renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, this.size.x);
    const height = Math.max(1, this.size.y);
    for (const target of [this.full, this.base, this.proxyTarget]) {
      if (target.width !== width || target.height !== height) {
        target.setSize(width, height);
      }
    }
    const output = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = true;
    const catcher = options.mode !== 'full' && options.groundShadow > 0 &&
        options.view === 'composite' && trace != null;
    const restore: Object3D[] = [];
    const hide = (object: Object3D|null|undefined) => {
      if (object != null && object.visible) {
        object.visible = false;
        restore.push(object);
      }
    };
    if (catcher) {
      // The traced catcher replaces the real-time and baked ground shadows.
      hide(scene.shadow);
      scene.bakedShadows.forEach(hide);
    }
    renderer.setRenderTarget(this.full);
    renderer.render(scene, camera);
    const hasBase = this.excluded.length > 0 && options.view === 'composite';
    if (hasBase) {
      const shown: Object3D[] = [];
      for (const mesh of this.excluded) {
        if (mesh.visible) {
          mesh.visible = false;
          shown.push(mesh);
        }
      }
      renderer.setRenderTarget(this.base);
      renderer.render(scene, camera);
      shown.forEach((mesh) => mesh.visible = true);
    }
    restore.forEach((object) => object.visible = true);

    const proxy = this.proxy;
    const hasProxy = proxy != null && options.mode !== 'full' &&
        options.view === 'composite';
    if (hasProxy) {
      renderer.getClearColor(this.clearColor);
      const clearAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      if (this.groundTrace != null && this.groundRaster != null) {
        this.groundTrace.visible = false;
        this.groundRaster.visible = true;
      }
      renderer.setRenderTarget(this.proxyTarget);
      renderer.render(proxy!, camera);
      if (this.groundTrace != null && this.groundRaster != null) {
        this.groundTrace.visible = true;
        this.groundRaster.visible = false;
      }
      renderer.setClearColor(this.clearColor, clearAlpha);
    }

    const uniforms = this.material.uniforms;
    uniforms.tFull.value = this.full.texture;
    uniforms.tBase.value = this.base.texture;
    uniforms.tProxy.value = this.proxyTarget.texture;
    uniforms.tTrace.value = trace;
    uniforms.groundShadow.value = options.groundShadow;
    uniforms.mode.value =
        options.mode === 'full' ? 0 : options.mode === 'shadows' ? 1 : 2;
    uniforms.view.value = trace == null ? 2 :
        options.view === 'trace'        ? 1 :
        options.view === 'realtime'     ? 2 :
                                          0;
    uniforms.hasBase.value = hasBase ? 1 : 0;
    uniforms.hasProxy.value = hasProxy ? 1 : 0;
    renderer.setRenderTarget(output);
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }

  private disposeProxy() {
    this.proxy?.clear();
    this.proxy = null;
    this.groundTrace = null;
    this.groundRaster = null;
    this.excluded = [];
  }

  private disposeMaterials() {
    this.materialCache.forEach((material) => material.dispose());
    this.materialCache.clear();
  }

  dispose() {
    this.disposeProxy();
    this.disposeMaterials();
    this.groundGeometry.dispose();
    this.groundTraceMaterial.dispose();
    this.groundRasterMaterial.dispose();
    this.full.dispose();
    this.base.dispose();
    this.proxyTarget.dispose();
    this.quad.dispose();
    this.material.dispose();
  }
}
