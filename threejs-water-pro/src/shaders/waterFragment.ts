// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import type { Node } from "three/webgpu";
import {
  texture,
  vec2,
  vec3,
  vec4,
  float,
  Fn,
  positionWorld,
  cameraPosition,
  dot,
  normalize,
  mix,
  clamp,
  screenUV,
  refract,
  reflect,
  sqrt,
  abs,
  pow,
  cameraNear,
  cameraFar,
  positionView,
  max,
  If,
  frontFacing,
} from "three/tsl";
import type { IWaveSimulation } from "../simulation/waves";
import type { IFoamFieldSampler } from "../simulation/foam";
import type { SkyProvider } from "../components/sky/SkyProvider";
import type { SurfaceUniforms } from "../uniforms";
import type { WaterVertexResult } from "./waterVertex";
import type { FoamBuildParams, FoamResult } from "./foamTypes";
import type { CascadeSampler } from "./cascadeSampler";
import {
  Foam,
  applyMask,
  applyClipPlane,
  getClipPlaneWaterline,
} from "./index";
import { type Fresnel, fresnelDielectric } from "./fresnel";
import { type WaterColor, buildReflectionSampling } from "./waterColor";
import type { SurfaceFoam } from "./foamSurface";
import type { WaveFoam } from "./foamWaves";
import type { ShorelineFoam } from "./foamShoreline";
import type { Sparkle } from "./sparkle";
import { type SSR, type SSRResult } from "./ssr";
import type { SSS } from "./sss";
import type { RainRipples } from "../simulation/ripples";
import type { IWakeFieldSampler } from "../simulation/waves/wake";
import type { SceneDepthSampler } from "../rendering/passes/SceneDepthSampler";
import type { IWaterDepthPass } from "../rendering/passes/IWaterDepthPass";
import {
  buildWaterSurfaceNormal,
  type BuildWaterSurfaceNormalParams,
} from "./waterNormal";

// ============= Exported Types =============

export interface WaterTextures {
  /** Screen-space water mask. Omitted while masking is inactive. */
  mask?: THREE.Texture;
  sceneColor: THREE.Texture;
  /** Normalized-linear scene depth sampler from the scene capture pass. */
  sceneDepth: SceneDepthSampler;
}

export interface WaterFragmentParams {
  uniforms: SurfaceUniforms;
  vertex: WaterVertexResult;
  oceanSim: IWaveSimulation;
  textures: WaterTextures;
  // Shader class instances
  waterColor: WaterColor;
  fresnel: Fresnel;
  surfaceFoam: SurfaceFoam;
  waveFoam: WaveFoam;
  shorelineFoam: ShorelineFoam;
  sparkle: Sparkle;
  ssr: SSR;
  sss: SSS;
  sky: SkyProvider | null;
  /** CascadeSampler instance for WebGPU path. Null for WebGL. */
  cascadeSampler: CascadeSampler | null;
  /**
   * Persistent foam-energy field sampler. When provided (on quality tiers with
   * wave foam enabled), wave-crest foam reads its energy for streaks and decay
   * tails. Null on tiers where wave foam is off.
   */
  foamFieldSampler: IFoamFieldSampler | null;
  /** Rain ripple simulation for normal blending. Null if not initialized. */
  rainRipples: RainRipples | null;
  /** Wake field sampler for wake normal blending. Null on WebGL or disabled. */
  wakeFieldSampler: IWakeFieldSampler | null;
  /**
   * Water-surface depth source for the refracted-column measurement. Null
   * until `RenderPassManager` binds it; the refraction path then falls back
   * to the fragment's own surface depth.
   */
  waterDepth: IWaterDepthPass | null;
  /** Whether running on WebGL backend (disables clip plane for split view). */
  isWebGL?: boolean;
}

// ============= Pipeline Stage Functions =============

/** Clip-plane waterline uniforms slice of {@link SurfaceUniforms}. */
type ClipPlaneUniforms = SurfaceUniforms["clipPlane"];

/**
 * Maps sub-footprint slope variance (0-1) to added reflection roughness. The
 * variance is a length-deficit proxy, not a calibrated Beckmann σ², so this is
 * a tuning scale: higher blurs the distant sky reflection sooner.
 */
const VARIANCE_TO_ROUGHNESS = 0.8;

/**
 * How fast screen-space reflections fade out as the reflection roughness rises.
 * SSR is only valid for a near-mirror surface; past roughness ≈ `1 / this` it
 * is fully replaced by the prefiltered environment.
 */
