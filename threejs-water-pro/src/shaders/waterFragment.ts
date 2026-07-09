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
  exp,
  If,
  frontFacing,
} from "three/tsl";
import type { IWaveSimulation } from "../simulation/waves";
import type { FoamAccumulation } from "../simulation/foam/FoamAccumulation";
import type { Sky } from "../components/sky/Sky";
import type { SurfaceUniforms } from "../uniforms";
import type { WaterVertexResult } from "./waterVertex";
import type { FoamResult } from "./foamTypes";
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
import type { StorageBufferNode } from "./types";
import type { RainRipples } from "../simulation/ripples";
import type { IWakeFieldSampler } from "../simulation/waves/wake";
import { buildWaterSurfaceNormal } from "./waterNormal";

// ============= Exported Types =============

export interface WaterTextures {
  depth: THREE.Texture;
  mask: THREE.Texture;
  sceneColor: THREE.Texture;
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
  sky: Sky | null;
  /** Whether Jacobian foam is enabled (capability flag, not a runtime toggle). */
  jacobianFoam: boolean;
  /** CascadeSampler instance for WebGPU path. Null for WebGL. */
  cascadeSampler: CascadeSampler | null;
  /**
   * Persistent foam accumulation system. When provided (WebGPU + quality
   * feature enabled), wave-crest foam uses its energy buffer for streaks
   * and decay tails. Null on WebGL or when disabled.
   */
  foamAccumulation: FoamAccumulation | null;
  gerstnerMaxWaves: number;
  /** Rain ripple simulation for normal blending. Null if not initialized. */
  rainRipples: RainRipples | null;
  /** Wake field sampler for wake normal blending. Null on WebGL or disabled. */
  wakeFieldSampler: IWakeFieldSampler | null;
  /** Whether running on WebGL backend (disables clip plane for split view). */
  isWebGL?: boolean;
}

// ============= Pipeline Stage Functions =============

/**
 * Samples water color from depth, computes sky/environment reflections,
 * and optionally blends in screen-space reflections.
 */
function sampleReflections(
  waterColorInstance: WaterColor,
  uniforms: SurfaceUniforms,
  viewDir: Node,
  fresnelNormal: Node,
  textures: WaterTextures,
  ssr: SSR,
  sky: Sky | null,
  frontFaceMultiplier: Node,
): {
  isObjectInFront: Node;
  reflectDir: Node;
  reflectionColor: Node;
  reflectionSampler: ((dir: Node) => Node) | undefined;
  waterColor: Node;
  waterColumnDepth: Node;
} {
  // .toVar() works around a Three.js TSL bug (r181) where the texture binding
  // is dropped unless the sample is forced into a concrete WGSL variable.
  const depthSample = texture(textures.depth, screenUV).toVar("depthSample");
  const reflectionSampler = sky?.createReflectionSampler();

  // Intrinsic water color, plus the unrefracted-UV water-column depth (used
  // by downstream foam/SSS distance-aware paths). The Beer-Lambert clear
  // factor used by the front-face composite is computed at the refracted
  // UV in computeAboveWaterRefraction so attenuation matches the colour
  // sample.
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
      fresnelNormal,
      reflectionSampler,
    });

  // Blend in screen-space reflections (front face only). The DDA march runs
  // as a separate pass at scaled resolution; we just sample its result here.
  const ssrResult: SSRResult = ssr.sample(screenUV);

  const reflectionColor: Node = mix(
    baseReflectionColor,
    ssrResult.ssrColor,
    ssrResult.ssrHitMask.mul(frontFaceMultiplier),
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
  /** Per-channel Beer-Lambert absorption coefficient uniform node (vec3). */
  absorptionColor: Node;
  /** Linear scene depth texture (the same one passed to {@link WaterColor.build}). */
  depthTexture: THREE.Texture;
  fresnel: Fresnel;
  /** Upward-pointing surface normal. */
  normal: Node;
  sceneColorTexture: THREE.Texture;
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
} {
  const { absorptionColor, depthTexture, fresnel, normal, sceneColorTexture } =
    params;

  const waterSurfaceViewDepth = positionView.z.negate();

  // Candidate refracted UV from the normal offset. If this lands on an
  // above-water occluder (sail, mast, hull), sampling there would pull
  // the occluder's color and depth into the water surface — the
  // ship-silhouette bleed you see when the offset crosses a foreground
  // silhouette. Fall back to the unrefracted screen UV in that case so
  // the surface reads its own pixel's seabed instead of an adjacent
  // foreground object.
  const refractionOffset: Node = vec2(
    normal.x.mul(fresnel._refractionStrengthNode),
    normal.z.mul(fresnel._refractionStrengthNode),
  );
  const refractionUVCandidate: Node = screenUV.add(refractionOffset);
  const candidateDepthSample = texture(depthTexture, refractionUVCandidate);
  const candidateSceneDepth = candidateDepthSample.x
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
  const refractedSceneColor = vec3(
    sceneSample.x,
    sceneSample.y,
    sceneSample.z,
  );

  const depthSample = texture(depthTexture, refractionUV);
  const sceneLinearDepth = depthSample.x
    .mul(cameraFar.sub(cameraNear))
    .add(cameraNear);
  const waterColumnDepth = max(
    sceneLinearDepth.sub(waterSurfaceViewDepth),
    float(0.0),
  );
  // Per-channel clear fraction. Each RGB channel attenuates at its own
  // rate, so red dies fastest in clear water and the seabed reads bluer
  // as the water column grows.
  const refractedClearFactor = exp(
    vec3(absorptionColor).negate().mul(waterColumnDepth),
  );

  return { refractedClearFactor, refractedSceneColor };
}

