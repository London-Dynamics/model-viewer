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

import {Camera, CanvasTexture, Color, DataTexture, DoubleSide, HalfFloatType, InstancedMesh, LinearFilter, Material, Matrix4, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, NoBlending, NormalBlending, Object3D, PerspectiveCamera, PlaneGeometry, Scene, ShaderMaterial, SRGBColorSpace, Texture, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget} from 'three';
import {FullScreenQuad} from 'three/examples/jsm/postprocessing/Pass.js';

import {ModelScene} from '../../../ModelScene.js';

/**
 * What the WebGPU trace contributes to the picture. No baking: every mode
 * traces the current view and mixes it with the real-time render.
 *
 * - full: the trace replaces the model pixels (beauty).
 * - shadows: a white-diffuse trace divided by a real-time render of the same
 *   white scene gives a visibility ratio in [0, 1] that multiplies the
 *   real-time render. Quality `fast` traces one bounce with bounce and shadow
 *   rays cut at `aoDistance` (short-range ambient occlusion).
 * - lighting: a diffuse-proxy trace (real base colour, roughness 1, glass
 *   keeps transmission) replaces the real-time diffuse lighting.
 * - ground: only the burned ground shadow layer.
 *
 * The ground shadow is a separate layer in every mode but full: traced once
 * from above, burned into a texture on a ground plane, and drawn as part of
 * the real-time render, so it stays while the camera moves. It is re-traced
 * only when the model, its parts, the exclusions or the environment change.
 */
export type TraceMode = 'full'|'shadows'|'lighting'|'ground';

/** Which picture to present: the composite, the raw trace, or real-time. */
export type TraceView = 'composite'|'trace'|'realtime';

export type TraceShadowQuality = 'normal'|'fast';

export type TraceSamplesMode = 'fixed'|'adaptive';

/**
 * Per-mesh trace role.
 * - trace: default.
 * - exclude: not traced; drawn real-time on top, see-through.
 * - no-receive: traced and casts, but its own pixels stay real-time.
 * - receive-only: traced and receives, but does not block shadow rays.
 */
export type TraceRole = 'trace'|'exclude'|'no-receive'|'receive-only';

export interface TraceCompositeOptions {
  mode: TraceMode;
  view: TraceView;
  shadowQuality: TraceShadowQuality;
  /** Ray length of the fast shadow trace, world units (metres). */
  aoDistance: number;
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
  /**
   * `pattern[, pattern]: role` entries separated by `;` or new lines, with
   * the same pattern syntax as `exclude`. Later entries win over earlier
   * ones and over `exclude`.
   */
  materialRoles: string;
  /** Burned ground shadow strength. 0 turns the layer off. */
  groundShadow: number;
}

export const DEFAULT_TRACE_COMPOSITE_OPTIONS: TraceCompositeOptions = {
  mode: 'full',
  view: 'composite',
  shadowQuality: 'normal',
  aoDistance: 0.05,
  exclude: '',
  excludedCastShadow: false,
  materialRoles: '',
  groundShadow: 1,
};

const TRACE_MODES = new Set<TraceMode>(['full', 'shadows', 'lighting', 'ground']);
const TRACE_VIEWS = new Set<TraceView>(['composite', 'trace', 'realtime']);

export const parseTraceMode = (value: unknown): TraceMode =>
    TRACE_MODES.has(value as TraceMode) ? value as TraceMode : 'full';

export const parseTraceView = (value: unknown): TraceView =>
    TRACE_VIEWS.has(value as TraceView) ? value as TraceView : 'composite';

export const parseShadowQuality = (value: unknown): TraceShadowQuality =>
    value === 'fast' ? 'fast' : 'normal';

export const parseSamplesMode = (value: unknown): TraceSamplesMode =>
    value === 'adaptive' ? 'adaptive' : 'fixed';

/**
 * Composite passes read the trace as linear light. The WebGPU present writes
 * it with linear tone mapping at this exposure and sRGB encoding, so 8 bits
 * hold linear values up to 1 / TRACE_LINEAR_SCALE.
 */
export const TRACE_LINEAR_SCALE = 0.25;

/** Diffuse-proxy albedo floor, so metals still yield a visibility ratio. */
const PROXY_ALBEDO_FLOOR = 0.1;

/** Shadow amount burned under the model, where the top view sees the model. */
const GROUND_UNDER_MODEL = 0.85;

/** Camera layer that holds excluded meshes for the see-through pass. */
const EXCLUDED_LAYER = 30;

interface PatternRule {
  target: 'any'|'mesh'|'material';
  pattern: RegExp|null;
  semiTransparent: boolean;
}