const SSR_ROUGHNESS_FADE = 3.0;

/**
 * Detects the waterline where the surface intersects the clip plane.
 * Factor stays 0 (and the meniscus direction up) when the waterline is
 * disabled.
 */
function computeWaterline(clipPlane: ClipPlaneUniforms): {
  meniscusDir: Node;
  waterlineFactor: Node;
} {
  const waterlineFactor = float(0.0).toVar("waterlineFactor");
  const meniscusDir = vec3(0.0, 1.0, 0.0).toVar("meniscusDir");

  If(clipPlane.waterlineEnabled.greaterThan(0.5), () => {
    const waterlineResult = getClipPlaneWaterline({
      cameraForward: clipPlane.cameraForward,
      clipDistance: clipPlane.distance,
      thickness: clipPlane.waterlineThickness,
      smoothness: clipPlane.waterlineSmoothness,
    });
    waterlineFactor.assign(waterlineResult.factor);
    meniscusDir.assign(waterlineResult.meniscusDir);
  });

  return { meniscusDir, waterlineFactor };
}

/** Parameters for the surface-normal stage. */
interface SurfaceNormalParams {
  clipPlane: ClipPlaneUniforms;
  meniscusDir: Node;
  normal: BuildWaterSurfaceNormalParams;
  waterlineFactor: Node;
}

/**
 * Builds the wave-surface normal, then tilts it toward the camera at the
 * waterline to simulate the curved meniscus profile.
 */
function computeSurfaceNormal(params: SurfaceNormalParams): {
  interpolatedNormal: Node;
  rippleSplash: Node | null;
  slopeVariance: Node;
} {
  const { clipPlane, meniscusDir, normal, waterlineFactor } = params;

  const normalResult = buildWaterSurfaceNormal(normal);

  const normalTiltAmount = waterlineFactor.mul(
    clipPlane.waterlineNormalStrength,
  );
  const perturbedNormal = normalize(
    mix(normalResult.interpolatedNormal, meniscusDir, normalTiltAmount),
  );
  const interpolatedNormal = mix(
    normalResult.interpolatedNormal,
    perturbedNormal,
    waterlineFactor,
  );

  return {
    interpolatedNormal,
    rippleSplash: normalResult.rippleSplash,
    slopeVariance: normalResult.slopeVariance,
  };
}

/** Parameters for the water-color and reflection stage. */
interface ReflectionStageParams {
  frontFaceMultiplier: Node;
  reflectionNormal: Node;
  /** Added reflection roughness from sub-footprint slope variance. */
  reflectionRoughness: Node;
  sky: SkyProvider | null;
  ssr: SSR;
  textures: WaterTextures;
  uniforms: SurfaceUniforms;
  viewDir: Node;
  waterColor: WaterColor;
}

/**
 * Samples water color from depth, computes sky/environment reflections,
 * and optionally blends in screen-space reflections.
 */
function sampleReflections(params: ReflectionStageParams): {
  isObjectInFront: Node;
  reflectDir: Node;
  reflectionColor: Node;
  reflectionSampler: ((dir: Node, roughness: Node) => Node) | undefined;
  waterColor: Node;
  waterColumnDepth: Node;
} {
  const {
    frontFaceMultiplier,
    reflectionNormal,
    reflectionRoughness,
    sky,
    ssr,
    textures,
    uniforms,
    viewDir,
    waterColor: waterColorInstance,
  } = params;

  // .toVar() works around a Three.js TSL bug (r181) where the texture binding
  // is dropped unless the sample is forced into a concrete WGSL variable.
  const depthSample = textures.sceneDepth.sample(screenUV).toVar("depthSample");

  const reflectionSampler = sky?.createReflectionSampler();

  // Intrinsic water color, plus the unrefracted-UV water-column depth
  // consumed by the distance-aware foam/SSS paths.
  const { waterColor, waterColumnDepth, isObjectInFront } =
    waterColorInstance.build({
      depthSample,
      viewDirY: viewDir.y,
      useDepthTexture: uniforms.useDepthTexture,
    });

  // Reflection sampling
  const { reflectionColor: baseReflectionColor, reflectDir } =
    buildReflectionSampling({
      viewDir,
      reflectionNormal,
      reflectionSampler,
      roughness: reflectionRoughness,
    });

  // Screen-space reflections (front face only). The DDA march runs as a
  // separate pass at scaled resolution; sample its result.
  const ssrResult: SSRResult = ssr.sample(screenUV);

  // Fade SSR out as the surface roughens. SSR is a single sharp mirror ray;
  // on rough / distant water the specular lobe is wide, so a sharp screen-space
  // sample is invalid and smears grazing content (bright foam and crests) into
  // white streaks. Where the slope variance is high, fall back to the
  // prefiltered environment instead.
  const ssrSharpness = clamp(
    float(1.0).sub(reflectionRoughness.mul(SSR_ROUGHNESS_FADE)),
    0.0,
    1.0,
  );
  const ssrBlendWeight = ssrResult.ssrHitMask
    .mul(frontFaceMultiplier)
    .mul(ssrSharpness);
  const reflectionColor: Node = mix(
    baseReflectionColor,
    ssrResult.ssrColor,
    ssrBlendWeight,
  );

  return {
    isObjectInFront,
    reflectDir,
    reflectionColor,
    reflectionSampler,
    waterColor,
    waterColumnDepth,
  };
}