/** Parameters for the underwater surface optics computation. */
interface UnderwaterSurfaceParams {
  depthTexture: THREE.Texture;
  fresnel: Fresnel;
  /** Upward-pointing surface normal (same as the front-face normal). */
  normal: Node;
  reflectionSampler: ((dir: Node) => Node) | undefined;
  sceneColorTexture: THREE.Texture;
  viewDir: Node;
}

/**
 * Computes the surface color seen by an underwater observer looking up at
 * the water-air interface. Reflectance comes from the same dielectric
 * Fresnel function used above water; TIR is the natural `F = 1` case past
 * the critical angle. The Snell's window contents (refracted hemisphere)
 * mix between sky-sampled color and screen-space scene color based on
 * whether the refracted UV lands on above-water geometry.
 */
function computeUnderwaterSurface(params: UnderwaterSurfaceParams): {
  surfaceColor: Node;
  reflectance: Node;
} {
  const {
    depthTexture,
    fresnel,
    normal,
    reflectionSampler,
    sceneColorTexture,
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
  const sceneNormDepthAtScreen: Node = texture(depthTexture, screenUV).x;
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

  // From below water, anything visible at the refracted UV that is not
  // the sky is "above-water content" the underwater observer should see
  // through Snell's window (e.g. the boat's deck or a distant island).
  // The above-water boat sits *farther* from the camera than the water
  // surface, so the front-face heuristic of "scene closer than water"
  // does not apply here — the right test is "scene depth is finite, not
  // at the far plane".
  const sceneNormDepth: Node = texture(depthTexture, refractionUV).x;
  const sceneLinearDepth: Node = sceneNormDepth
    .mul(cameraFar.sub(cameraNear))
    .add(cameraNear);
  const refractedHitsScene: Node = sceneLinearDepth.lessThan(
    cameraFar.mul(0.99),
  );
  const refractedSceneColor = texture(sceneColorTexture, refractionUV);

  // Sample sky in the refracted direction; substitute a safe up-direction
  // when refract() reports TIR so the sampler does not see a zero vector.
  let refractedSkyColor: Node;
  if (reflectionSampler) {
    const safeRefractedDir = isTIR.select(
      vec3(0.0, 1.0, 0.0),
      normalize(refractedDir),
    );
    refractedSkyColor = reflectionSampler(safeRefractedDir);
  } else {
    refractedSkyColor = vec3(
      refractedSceneColor.x,
      refractedSceneColor.y,
      refractedSceneColor.z,
    );
  }

  // Snell's window contents: above-water scene where the refracted UV
  // lands on visible non-sky geometry, sky cubemap everywhere else. F = 1
  // in TIR regions makes this branch contribute zero.
  const snellsWindow = mix(
    refractedSkyColor,
    vec3(refractedSceneColor.x, refractedSceneColor.y, refractedSceneColor.z),
    refractedHitsScene.select(float(1.0), float(0.0)),
  );

  // TIR limb: without an underwater scene capture / downward-SSR, fall
  // back to a sky sample taken in the mirror-reflected view direction.
  // That keeps grazing back-face viewing tonally consistent with the
  // above-water grazing path (which also samples the sky), instead of
  // collapsing to a flat dark placeholder colour the moment the Fresnel
  // limb crosses critical angle.
  let underwaterReflection: Node = vec3(0.1, 0.2, 0.3);
  if (reflectionSampler) {
    const mirrorReflectDir = reflect(viewDir.negate(), normal);
    underwaterReflection = reflectionSampler(mirrorReflectDir);
  }

  // Mix transmitted (Snell's window) with reflected (underwater) by F.
  const surfaceColor: Node = mix(
    snellsWindow,
    underwaterReflection,
    reflectance,
  );

  return { surfaceColor, reflectance };
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

/**
 * Composites the water surface's emitted radiance and per-fragment alpha.
 *
 * Front face: explicit Fresnel mix of refracted-scene transmission and
 * sky/SSR reflection. The refracted scene sample is taken upstream
 * (`computeAboveWaterRefraction`) and passed in here as
 * `refractedSceneColor`; Beer-Lambert weights it against the water tint
 * by `clearFactor`. Output is opaque on the front face so the seabed
 * warps with the waves instead of being read at the unrefracted screen
 * UV via framebuffer alpha-blending.
 *
 * Back face: `reflectionColor` is the complete `computeUnderwaterSurface`
 * output (Snell's window + TIR mix) and passes through unchanged.
 */
function compositeColor(
  waterColorWithSSS: Node,
  interpolatedNormal: Node,
  foamResult: FoamResult,
  reflectionColor: Node,
  refractedSceneColor: Node,
  viewDir: Node,
  sunDir: Node,
  sunIntensity: Node,
  distanceToCamera: Node,
  sparkleInstance: Sparkle,
  frontFaceMultiplier: Node,
  clearFactor: Node,
): CompositeResult {
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

  // Front-face opaque; back-face has always been opaque. Shoreline-zone
  // fade further down brings alpha toward zero where the beach must
  // show through.
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
    foamAccumulation,
    gerstnerMaxWaves,
    rainRipples,
    wakeFieldSampler,
  } = params;
  const { clipPlane, maskEnabled, sun } = uniforms;

  const {
    vSampleCoords,
    vSampleCoords0,
    vGerstnerNormal,
    vGerstnerFolding,
    worldX,
    worldZ,
  } = vertex;

  const capabilities = oceanSim.getCapabilities();
  const hasJacobianFoam = capabilities.hasJacobianFoam && params.jacobianFoam;

  const customColor = Fn(() => {
    applyMask(textures.mask, maskEnabled);
    applyClipPlane(clipPlane.cameraForward, clipPlane.distance);

    // Front/back classification is a hybrid of the per-frame submersion state
    // and the rasterizer's per-fragment `frontFacing` builtin. Above water
    // (cameraSubmerged == 0) every fragment is forced front-face: the camera
    // only ever sees the top of the surface, and the winding determinant is
    // ill-defined on edge-on triangles (the flat horizon, choppy crests), so
    // raw `frontFacing` flips on scattered pixels and paints back-face Snell's
    // window as bright specks. Only when submerged do we trust per-fragment
    // `frontFacing` — that is what lets a barely-submerged camera show back-
    // face Snell's window through crests above it and front-face composite
    // through troughs in the same frame.
    const isFrontFace = uniforms.cameraSubmerged.lessThan(0.5).or(frontFacing);
    const frontFaceMultiplier = isFrontFace.select(float(1.0), float(0.0));

    // Detect waterline where surface intersects clip plane
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

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const fragWorldX = vSampleCoords.x;
    const fragWorldZ = vSampleCoords.y;

    // The wake field is world-anchored; sample it at the true (choppy-displaced)
    // fragment world position rather than the grid-reference coords so it stays
    // pinned under the ship instead of shearing off with the FFT/Gerstner
    // horizontal displacement in rough seas.
    const wakeWorldX = positionWorld.x;
    const wakeWorldZ = positionWorld.z;

    // 1. Surface normals and eigenvalues (shared with the SSR G-buffer pass).
    const normalResult = buildWaterSurfaceNormal({
      oceanSim,
      cascadeSampler,
      fragWorldX,
      fragWorldZ,
      wakeWorldX,
      wakeWorldZ,
      vSampleCoords0,
      vGerstnerNormal,
      vGerstnerFolding,
      gerstnerMaxWaves,
      rainRipples,
      wakeFieldSampler,
      cameraPosition,
      frontFaceMultiplier,
    });
    let interpolatedNormal: Node = normalResult.interpolatedNormal;
    const eigen0 = normalResult.eigen0;
    const eigen1 = normalResult.eigen1;
    const rippleSplash = normalResult.rippleSplash;

    // Apply meniscus normal perturbation at waterline
    // Tilt the surface normal toward the camera to simulate the curved water profile
    const normalTiltAmount = waterlineFactor.mul(
      clipPlane.waterlineNormalStrength,
    );
    const perturbedNormal = normalize(
      mix(interpolatedNormal, meniscusDir, normalTiltAmount),
    );
    // Use perturbed normal for lighting calculations at the waterline
    interpolatedNormal = mix(
      interpolatedNormal,
      perturbedNormal,
      waterlineFactor,
    );

    // 2. Fresnel
    const fresnelResult = fresnelInstance.build({
      viewDir,
      interpolatedNormal,
      worldX,
      worldZ,
    });
    const { fresnel, fresnelNormal, distanceToCamera } = fresnelResult;

    // 3. Water color and reflections (sky + SSR)
    const {
      isObjectInFront,
      reflectionColor: baseReflectionColor,
      reflectionSampler,
      waterColor,
      waterColumnDepth,
    } = sampleReflections(
      waterColorInstance,
      uniforms,
      viewDir,
      fresnelNormal,
      textures,
      ssr,
      sky,
      frontFaceMultiplier,
    );

    // 4a. Above-water refraction (front face): sample the underwater
    // scene at a wave-perturbed screen UV so everything below the
    // surface — seabed, fish, kelp — wobbles together. Depth is
    // resampled at the same refracted UV so Beer-Lambert attenuation
    // matches the sampled colour.
    const { refractedClearFactor, refractedSceneColor } =
      computeAboveWaterRefraction({
        absorptionColor: waterColorInstance._absorptionColorNode,
        depthTexture: textures.depth,
        fresnel: fresnelInstance,
        normal: fresnelNormal,
        sceneColorTexture: textures.sceneColor,
      });

    // 4b. Underwater Snell's window / TIR (back face only)
    const sunDir = vec3(sun.direction);

    const reflectionColor: Node = vec3(baseReflectionColor).toVar();
    If(isFrontFace.not(), () => {
      // Distance-faded `fresnelNormal` for the same reason as above:
      // raw wave normals compress across pixels at distance and make
      // the underwater Fresnel flicker between near-zero and TIR.
      const underwater = computeUnderwaterSurface({
        viewDir,
        normal: fresnelNormal,
        reflectionSampler,
        depthTexture: textures.depth,
        sceneColorTexture: textures.sceneColor,
        fresnel: fresnelInstance,
      });
      reflectionColor.assign(underwater.surfaceColor);
    });

    // 5. Subsurface scattering
    const waterColorWithSSS = sss.build({
      viewDir,
      sunDir,
      waveNormal: interpolatedNormal,
      waterColor,
      distanceToCamera,
      transmissionColor: waterColorInstance._transmissionColorNode,
      sunIntensity: sun.intensity,
      fadeStart: fresnelResult.fadeStart,
      fadeEnd: fresnelResult.fadeEnd,
    });

    // 6. Foam
    // Sample the persistent foam accumulation buffer when available. The
    // WaveFoam class reads this energy instead of the stateless smoothstep
    // so foam persists and streaks after breaking events.
    let foamEnergy: Node | undefined;
    if (cascadeSampler && foamAccumulation) {
      const foamBuffer0 = foamAccumulation.getFoamBuffer(
        0,
      ) as StorageBufferNode | null;
      if (foamBuffer0) {
        foamEnergy = cascadeSampler.sampleFoamAccumulation({
          worldX: fragWorldX,
          worldZ: fragWorldZ,
          foamBuffer0,
        });
      }
    }

    // The wake maintains its own world-anchored persistent foam-energy buffer
    // (the FFT one is a tiled cascade and can't hold a world-absolute wake).
    // Merge it into the same energy the crests use, so it renders identically
    // through WaveFoam. Only on the persistent path (WebGPU + foam buffer).
    if (wakeFieldSampler && foamEnergy !== undefined) {
      const wakeFoam = wakeFieldSampler.sampleFoamEnergy(wakeWorldX, wakeWorldZ);
      foamEnergy = foamEnergy.max(wakeFoam);
    }

    const foam = new Foam();
    const foamResult = foam.build({
      coords: { fragWorldX, fragWorldZ },
      eigenvalues: { eigen0, eigen1 },
      scene: {
        waterColumnDepth,
        isObjectInFront,
        fresnel,
        surfaceNormal: interpolatedNormal,
      },
      surfaceFoam: surfaceFoamInstance,
      waveFoam: waveFoamInstance,
      shorelineFoam: shorelineFoamInstance,
      features: {
        hasJacobianFoam,
      },
      windDirection: uniforms.windDirection,
      foamEnergy,
    });

    // 7–9. Composite: Fresnel mix of refracted seabed and reflection on
    // the front face, then sparkle and surface/wave foam. Output is
    // opaque on the front face (the refracted-scene sample replaces the
    // old framebuffer alpha-blend trick); shoreline foam composites on
    // top of the shoreline-zone fade below.
    //
    // Pass `refractedClearFactor` (depth resampled at the refracted UV)
    // rather than the screen-UV `clearFactor` so attenuation matches the
    // refracted-colour sample and underwater silhouettes don't bleed
    // bright halos around their displaced positions.
    const composite = compositeColor(
      waterColorWithSSS,
      interpolatedNormal,
      foamResult,
      reflectionColor,
      refractedSceneColor,
      viewDir,
      sunDir,
      sun.intensity,
      distanceToCamera,
      sparkleInstance,
      frontFaceMultiplier,
      refractedClearFactor,
    );

    // 10. Shoreline zone fade: bring water alpha down within the shoreline
    // zone so the beach/terrain shows through, then composite shoreline foam
    // on top so foam patches stay opaque.
    const shorelineFoamEnabled = shorelineFoamInstance._enabledNode;
    const activeZoneMask = foamResult.shorelineZoneMask
      .mul(shorelineFoamEnabled)
      .mul(frontFaceMultiplier);
    const zoneFade = float(1.0).sub(activeZoneMask);
    const fadedColor = vec3(
      composite.color.x.mul(zoneFade),
      composite.color.y.mul(zoneFade),
      composite.color.z.mul(zoneFade),
    );
    const fadedAlpha = composite.alpha.mul(zoneFade);

    const shorelineFoamCoverage =
      foamResult.shorelineFoamStrength.mul(frontFaceMultiplier);
    const shorelineColor = mix(
      fadedColor,
      foamResult.shorelineFoamTint,
      shorelineFoamCoverage,
    );
    const shorelineAlpha = mix(fadedAlpha, float(1.0), shorelineFoamCoverage);

    // 12. Waterline rim highlight (meniscus caustic simulation)
    // Compute rim-light factor based on view angle relative to meniscus direction
    // At grazing angles to the meniscus, light focuses creating a bright edge
    const meniscusNdotV = abs(dot(viewDir, meniscusDir));
    const rimFactor = pow(
      float(1.0).sub(meniscusNdotV),
      clipPlane.waterlineHighlightSharpness,
    );
    const rimHighlight = rimFactor
      .mul(waterlineFactor)
      .mul(clipPlane.waterlineHighlightStrength);

    // Add rim highlight and rain impact flashes as additive light (no alpha change).
    const additive = rippleSplash
      ? rimHighlight.add(rippleSplash)
      : rimHighlight;
    const finalColorWithWaterline = vec3(
      shorelineColor.x.add(additive),
      shorelineColor.y.add(additive),
      shorelineColor.z.add(additive),
    );

    return vec4(finalColorWithWaterline, shorelineAlpha);
  });

  return customColor();
}