const parsePattern = (token: string): PatternRule|null => {
  const trimmed = token.trim();
  if (trimmed === '') {
    return null;
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'semi-transparent' || lower === 'transparent' ||
      lower === 'semitransparent') {
    return {target: 'any', pattern: null, semiTransparent: true};
  }
  let target: PatternRule['target'] = 'any';
  let name = trimmed;
  const colon = trimmed.indexOf(':');
  if (colon > 0) {
    const prefix = lower.slice(0, colon);
    if (prefix === 'mesh' || prefix === 'material') {
      target = prefix;
      name = trimmed.slice(colon + 1).trim();
    }
  }
  const source = name.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return {target, pattern: new RegExp(`^${source}$`, 'i'), semiTransparent: false};
};

export interface RoleRule {
  rule: PatternRule;
  role: TraceRole;
}

const ROLE_NAMES: Record<string, TraceRole> = {
  'trace': 'trace',
  'include': 'trace',
  'exclude': 'exclude',
  'no-receive': 'no-receive',
  'noreceive': 'no-receive',
  'receive-only': 'receive-only',
  'no-cast': 'receive-only',
  'nocast': 'receive-only',
};

/** `exclude` tokens first, then `materialRoles` entries; the last match wins. */
export const parseRoles = (exclude: string, materialRoles: string): RoleRule[] => {
  const rules: RoleRule[] = [];
  for (const token of (exclude ?? '').split(/[,;\n]+/)) {
    const rule = parsePattern(token);
    if (rule != null) {
      rules.push({rule, role: 'exclude'});
    }
  }
  for (const entry of (materialRoles ?? '').split(/[;\n]+/)) {
    const split = entry.lastIndexOf(':');
    if (split <= 0) {
      continue;
    }
    const role = ROLE_NAMES[entry.slice(split + 1).trim().toLowerCase()];
    if (role == null) {
      continue;
    }
    for (const token of entry.slice(0, split).split(',')) {
      const rule = parsePattern(token);
      if (rule != null) {
        rules.push({rule, role});
      }
    }
  }
  return rules;
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

const matches = (mesh: Mesh, rule: PatternRule): boolean => {
  const materials = materialsOf(mesh);
  if (rule.semiTransparent) {
    return materials.some(isSemiTransparent);
  }
  const pattern = rule.pattern!;
  const meshNames = [mesh.name, mesh.userData?.name].filter(
      (name): name is string => typeof name === 'string' && name !== '');
  if (rule.target !== 'material' && meshNames.some((name) => pattern.test(name))) {
    return true;
  }
  return rule.target !== 'mesh' &&
      materials.some((material) => pattern.test(material.name));
};

export const roleOf = (mesh: Mesh, rules: RoleRule[]): TraceRole => {
  let role: TraceRole = 'trace';
  for (const entry of rules) {
    if (matches(mesh, entry.rule)) {
      role = entry.role;
    }
  }
  return role;
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

/** The real-time look of an excluded mesh: transmission becomes see-through. */
const seeThrough = (source: Material): Material => {
  const physical = source as MeshPhysicalMaterial;
  const transmission = physical.transmission ?? 0;
  if (transmission <= 0) {
    return source;
  }
  const material = physical.clone();
  material.name = `${source.name}::see-through`;
  material.transmission = 0;
  material.transparent = true;
  material.depthWrite = false;
  material.opacity = clamp01(
      (0.12 + 0.88 * (1 - transmission)) * (source.opacity ?? 1));
  return material;
};

/** Writes `alpha` as the coverage marker in the proxy raster. */
const markAlpha = (material: Material, alpha: number) => {
  material.blending = NoBlending;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>\n\tgl_FragColor.a = ${alpha.toFixed(2)};`);
  };
  material.customProgramCacheKey = () => `trace-alpha-${alpha}`;
};

/**
 * Linear-light composite. A is the real-time render without excluded meshes
 * and with the burned ground layer, P a real-time render of the trace proxy,
 * T the trace, G the see-through excluded meshes (premultiplied). All before
 * tone mapping. P.a marks coverage: 1 traced, 0.5 no-receive, 0 empty.
 *
 * shadows:  v = clamp(lum(T) / lum(P), 0, 1); C = A * v
 * lighting: v as above; C = T + (A - P) * v
 *   T replaces the real-time diffuse lighting P with the traced one, with
 *   shadows, occlusion and coloured bounce. What real-time adds on top of
 *   its own diffuse (A - P: reflections, clearcoat, sheen) is kept and
 *   occluded by v.
 * full:     C = T + (1 - T.a) * A
 * then:     C = mix(A, C, fade); out = G + (1 - G.a) * C
 */
const compositeFragment = /* glsl */ `
uniform sampler2D tBase;
uniform sampler2D tProxy;
uniform sampler2D tTrace;
uniform sampler2D tGlass;
uniform float traceScale;
uniform float mode;
uniform float view;
uniform float hasTrace;
uniform float hasProxy;
uniform float hasGlass;
uniform float fade;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 A = texture2D(tBase, vUv);
  vec4 Tr = hasTrace > 0.5 ? texture2D(tTrace, vUv) : vec4(0.0);
  vec3 T = Tr.rgb / traceScale * Tr.a;
  vec4 P = hasProxy > 0.5 ? texture2D(tProxy, vUv) : vec4(0.0);
  vec4 G = hasGlass > 0.5 ? texture2D(tGlass, vUv) : vec4(0.0);
  vec3 C = A.rgb;
  float a = A.a;
  if (view > 0.5) {
    C = hasTrace > 0.5 ? T : A.rgb;
    a = hasTrace > 0.5 ? Tr.a : A.a;
    G = vec4(0.0);
  } else if (hasTrace > 0.5) {
    vec3 traced = A.rgb;
    float tracedA = A.a;
    if (mode < 0.5) {
      traced = T + (1.0 - Tr.a) * A.rgb;
      tracedA = Tr.a + (1.0 - Tr.a) * A.a;
    } else if (P.a > 0.75) {
      float r = luma(P.rgb);
      float v = r > 1e-5 ? clamp(luma(T) / r, 0.0, 1.0) : 1.0;
      if (mode < 1.5) {
        traced = A.rgb * v;
      } else {
        traced = max(T + (A.rgb - P.rgb) * v, vec3(0.0));
      }
    }
    C = mix(A.rgb, traced, fade);
    a = mix(A.a, tracedA, fade);
  }
  C = G.rgb + (1.0 - G.a) * C;
  a = G.a + (1.0 - G.a) * a;
  gl_FragColor = vec4(max(C, vec3(0.0)), clamp(a, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Burn: the top-down white trace over the top-down raster of the same white
 * scene. Ground texels (P.a 0.5) store the shadow amount 1 - T / P. Texels
 * the top view sees the model in cannot see the ground; they take the mean
 * of the nearest ground texels in 16 directions, which is the contact
 * shadow around the footprint.
 */
const burnFragment = /* glsl */ `
uniform sampler2D tTrace;
uniform sampler2D tProxy;
uniform float traceScale;
uniform vec2 texel;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float shadowAt(vec2 uv) {
  vec4 P = texture2D(tProxy, uv);
  float r = luma(P.rgb);
  float t = luma(texture2D(tTrace, uv).rgb / traceScale);
  return r > 1e-5 ? clamp(1.0 - t / r, 0.0, 1.0) : 0.0;
}
void main() {
  vec4 P = texture2D(tProxy, vUv);
  float k = 0.0;
  if (P.a > 0.75) {
    float sum = 0.0;
    float n = 0.0;
    for (int d = 0; d < 16; d++) {
      float a = float(d) * 0.39269908;
      vec2 dir = vec2(cos(a), sin(a));
      for (int s = 1; s <= 40; s++) {
        float fs = float(s);
        vec2 uv = vUv + dir * texel * (fs * fs * 0.25 + fs);
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
          break;
        }
        float alpha = texture2D(tProxy, uv).a;
        if (alpha < 0.75) {
          if (alpha > 0.25) {
            sum += shadowAt(uv);
            n += 1.0;
          }
          break;
        }
      }
    }
    k = n > 0.0 ? min(sum / n, ${GROUND_UNDER_MODEL.toFixed(2)}) :
                  ${GROUND_UNDER_MODEL.toFixed(2)};
  } else if (P.a > 0.25) {
    k = shadowAt(vUv);
  }
  gl_FragColor = vec4(k, k, k, 1.0);
}
`;

const groundVertex = /* glsl */ `
uniform mat4 burnViewProjection;
varying vec4 vBurn;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vBurn = burnViewProjection * world;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const groundFragment = /* glsl */ `
uniform sampler2D tBurn;
uniform float strength;
varying vec4 vBurn;
varying vec2 vUv;
void main() {
  vec2 uv = vBurn.xy / vBurn.w * 0.5 + 0.5;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec2 edge = min(vUv, 1.0 - vUv);
  float border = smoothstep(0.0, 0.15, min(edge.x, edge.y));
  float k = texture2D(tBurn, uv).r * strength * inside * border;
  gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(k, 0.0, 1.0));
}
`;

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const makeTarget = (samples = 4) => new WebGLRenderTarget(1, 1, {
  type: HalfFloatType,
  samples,
  depthBuffer: true,
});

type ProxyKind = 'white'|'diffuse'|'full';

interface ProxyBuild {
  key: string;
  scene: Scene;
  ground: Mesh|null;
  /** Proxy meshes of excluded sources that still cast (hidden in P). */
  hiddenInRaster: Mesh[];
}

/** A traced scene and how to trace it, chosen by sync(). */
export interface TracePlan {
  scene: Scene;
  camera: Camera|null;
  bounces: number|null;
  maxRayDistance: number;
  key: string;
}

/**
 * Builds the scenes the WebGPU tracer sees, the burned ground layer, renders
 * the real-time passes into linear targets and mixes them with the trace.
 */
export class TraceComposite {
  private generation = 0;
  private rolesKey = '';
  private rules: RoleRule[] = [];
  private excluded: Mesh[] = [];
  private noReceive = new Set<Mesh>();
  private receiveOnly = new Set<Mesh>();
  private readonly proxies = new Map<ProxyKind, ProxyBuild>();
  private readonly materialCache = new Map<string, Material>();
  private readonly seeThroughCache = new Map<Material, Material>();
  private readonly groundGeometry = new PlaneGeometry(1, 1);
  private readonly groundWhite = new MeshStandardMaterial({
    name: 'trace-ground',
    color: 0xffffff,
    roughness: 1,
    metalness: 0,
    side: DoubleSide,
  });
  private readonly groundMarker: MeshStandardMaterial;
  private readonly whiteMap: DataTexture;
  private readonly depthOnly = new MeshBasicMaterial({colorWrite: false});

  // Burned ground layer.
  private groundWorld = new Matrix4();
  private groundExtent = 1;
  private groundCenter = new Vector3();
  private readonly burnCamera = new PerspectiveCamera(20, 1, 0.1, 100);
  private burnScene: ProxyBuild|null = null;
  private burnKey = '';
  private burnedKey = '';
  private readonly burnTarget = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    magFilter: LinearFilter,
    minFilter: LinearFilter,
    depthBuffer: false,
  });
  private readonly burnProxyTarget = makeTarget(0);
  private readonly burnMaterial: ShaderMaterial;
  private readonly burnQuad: FullScreenQuad;
  private readonly groundLayerMaterial: ShaderMaterial;
  private readonly groundLayer: Mesh;

  private readonly base = makeTarget();
  private readonly proxyTarget = makeTarget();
  private readonly glassTarget = makeTarget();
  private readonly quad: FullScreenQuad;
  private readonly material: ShaderMaterial;
  private readonly size = new Vector2();
  private readonly clearColor = new Color();

  constructor() {
    // The WebGPU tracer fails to compile its kernel when the first scene it
    // binds has no texture at all, so the ground always carries a white one.
    const white = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.colorSpace = SRGBColorSpace;
    white.needsUpdate = true;
    this.whiteMap = white;
    this.groundWhite.map = white;
    this.groundMarker = this.groundWhite.clone();
    this.groundMarker.name = 'trace-ground-marker';
    markAlpha(this.groundMarker, 0.5);

    this.material = new ShaderMaterial({
      uniforms: {
        tBase: {value: null},
        tProxy: {value: null},
        tTrace: {value: null},
        tGlass: {value: null},
        traceScale: {value: TRACE_LINEAR_SCALE},
        mode: {value: 0},
        view: {value: 0},
        hasTrace: {value: 0},
        hasProxy: {value: 0},
        hasGlass: {value: 0},
        fade: {value: 1},
      },
      vertexShader: quadVertex,
      fragmentShader: compositeFragment,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      toneMapped: true,
    });
    this.quad = new FullScreenQuad(this.material);
    this.burnMaterial = new ShaderMaterial({
      uniforms: {
        tTrace: {value: null},
        tProxy: {value: null},
        traceScale: {value: TRACE_LINEAR_SCALE},
        texel: {value: new Vector2(1, 1)},
      },
      vertexShader: quadVertex,
      fragmentShader: burnFragment,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
      toneMapped: false,
    });
    this.burnQuad = new FullScreenQuad(this.burnMaterial);
    this.groundLayerMaterial = new ShaderMaterial({
      uniforms: {
        tBurn: {value: this.burnTarget.texture},
        strength: {value: 1},
        burnViewProjection: {value: new Matrix4()},
      },
      vertexShader: groundVertex,
      fragmentShader: groundFragment,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      side: DoubleSide,
      toneMapped: false,
    });
    this.groundLayer = new Mesh(this.groundGeometry, this.groundLayerMaterial);
    this.groundLayer.name = 'TraceGroundLayer';
    this.groundLayer.matrixAutoUpdate = false;
    this.groundLayer.renderOrder = -1;
    this.groundLayer.frustumCulled = false;
  }

  /** Model load, geometry move or reset: rebuild the proxies and re-burn. */
  invalidate() {
    this.generation++;
  }

  excludedMeshes(): readonly Mesh[] {
    return this.excluded;
  }

  rolesSummary() {
    return {
      excluded: this.excluded.map((mesh) => mesh.name),
      noReceive: [...this.noReceive].map((mesh) => mesh.name),
      receiveOnly: [...this.receiveOnly].map((mesh) => mesh.name),
    };
  }

  get groundReady(): boolean {
    return this.burnedKey !== '' && this.burnedKey === this.burnKey;
  }

  private envKey(scene: Scene) {
    const r = scene.environmentRotation;
    return `${scene.environment?.uuid ?? ''},${scene.environmentIntensity.toFixed(4)},${r.x.toFixed(4)},${r.y.toFixed(4)},${r.z.toFixed(4)}`;
  }

  /** Re-reads roles and rebuilds proxies when the model or a setting changed. */
  private syncRoles(scene: ModelScene, options: TraceCompositeOptions) {
    const key = [this.generation, options.exclude, options.materialRoles,
                 options.excludedCastShadow].join('|');
    if (key === this.rolesKey) {
      return;
    }
    this.rolesKey = key;
    this.disposeProxies();
    this.rules = parseRoles(options.exclude, options.materialRoles);
    this.excluded.forEach((mesh) => mesh.layers.disable(EXCLUDED_LAYER));
    this.excluded = [];
    this.noReceive.clear();
    this.receiveOnly.clear();
    scene.updateMatrixWorld(true);
    const visit = (object: Object3D) => {
      if (!object.visible || hiddenFromTrace(object)) {
        return;
      }
      const mesh = object as Mesh;
      if (mesh.isMesh && mesh.geometry != null && mesh.material != null) {
        const role = roleOf(mesh, this.rules);
        if (role === 'exclude') {
          this.excluded.push(mesh);
          mesh.layers.enable(EXCLUDED_LAYER);
        } else if (role === 'no-receive') {
          this.noReceive.add(mesh);
        } else if (role === 'receive-only') {
          this.receiveOnly.add(mesh);
        }
      }
      for (const child of object.children) {
        visit(child);
      }
    };
    visit(scene);
    this.placeGround(scene);
  }

  private placeGround(scene: ModelScene) {
    const {boundingBox, size} = scene;
    const center = boundingBox.getCenter(new Vector3());
    const extent = Math.max(size.x, size.z, size.y * 0.5, 0.01) * 2.5;
    const gap = 0.001 * extent;
    const local = new Matrix4().compose(
        new Vector3(center.x, boundingBox.min.y - gap, center.z),
        new Object3D().rotateX(-Math.PI / 2).quaternion,
        new Vector3(extent, extent, 1));
    scene.target.updateMatrixWorld(true);
    this.groundWorld = scene.target.matrixWorld.clone().multiply(local);
    this.groundExtent = extent;
    this.groundCenter.setFromMatrixPosition(this.groundWorld);
  }

  private proxyMaterial(source: Material, kind: ProxyKind, mesh: Mesh): Material {
    const role = this.noReceive.has(mesh) ? 'nr' :
        this.receiveOnly.has(mesh)        ? 'ro' :
                                            '';
    if (kind === 'full' && role === '') {
      return source;
    }
    const key = `${source.uuid}|${kind}|${role}`;
    let proxy = this.materialCache.get(key);
    if (proxy == null) {
      proxy = kind === 'white' ? whiteProxy(source) :
          kind === 'diffuse'   ? diffuseProxy(source) :
                                 source.clone();
      if (role === 'nr') {
        markAlpha(proxy, 0.5);
      } else if (role === 'ro') {
        (proxy as unknown as {castShadow: boolean}).castShadow = false;
      }
      this.materialCache.set(key, proxy);
    }
    return proxy;
  }

  private cloneMesh(mesh: Mesh, kind: ProxyKind): Mesh {
    const materials = Array.isArray(mesh.material) ?
        mesh.material.map((entry) => this.proxyMaterial(entry, kind, mesh)) :
        this.proxyMaterial(mesh.material, kind, mesh);
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

  private addGround(proxy: Scene, material: Material): Mesh {
    const ground = new Mesh(this.groundGeometry, material);
    ground.name = 'TraceGroundCatcher';
    ground.matrixAutoUpdate = false;
    ground.matrix.copy(this.groundWorld);
    ground.matrixWorld.copy(this.groundWorld);
    ground.frustumCulled = false;
    proxy.add(ground);
    return ground;
  }

  private buildProxy(scene: ModelScene, kind: ProxyKind, ground: Material|null,
                     castExcluded: boolean): ProxyBuild {
    const proxy = new Scene();
    proxy.name = `TraceProxy-${kind}`;
    const excluded = new Set(this.excluded);
    const hiddenInRaster: Mesh[] = [];
    const visit = (object: Object3D) => {
      if (!object.visible || hiddenFromTrace(object)) {
        return;
      }
      const mesh = object as Mesh;
      if (mesh.isMesh && mesh.geometry != null && mesh.material != null) {
        const out = excluded.has(mesh);
        if (!out || castExcluded) {
          const clone = this.cloneMesh(mesh, kind);
          proxy.add(clone);
          if (out) {
            hiddenInRaster.push(clone);
          }
        }
      }
      for (const child of object.children) {
        visit(child);
      }
    };
    visit(scene);
    const groundMesh = ground != null ? this.addGround(proxy, ground) : null;
    proxy.updateMatrixWorld(true);
    return {key: '', scene: proxy, ground: groundMesh, hiddenInRaster};
  }

  private viewProxy(scene: ModelScene, options: TraceCompositeOptions): ProxyBuild {
    const kind: ProxyKind = options.mode === 'shadows' ? 'white' :
        options.mode === 'lighting' ? 'diffuse' :
                                      'full';
    const withGround = kind !== 'full' && options.groundShadow > 0;
    const key = `${kind}|${withGround}`;
    let build = this.proxies.get(kind);
    if (build == null || build.key !== key) {
      if (build != null) {
        build.scene.clear();
      }
      build = this.buildProxy(
          scene, kind, withGround ? this.groundWhite : null,
          options.excludedCastShadow);
      build.key = key;
      this.proxies.set(kind, build);
    }
    return build;
  }

  /**
   * The burn plan while the ground layer is out of date, else the view plan,
   * else null (ground mode, or the burned layer is all there is).
   */
  plan(scene: ModelScene, options: TraceCompositeOptions,
       drawingBuffer: Vector2): {burn: TracePlan|null, view: TracePlan|null} {
    this.syncRoles(scene, options);
    let burn: TracePlan|null = null;
    if (options.mode !== 'full' && options.groundShadow > 0) {
      this.burnKey = `${this.rolesKey}|${this.envKey(scene)}`;
      if (!this.groundReady) {
        if (this.burnScene == null) {
          this.burnScene = this.buildProxy(
              scene, 'white', this.groundWhite, options.excludedCastShadow);
        }
        const proxy = this.burnScene.scene;
        proxy.environment = scene.environment;
        proxy.environmentIntensity = scene.environmentIntensity;
        proxy.environmentRotation.copy(scene.environmentRotation);
        proxy.background = null;
        this.aimBurnCamera(drawingBuffer);
        burn = {
          scene: proxy,
          camera: this.burnCamera,
          bounces: null,
          maxRayDistance: 0,
          key: `burn|${this.burnKey}`,
        };
      }
    }
    let view: TracePlan|null = null;
    if (options.mode !== 'ground') {
      const build = this.viewProxy(scene, options);
      const proxy = build.scene;
      const fast = options.mode === 'shadows' && options.shadowQuality === 'fast';
      // Fast keeps the scene environment: the visibility ratio T / P
      // cancels it, and swapping the tracer's environment texture for a
      // uniform sky breaks its kernel compile (unresolved env sampler).
      proxy.environment = scene.environment;
      proxy.environmentIntensity = scene.environmentIntensity;
      proxy.environmentRotation.copy(scene.environmentRotation);
      proxy.background = null;
      const distance = fast ? Math.max(0.001, options.aoDistance) : 0;
      view = {
        scene: proxy,
        camera: null,
        bounces: fast ? 1 : null,
        maxRayDistance: distance,
        key: `view|${this.rolesKey}|${build.key}|${fast}|${distance}|${this.envKey(proxy)}`,
      };
    }
    return {burn, view};
  }

  /** Straight down onto the ground plane, covering it in both directions. */
  private aimBurnCamera(drawingBuffer: Vector2) {
    const aspect = Math.max(1e-3, drawingBuffer.x / Math.max(1, drawingBuffer.y));
    const height = this.groundExtent * 4;
    const halfSpan = this.groundExtent * 0.5 / Math.min(1, aspect);
    const camera = this.burnCamera;
    camera.fov = 2 * Math.atan(halfSpan / height) * 180 / Math.PI;
    camera.aspect = aspect;
    camera.near = height * 0.5;
    camera.far = height * 1.5;
    camera.up.set(0, 0, -1);
    camera.position.copy(this.groundCenter).add(new Vector3(0, height, 0));
    camera.lookAt(this.groundCenter);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  /** Turns the settled top-down trace into the ground shadow texture. */
  finishBurn(renderer: WebGLRenderer, trace: Texture) {
    const build = this.burnScene;
    if (build == null) {
      return;
    }
    const camera = this.burnCamera;
    const image = trace.image as {width?: number, height?: number}|null;
    const width = image?.width ?? 1;
    const height = image?.height ?? 1;
    this.burnTarget.setSize(width, height);
    this.burnProxyTarget.setSize(width, height);
    const output = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();
    renderer.autoClear = true;
    renderer.setClearColor(0x000000, 0);
    const ground = build.ground;
    if (ground != null) {
      ground.material = this.groundMarker;
    }
    renderer.setRenderTarget(this.burnProxyTarget);
    renderer.render(build.scene, camera);
    if (ground != null) {
      ground.material = this.groundWhite;
    }
    this.burnMaterial.uniforms.tTrace.value = trace;
    this.burnMaterial.uniforms.tProxy.value = this.burnProxyTarget.texture;
    (this.burnMaterial.uniforms.texel.value as Vector2).set(1 / width, 1 / height);
    renderer.setRenderTarget(this.burnTarget);
    this.burnQuad.render(renderer);
    renderer.setRenderTarget(output);
    renderer.setClearColor(this.clearColor, clearAlpha);
    renderer.autoClear = autoClear;
    camera.updateMatrixWorld(true);
    (this.groundLayerMaterial.uniforms.burnViewProjection.value as Matrix4)
        .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.groundLayer.matrix.copy(this.groundWorld);
    this.groundLayer.matrixWorld.copy(this.groundWorld);
    this.burnedKey = this.burnKey;
    build.scene.clear();
    this.burnScene = null;
  }

  /** The plain real-time picture, as the viewer draws it without a trace. */
  drawRealtime(renderer: WebGLRenderer, scene: ModelScene, camera: Camera) {
    renderer.render(scene, camera);
  }

  /**
   * Real-time passes plus the mix, presented to the current target. `trace`
   * is a settled, denoised snapshot or null; `fade` its weight.
   */
  draw(
      renderer: WebGLRenderer, scene: ModelScene, camera: Camera,
      trace: Texture|null, fade: number, options: TraceCompositeOptions,
      view: TracePlan|null) {
    renderer.getDrawingBufferSize(this.size);
    const width = Math.max(1, this.size.x);
    const height = Math.max(1, this.size.y);
    for (const target of [this.base, this.proxyTarget, this.glassTarget]) {
      if (target.width !== width || target.height !== height) {
        target.setSize(width, height);
      }
    }
    const output = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.getClearColor(this.clearColor);
    const clearAlpha = renderer.getClearAlpha();

    // A: real-time without excluded meshes, with the burned ground layer.
    const groundOn = options.mode !== 'full' && options.groundShadow > 0 &&
        this.groundReady;
    const restore: Object3D[] = [];
    const hide = (object: Object3D|null|undefined) => {
      if (object != null && object.visible) {
        object.visible = false;
        restore.push(object);
      }
    };
    if (groundOn) {
      hide(scene.shadow);
      scene.bakedShadows.forEach(hide);
      this.groundLayerMaterial.uniforms.strength.value =
          clamp01(options.groundShadow);
      scene.add(this.groundLayer);
    }
    this.excluded.forEach(hide);
    renderer.setRenderTarget(this.base);
    renderer.render(scene, camera);
    if (groundOn) {
      scene.remove(this.groundLayer);
    }

    // G: the excluded meshes, see-through, depth-tested against the rest.
    const hasGlass = this.excluded.length > 0 && options.view === 'composite';
    if (hasGlass) {
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(this.glassTarget);
      const override = scene.overrideMaterial;
      const background = scene.background;
      scene.background = null;
      scene.overrideMaterial = this.depthOnly;
      renderer.render(scene, camera);
      scene.overrideMaterial = override;
      restore.forEach((object) => object.visible = true);
      restore.length = 0;
      const swapped: Array<[Mesh, Material|Material[]]> = [];
      for (const mesh of this.excluded) {
        swapped.push([mesh, mesh.material]);
        mesh.material = Array.isArray(mesh.material) ?
            mesh.material.map((entry) => this.seeThroughOf(entry)) :
            this.seeThroughOf(mesh.material);
      }
      const mask = camera.layers.mask;
      camera.layers.set(EXCLUDED_LAYER);
      const lit: Object3D[] = [];
      scene.traverse((object) => {
        if ((object as unknown as {isLight?: boolean}).isLight &&
            !object.layers.isEnabled(EXCLUDED_LAYER)) {
          object.layers.enable(EXCLUDED_LAYER);
          lit.push(object);
        }
      });
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = true;
      lit.forEach((object) => object.layers.disable(EXCLUDED_LAYER));
      camera.layers.mask = mask;
      scene.background = background;
      swapped.forEach(([mesh, material]) => mesh.material = material);
    }
    restore.forEach((object) => object.visible = true);

    // P: the trace proxy in real-time, for the visibility ratio.
    const hasProxy = view != null && trace != null &&
        (options.mode === 'shadows' || options.mode === 'lighting') &&
        options.view === 'composite';
    if (hasProxy) {
      const build = this.proxies.get(options.mode === 'shadows' ? 'white' : 'diffuse');
      if (build != null) {
        renderer.setClearColor(0x000000, 0);
        const hidden: Object3D[] = [];
        if (build.ground != null && build.ground.visible) {
          build.ground.visible = false;
          hidden.push(build.ground);
        }
        for (const mesh of build.hiddenInRaster) {
          if (mesh.visible) {
            mesh.visible = false;
            hidden.push(mesh);
          }
        }
        renderer.setRenderTarget(this.proxyTarget);
        renderer.render(view!.scene, camera);
        hidden.forEach((object) => object.visible = true);
      }
    }
    renderer.setClearColor(this.clearColor, clearAlpha);

    const uniforms = this.material.uniforms;
    uniforms.tBase.value = this.base.texture;
    uniforms.tProxy.value = this.proxyTarget.texture;
    uniforms.tTrace.value = trace;
    uniforms.tGlass.value = this.glassTarget.texture;
    uniforms.mode.value = options.mode === 'full' ? 0 :
        options.mode === 'shadows'                ? 1 :
        options.mode === 'lighting'               ? 2 :
                                                    3;
    uniforms.view.value = options.view === 'trace' ? 1 : 0;
    uniforms.hasTrace.value = trace != null && options.mode !== 'ground' ? 1 : 0;
    uniforms.hasProxy.value = hasProxy ? 1 : 0;
    uniforms.hasGlass.value = hasGlass ? 1 : 0;
    uniforms.fade.value = clamp01(fade);
    renderer.setRenderTarget(output);
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }

  private seeThroughOf(material: Material): Material {
    let result = this.seeThroughCache.get(material);
    if (result == null) {
      result = seeThrough(material);
      this.seeThroughCache.set(material, result);
    }
    return result;
  }

  private disposeProxies() {
    this.proxies.forEach((build) => build.scene.clear());
    this.proxies.clear();
    this.burnScene?.scene.clear();
    this.burnScene = null;
    this.materialCache.forEach((material) => material.dispose());
    this.materialCache.clear();
    this.seeThroughCache.forEach((material, source) => {
      if (material !== source) {
        material.dispose();
      }
    });
    this.seeThroughCache.clear();
  }

  dispose() {
    this.excluded.forEach((mesh) => mesh.layers.disable(EXCLUDED_LAYER));
    this.disposeProxies();
    this.groundGeometry.dispose();
    this.groundWhite.dispose();
    this.groundMarker.dispose();
    this.whiteMap.dispose();
    this.depthOnly.dispose();
    this.burnTarget.dispose();
    this.burnProxyTarget.dispose();
    this.burnMaterial.dispose();
    this.burnQuad.dispose();
    this.groundLayerMaterial.dispose();
    this.base.dispose();
    this.proxyTarget.dispose();
    this.glassTarget.dispose();
    this.quad.dispose();
    this.material.dispose();
  }
}

/**
 * Settled trace frames copied off the WebGPU canvas. The composite only ever
 * shows a snapshot, never a frame in progress.
 */
export class TraceSnapshot {
  readonly canvas = document.createElement('canvas');
  readonly texture = new CanvasTexture(this.canvas);
  private readonly thumb = document.createElement('canvas');
  private previous: Float32Array|null = null;

  constructor() {
    this.texture.colorSpace = SRGBColorSpace;
    this.thumb.width = 96;
    this.thumb.height = 72;
  }

  capture(source: HTMLCanvasElement) {
    if (this.canvas.width !== source.width || this.canvas.height !== source.height) {
      this.canvas.width = source.width;
      this.canvas.height = source.height;
      this.texture.dispose();
    }
    const context = this.canvas.getContext('2d')!;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.drawImage(source, 0, 0);
    this.texture.needsUpdate = true;
  }

  /** Mean absolute luminance change (0-255) against the last call, or Infinity. */
  change(): number {
    const context = this.thumb.getContext('2d', {willReadFrequently: true})!;
    context.clearRect(0, 0, this.thumb.width, this.thumb.height);
    context.drawImage(this.canvas, 0, 0, this.thumb.width, this.thumb.height);
    const data = context.getImageData(0, 0, this.thumb.width, this.thumb.height).data;
    const luma = new Float32Array(data.length / 4);
    for (let i = 0; i < luma.length; i++) {
      luma[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
    }
    const previous = this.previous;
    this.previous = luma;
    if (previous == null || previous.length !== luma.length) {
      return Infinity;
    }
    let sum = 0;
    for (let i = 0; i < luma.length; i++) {
      sum += Math.abs(luma[i] - previous[i]);
    }
    return sum / luma.length;
  }

  forget() {
    this.previous = null;
  }

  dispose() {
    this.texture.dispose();
  }
}