/** Parameters for the above-water refraction sample. */
interface AboveWaterRefractionParams {
  fresnel: Fresnel;
  /** Upward-pointing surface normal. */
  normal: Node;
  sceneColorTexture: THREE.Texture;
  /** Scene depth sampler (the same one passed to {@link WaterColor.build}). */
  sceneDepth: SceneDepthSampler;
  /** Water-surface depth source, or null before the pass is bound. */
  waterDepth: IWaterDepthPass | null;
  waterColor: WaterColor;
}

/**
 * Samples the underwater scene through the water surface for an
 * above-water observer. Offsets the screen UV by the surface normal
 * scaled by `refractionStrength`; the underwater scene is whatever was
 * rendered into `sceneColorTexture` before the water surface drew.
 *
 * Depth is sampled at the **same** refracted UV as the colour so that
 * Beer-Lambert attenuation matches what is actually being viewed.
 * Mismatched (color-refracted, depth-unrefracted) sampling produces a
 * bright halo around displaced underwater silhouettes: the fish's real
 * screen position has near-surface depth — high clearFactor — but the
 * colour sample at that position is adjacent seabed, so the seabed
 * shows through almost unattenuated.
 */
function computeAboveWaterRefraction(params: AboveWaterRefractionParams): {
  refractedClearFactor: Node;
  refractedSceneColor: Node;
  refractedWaterColor: Node;
} {
  const {
    fresnel,
    normal,
    sceneColorTexture,
    sceneDepth,
    waterDepth,
    waterColor,
  } = params;

  const waterSurfaceViewDepth = positionView.z.negate();

  // Attenuate the offset by how thick the water column is beneath this
  // fragment. The refracted ray's lateral displacement scales with the
  // path it travels through water before reaching the seabed, so a thin
  // column must produce a small offset. Without this, steep waves over a
  // near-surface floor push each fragment's sample far across the seabed
  // and neighbouring fragments smear into wildly different patches. The
  // gap is measured at the unrefracted screen UV to avoid a circular
  // dependency, mirroring the back-face path.
  const waterNormDepth: Node = waterSurfaceViewDepth
    .sub(cameraNear)
    .div(cameraFar.sub(cameraNear));
  const sceneNormDepthAtScreen: Node = sceneDepth.sample(screenUV);
  const depthGap: Node = clamp(
    sceneNormDepthAtScreen
      .sub(waterNormDepth)
      .div(sceneNormDepthAtScreen.add(0.0001)),
    0.0,
    1.0,
  );

  // Candidate refracted UV from the normal offset. If this lands on an
  // above-water occluder (sail, mast, hull), sampling there would pull
  // the occluder's color and depth into the water surface — the
  // ship-silhouette bleed you see when the offset crosses a foreground
  // silhouette. Fall back to the unrefracted screen UV in that case so
  // the surface reads its own pixel's seabed instead of an adjacent
  // foreground object.
  const refractionOffset: Node = vec2(
    normal.x.mul(fresnel._refractionStrengthNode).mul(depthGap),
    normal.z.mul(fresnel._refractionStrengthNode).mul(depthGap),
  );
  const refractionUVCandidate: Node = screenUV.add(refractionOffset);
  const candidateSceneDepth = sceneDepth
    .sample(refractionUVCandidate)
    .mul(cameraFar.sub(cameraNear))
    .add(cameraNear);
  const offsetHitsForeground: Node = candidateSceneDepth.lessThan(
    waterSurfaceViewDepth,
  );
  const refractionUV: Node = offsetHitsForeground.select(
    screenUV,
    refractionUVCandidate,
  );

  const sceneSample = texture(sceneColorTexture, refractionUV);
  const refractedSceneColor = vec3(sceneSample.x, sceneSample.y, sceneSample.z);

  const sceneLinearDepth = sceneDepth
    .sample(refractionUV)
    .mul(cameraFar.sub(cameraNear))
    .add(cameraNear);

  // Both ends of the column belong to one ray: the surface depth is sampled
  // at the same refracted UV as the seabed depth. Where the shifted UV has no
  // water (sentinel 1.0, e.g. above the horizon), the fragment's own surface
  // depth is the only measurement available.
  let columnStartDepth: Node = waterSurfaceViewDepth;
  if (waterDepth) {
    const surfaceNormDepthAtRefracted =
      waterDepth.sampleUnclippedFrontDepth(refractionUV);
    const surfaceDepthAtRefracted = surfaceNormDepthAtRefracted
      .mul(cameraFar.sub(cameraNear))
      .add(cameraNear);
    const hasWaterAtRefracted = surfaceNormDepthAtRefracted.lessThan(0.999);
    columnStartDepth = hasWaterAtRefracted.select(
      surfaceDepthAtRefracted,
      waterSurfaceViewDepth,
    );
  }
  const waterColumnDepth = max(
    sceneLinearDepth.sub(columnStartDepth),
    float(0.0),
  );
  const refractedClearFactor = waterColor.buildClearFactor(waterColumnDepth);
  const refractedWaterColor = waterColor.buildMediumColor();

  return {
    refractedClearFactor,
    refractedSceneColor,
    refractedWaterColor,
  };
}

/** Parameters for the underwater surface optics computation. */
interface UnderwaterSurfaceParams {
  fresnel: Fresnel;
  /** Upward-pointing surface normal (same as the front-face normal). */
  normal: Node;
  reflectionSampler: ((dir: Node, roughness: Node) => Node) | undefined;
  sceneColorTexture: THREE.Texture;
  sceneDepth: SceneDepthSampler;
  viewDir: Node;
}

/**
 * Computes the surface color seen by an underwater observer looking up at
 * the water-air interface. Reflectance comes from the same dielectric
 * Fresnel function used above water; TIR is the natural `F = 1` case past
 * the critical angle. The Snell's window contents (refracted hemisphere)
 * composite the screen-space scene capture, by its coverage alpha, over
 * sky sampled along the refracted direction.
 */
function computeUnderwaterSurface(params: UnderwaterSurfaceParams): {
  surfaceColor: Node;
  reflectance: Node;
} {
  const {
    fresnel,
    normal,
    reflectionSampler,
    sceneColorTexture,
    sceneDepth,
    viewDir,
  } = params;

  // Reflectance from the unified dielectric Fresnel. On the back face,
  // dot(viewDir, normal) is negative; fresnelDielectric flips eta
  // internally and returns 1.0 in the TIR region.
  const cosThetaI = dot(viewDir, normal);
  const reflectance = fresnelDielectric({
    cosThetaI,
    eta: fresnel._iorRatioNode,
  });

  // Refracted direction (ray exiting water into air). GLSL's `refract`
  // expects `eta = n_incident / n_transmitted`. Here the incident medium
  // is water and the transmitted medium is air, so eta is `iorRatio`
  // directly — not its reciprocal (which would describe air→water).
  // `flippedNormal` points into the incident medium (water), opposing the
  // upward camera ray.
  const flippedNormal = vec3(
    normal.x.negate(),
    normal.y.negate(),
    normal.z.negate(),
  );
  const refractedDir = refract(
    viewDir.negate(),
    flippedNormal,
    fresnel._iorRatioNode,
  );
  const refractedLen = sqrt(
    refractedDir.x
      .mul(refractedDir.x)
      .add(refractedDir.y.mul(refractedDir.y))
      .add(refractedDir.z.mul(refractedDir.z)),
  );
  const isTIR = refractedLen.lessThan(0.001);

  // Screen-space refraction UV. Distance-from-surface scaling keeps
  // near-surface objects from smearing.
  const waterViewDepth: Node = positionView.z.negate();
  const waterNormDepth: Node = waterViewDepth
    .sub(cameraNear)
    .div(cameraFar.sub(cameraNear));
  const sceneNormDepthAtScreen: Node = sceneDepth.sample(screenUV);
  const depthGap: Node = clamp(
    sceneNormDepthAtScreen
      .sub(waterNormDepth)
      .div(sceneNormDepthAtScreen.add(0.0001)),
    0.0,
    1.0,
  );

  const refractionOffset = vec2(
    normal.x.mul(fresnel._refractionStrengthNode).mul(depthGap),
    normal.z.mul(fresnel._refractionStrengthNode).mul(depthGap),
  );
  const refractionUV: Node = screenUV.add(refractionOffset);

  // Snell's window: the capture's alpha is scene coverage, so composite
  // it over sky sampled along the refracted direction (sky at infinity).
  // F = 1 in TIR regions zeroes this branch; the up-direction substitute
  // only keeps refract()'s zero vector out of the sampler.
  const refractedSceneColor = texture(sceneColorTexture, refractionUV);
  const refractedSceneRGB = vec3(
    refractedSceneColor.x,
    refractedSceneColor.y,
    refractedSceneColor.z,
  );
  let snellsWindow: Node = refractedSceneRGB;
  if (reflectionSampler) {
    const safeRefractedDir = isTIR.select(
      vec3(0.0, 1.0, 0.0),
      normalize(refractedDir),
    );
    const refractedSkyColor = reflectionSampler(safeRefractedDir, float(0.0));
    const skyCoverage = refractedSceneColor.w.oneMinus();
    snellsWindow = refractedSceneRGB.add(refractedSkyColor.mul(skyCoverage));
  }

  // TIR limb: sample the sky along the mirror-reflected view direction so
  // grazing back-face viewing stays tonally consistent with the
  // above-water grazing path, which also samples the sky.
  let underwaterReflection: Node = vec3(0.1, 0.2, 0.3);
  if (reflectionSampler) {
    const mirrorReflectDir = reflect(viewDir.negate(), normal);
    underwaterReflection = reflectionSampler(mirrorReflectDir, float(0.0));
  }

  // Mix transmitted (Snell's window) with reflected (underwater) by F.
  const surfaceColor: Node = mix(
    snellsWindow,
    underwaterReflection,
    reflectance,
  );

  return { surfaceColor, reflectance };
}

/**
 * Parameters for the foam stage: {@link FoamBuildParams} minus the sampled
 * energies, which this stage samples itself from the two fields.
 */
interface FoamStageParams
  extends Omit<FoamBuildParams, "foamEnergy" | "wakeFoamEnergy"> {
  foamFieldSampler: IFoamFieldSampler | null;
  /** True (choppy-displaced) world position, matching the wake field anchor. */
  wakeCoords: { wakeWorldX: Node; wakeWorldZ: Node };
  wakeFieldSampler: IWakeFieldSampler | null;
}

/**
 * Samples the persistent foam-energy fields and builds the combined
 * surface, wave-crest, and shoreline foam.
 */
function computeFoam(params: FoamStageParams): FoamResult {
  const { foamFieldSampler, wakeCoords, wakeFieldSampler, ...foamParams } =
    params;

  // Sample the world-fixed foam-energy field. Its injection already combines
  // the FFT cascades at each texel's world position, so a single sample
  // carries persistent, interacting wave-crest foam.
  let foamEnergy: Node | undefined;
  if (foamFieldSampler) {
    foamEnergy = foamFieldSampler.sampleEnergy(
      foamParams.coords.fragWorldX,
      foamParams.coords.fragWorldZ,
    );
  }

  // The wake maintains its own world-anchored persistent foam-energy field
  // (the FFT one is a tiled cascade and can't hold a world-absolute wake).
  // Route it through WaveFoam as a dedicated energy input so it renders the
  // same textured foam, alongside the crest foam.
  let wakeFoamEnergy: Node | undefined;
  if (wakeFieldSampler) {
    wakeFoamEnergy = wakeFieldSampler.sampleFoamEnergy(
      wakeCoords.wakeWorldX,
      wakeCoords.wakeWorldZ,
    );
  }

  return new Foam().build({ ...foamParams, foamEnergy, wakeFoamEnergy });
}

/** Output of {@link compositeColor}: radiance + alpha. */
interface CompositeResult {
  /**
   * 0–1 surface alpha. The front-face composite samples the refracted
   * scene explicitly, so the surface is opaque (alpha = 1) outside the
   * shoreline zone fade applied downstream; the shoreline-zone path
   * still pulls alpha toward zero to expose the beach.
   */
  alpha: Node;
  /**
   * RGB radiance the surface emits toward the camera. Excludes
   * shoreline foam, which is composited later after the shoreline zone
   * fade.
   */
  color: Node;
}

/** Parameters for the final radiance composite. */
interface CompositeColorParams {
  /** Per-channel Beer-Lambert clear fraction at the refracted UV. */
  clearFactor: Node;
  distanceToCamera: Node;
  foamResult: FoamResult;
  frontFaceMultiplier: Node;
  interpolatedNormal: Node;
  reflectionColor: Node;
  refractedSceneColor: Node;
  sparkle: Sparkle;
  sunDir: Node;
  sunIntensity: Node;
  viewDir: Node;
  waterColorWithSSS: Node;
}

/**
 * Composites the water surface's emitted radiance and per-fragment alpha.
 *
 * Front face: explicit Fresnel mix of refracted-scene transmission and
 * sky/SSR reflection. The refracted scene sample is taken upstream
 * (`computeAboveWaterRefraction`) and passed in here as
 * `refractedSceneColor`; Beer-Lambert weights it against the water tint
 * by `clearFactor`. Output is opaque on the front face so the seabed
 * warps with the waves.
 *
 * Back face: `reflectionColor` is the complete `computeUnderwaterSurface`
 * output (Snell's window + TIR mix) and passes through unchanged.
 */
function compositeColor(params: CompositeColorParams): CompositeResult {
  const {
    clearFactor,
    distanceToCamera,
    foamResult,
    frontFaceMultiplier,
    interpolatedNormal,
    reflectionColor,
    refractedSceneColor,
    sparkle: sparkleInstance,
    sunDir,
    sunIntensity,
    viewDir,
    waterColorWithSSS,
  } = params;

  // Transmitted radiance through the water column. Per-channel
  // Beer-Lambert: refracted seabed attenuated by `clearFactor` plus the
  // water's intrinsic in-scatter color scaled by `(1 − clearFactor)`.
  // Because `clearFactor` is a vec3, red can die faster than blue and the
  // seabed reads bluer with depth — the wavelength-dependent attenuation
  // that gives clear ocean its colour.
  const transmittedColor = mix(
    waterColorWithSSS,
    refractedSceneColor,
    clearFactor,
  );

  // Front-face surface radiance: explicit Fresnel mix between the
  // transmitted seabed view and the reflected sky/SSR.
  const frontFaceColor: Node = mix(
    transmittedColor,
    reflectionColor,
    foamResult.effectiveFresnel,
  );
  // Back face passes through the complete underwater composite (Snell's
  // window + TIR) produced upstream by `computeUnderwaterSurface`.
  let finalColor: Node = mix(
    reflectionColor,
    frontFaceColor,
    frontFaceMultiplier,
  );

  // Opaque on both faces; the shoreline-zone fade downstream brings alpha
  // toward zero where the beach must show through.
  let alpha: Node = float(1.0);

  // Sparkle: additive sun glints. Light added by the surface; alpha unchanged.
  const sparkleGlint = sparkleInstance.build({
    viewDir,
    sunDir,
    sunIntensity,
    distanceToCamera,
    interpolatedNormal,
    earlyFoamStrength: foamResult.earlyFoamStrength,
  });
  finalColor = vec3(
    finalColor.x.add(sparkleGlint),
    finalColor.y.add(sparkleGlint),
    finalColor.z.add(sparkleGlint),
  );

  // Surface + turbulent foam: Lambertian-shaded matte color, opaque overlay.
  const NdotL = clamp(dot(interpolatedNormal, sunDir), 0.0, 1.0);
  const diffuseFoamColor = vec3(
    foamResult.combinedFoamColor.x.mul(float(0.3).add(NdotL.mul(0.7))),
    foamResult.combinedFoamColor.y.mul(float(0.3).add(NdotL.mul(0.7))),
    foamResult.combinedFoamColor.z.mul(float(0.3).add(NdotL.mul(0.7))),
  );
  finalColor = mix(
    finalColor,
    diffuseFoamColor,
    foamResult.combinedFoamStrength,
  );
  alpha = mix(alpha, float(1.0), foamResult.combinedFoamStrength);

  return { color: finalColor, alpha };
}

/** Parameters for the shoreline-zone composite. */
interface ShorelineZoneParams {
  composite: CompositeResult;
  foamResult: FoamResult;
  frontFaceMultiplier: Node;
  shorelineFoam: ShorelineFoam;
}

/**
 * Fades the water out across the shoreline zone so the beach/terrain
 * shows through, then composites shoreline foam on top so foam patches
 * stay opaque.
 */
function applyShorelineZone(params: ShorelineZoneParams): CompositeResult {
  const { composite, foamResult, frontFaceMultiplier, shorelineFoam } = params;

  const activeZoneMask = foamResult.shorelineZoneMask
    .mul(shorelineFoam._enabledNode)
    .mul(frontFaceMultiplier);
  const zoneFade = float(1.0).sub(activeZoneMask);
  const fadedColor = vec3(
    composite.color.x.mul(zoneFade),
    composite.color.y.mul(zoneFade),
    composite.color.z.mul(zoneFade),
  );
  const fadedAlpha = composite.alpha.mul(zoneFade);

  const foamCoverage =
    foamResult.shorelineFoamStrength.mul(frontFaceMultiplier);
  const color = mix(fadedColor, foamResult.shorelineFoamTint, foamCoverage);
  const alpha = mix(fadedAlpha, float(1.0), foamCoverage);

  return { color, alpha };
}

/** Parameters for the waterline rim highlight. */
interface WaterlineRimParams {
  clipPlane: ClipPlaneUniforms;
  meniscusDir: Node;
  viewDir: Node;
  waterlineFactor: Node;
}

/**
 * Rim highlight at the waterline: at grazing angles to the meniscus,
 * light focuses into a bright edge.
 */
function computeWaterlineRim(params: WaterlineRimParams): Node {
  const { clipPlane, meniscusDir, viewDir, waterlineFactor } = params;

  const meniscusNdotV = abs(dot(viewDir, meniscusDir));
  const rimFactor = pow(
    float(1.0).sub(meniscusNdotV),
    clipPlane.waterlineHighlightSharpness,
  );
  return rimFactor
    .mul(waterlineFactor)
    .mul(clipPlane.waterlineHighlightStrength);
}

// ============= Main Builder =============

/**
 * Builds the full fragment color shader graph for the water surface.
 * Returns a vec4 node (RGB color + alpha).
 */
export function buildWaterFragmentColor(params: WaterFragmentParams): Node {
  const {
    uniforms,
    vertex,
    oceanSim,
    textures,
    waterColor: waterColorInstance,
    fresnel: fresnelInstance,
    surfaceFoam: surfaceFoamInstance,
    waveFoam: waveFoamInstance,
    shorelineFoam: shorelineFoamInstance,
    sparkle: sparkleInstance,
    ssr,
    sss,
    sky,
    cascadeSampler,
    foamFieldSampler,
    rainRipples,
    wakeFieldSampler,
    waterDepth,
  } = params;
  const { clipPlane, maskEnabled, sun } = uniforms;

  const { vSampleCoords, vHierarchicalCoords, worldX, worldZ } = vertex;

  const customColor = Fn(() => {
    if (textures.mask) {
      applyMask(textures.mask, maskEnabled);
    }
    applyClipPlane(clipPlane.cameraForward, clipPlane.distance);

    // Above water, force front-face: `frontFacing` is ill-defined on
    // edge-on triangles (flat horizon, choppy crests) and paints back-face
    // Snell's window as bright specks. When submerged, per-fragment
    // `frontFacing` lets a barely-submerged camera show Snell's window
    // through crests and the front-face composite through troughs in the
    // same frame.
    const isFrontFace = uniforms.cameraSubmerged.lessThan(0.5).or(frontFacing);
    const frontFaceMultiplier = isFrontFace.select(float(1.0), float(0.0));

    const { meniscusDir, waterlineFactor } = computeWaterline(clipPlane);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fragWorldX = vSampleCoords.x;
    const fragWorldZ = vSampleCoords.y;

    // The wake field is world-anchored; sample it at the true (choppy-displaced)
    // fragment world position rather than the grid-reference coords so it stays
    // pinned under the ship instead of shearing off with the FFT horizontal
    // displacement in rough seas.
    const wakeWorldX = positionWorld.x;
    const wakeWorldZ = positionWorld.z;

    // 1. Surface normals (shared with the SSR G-buffer pass), tilted at
    // the waterline meniscus.
    const { interpolatedNormal, rippleSplash, slopeVariance } =
      computeSurfaceNormal({
        clipPlane,
        meniscusDir,
        normal: {
          oceanSim,
          cascadeSampler,
          fragWorldX,
          fragWorldZ,
          wakeWorldX,
          wakeWorldZ,
          vHierarchicalCoords,
          rainRipples,
          wakeFieldSampler,
          cameraPosition,
          frontFaceMultiplier,
        },
        waterlineFactor,
      });

    // Filtered-BRDF reflection roughness from the sub-footprint wave slopes the
    // normal mips fold away. Reading a rougher prefiltered environment mip where
    // the waves are unresolved breaks up the distant sky mirror and tracks wind
    // and view angle, replacing the old hand-tuned distance-blur ramp.
    const reflectionRoughness = slopeVariance.mul(VARIANCE_TO_ROUGHNESS);

    // 2. Fresnel
    const fresnelResult = fresnelInstance.build({
      viewDir,
      interpolatedNormal,
      slopeVariance,
      worldX,
      worldZ,
    });
    const { fresnel, fresnelNormal, reflectionNormal, distanceToCamera } =
      fresnelResult;

    // 3. Water color and reflections (sky + SSR)
    const {
      isObjectInFront,
      reflectionColor: baseReflectionColor,
      reflectionSampler,
      waterColumnDepth,
    } = sampleReflections({
      frontFaceMultiplier,
      reflectionNormal,
      reflectionRoughness,
      sky,
      ssr,
      textures,
      uniforms,
      viewDir,
      waterColor: waterColorInstance,
    });

    // 4a. Above-water refraction (front face): sample the underwater
    // scene at a wave-perturbed screen UV so everything below the
    // surface — seabed, fish, kelp — wobbles together. Depth is
    // resampled at the same refracted UV so Beer-Lambert attenuation
    // matches the sampled colour.
    const {
      refractedClearFactor,
      refractedSceneColor,
      refractedWaterColor,
    } = computeAboveWaterRefraction({
      fresnel: fresnelInstance,
      normal: fresnelNormal,
      sceneColorTexture: textures.sceneColor,
      sceneDepth: textures.sceneDepth,
      waterDepth,
      waterColor: waterColorInstance,
    });

    // 4b. Underwater Snell's window / TIR (back face only)
    const sunDir = vec3(sun.direction);

    const reflectionColor: Node = vec3(baseReflectionColor).toVar();
    If(isFrontFace.not(), () => {
      // Distance-faded `fresnelNormal`: raw wave normals compress across
      // pixels at distance and make the underwater Fresnel flicker
      // between near-zero and TIR.
      const underwater = computeUnderwaterSurface({
        viewDir,
        normal: fresnelNormal,
        reflectionSampler,
        sceneColorTexture: textures.sceneColor,
        sceneDepth: textures.sceneDepth,
        fresnel: fresnelInstance,
      });
      reflectionColor.assign(underwater.surfaceColor);
    });

    // 5. Subsurface scattering
    const waterColorWithSSS = sss.build({
      viewDir,
      sunDir,
      waveNormal: interpolatedNormal,
      waterColor: refractedWaterColor,
      distanceToCamera,
      transmissionColor: waterColorInstance._transmissionColorNode,
      sunIntensity: sun.intensity,
      fadeEnd: fresnelResult.fadeEnd,
    });

    // 6. Foam
    const foamResult = computeFoam({
      coords: { fragWorldX, fragWorldZ },
      foamFieldSampler,
      scene: {
        waterColumnDepth,
        isObjectInFront,
        fresnel,
      },
      shorelineFoam: shorelineFoamInstance,
      surfaceFoam: surfaceFoamInstance,
      wakeCoords: { wakeWorldX, wakeWorldZ },
      wakeFieldSampler,
      waveFoam: waveFoamInstance,
      windDirection: uniforms.windDirection,
    });

    // 7. Composite: Fresnel mix of refracted seabed and reflection on
    // the front face, then sparkle and surface/wave foam. Shoreline foam
    // composites on top of the shoreline-zone fade below.
    const composite = compositeColor({
      clearFactor: refractedClearFactor,
      distanceToCamera,
      foamResult,
      frontFaceMultiplier,
      interpolatedNormal,
      reflectionColor,
      refractedSceneColor,
      sparkle: sparkleInstance,
      sunDir,
      sunIntensity: sun.intensity,
      viewDir,
      waterColorWithSSS,
    });

    // 8. Shoreline zone fade + shoreline foam.
    const shoreline = applyShorelineZone({
      composite,
      foamResult,
      frontFaceMultiplier,
      shorelineFoam: shorelineFoamInstance,
    });

    // 9. Waterline rim highlight and rain impact flashes, added as light
    // (no alpha change).
    const rimHighlight = computeWaterlineRim({
      clipPlane,
      meniscusDir,
      viewDir,
      waterlineFactor,
    });
    const additive = rippleSplash
      ? rimHighlight.add(rippleSplash)
      : rimHighlight;
    const finalColor = vec3(
      shoreline.color.x.add(additive),
      shoreline.color.y.add(additive),
      shoreline.color.z.add(additive),
    );

    return vec4(finalColor, shoreline.alpha);
  });

  return customColor();
}
