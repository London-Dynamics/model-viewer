// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import { PassNode } from "three/webgpu";
import {
  float,
  floor,
  Fn,
  If,
  min,
  mix,
  screenSize,
  texture,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import type { Node } from "../../shaders/types";
import type { TextureNode } from "three/webgpu";
import type { IWaterDepthPass } from "../passes/IWaterDepthPass";
import type { SceneDepthSampler } from "../passes/SceneDepthSampler";
import type { WaterColor } from "../../shaders/waterColor";

/**
 * Underwater applies screen-space post-processing effects for pixels
 * below the water surface. It reads the same physical or custom `WaterColor`
 * model as the surface shader, so attenuation remains continuous across the
 * waterline.
 *
 * UV distortion (refraction warp) is handled separately by
 * {@link UnderwaterDistortion}, which produces a shared distorted UV node
 * passed into {@link createEffectNode}.
 *
 * **Per-pixel detection.** Reads two clipped depth channels from the
 * water-depth pass:
 *
 *   - `clippedFront` — closest behind-clip water fragment that is
 *     front-facing.
 *   - `clippedAny`   — closest behind-clip water fragment, any face
 *     direction. Equals `min(clippedFront, clippedBack)`, so the back
 *     face is closer than the front face iff `clippedAny < clippedFront`.
 *
 * Classification: a pixel is underwater when the closest behind-clip
 * fragment is a back face — `clippedAny < clippedFront`, since
 * `clippedAny = min(clippedFront, clippedBack)`. The view ray crossed the
 * surface and is looking back out through the underside (Snell's window).
 * Front-facing pixels (`clippedAny == clippedFront`) never receive fog.
 * The same rule holds for both camera states; when submerged it can leave
 * scattered "firefly" pixels on wave triangles whose back face drops out
 * of the depth pass on the rasterizer's coverage knife-edge.
 *
 * **Column thickness.** `min(opaqueDepth, waterDepth)` covers every
 * geometric case with a single expression:
 *
 *   - Submerged with an opaque underwater object: `opaque < water` →
 *     column = opaque (whole ray was in water).
 *   - Submerged with the ray exiting through the surface (sky/land
 *     above): `water < opaque` → column = water (only the in-water
 *     segment before the ray crosses back into air).
 *   - Above water + Snell's-window pixel: `water` is the entry point,
 *     `opaque` is the seabed; the closer one wins.
 *
 * `waterDepth` is the closer of the two behind-clip water faces, sampled
 * via `clippedAny` (= `min(clippedFront, clippedBack)`).
 */
export class Underwater {
  // Per-frame state uniforms
  public timeUniform = uniform(0.0);

  private _enabled = true;
  private _enabledUniform = uniform(1.0);

  // Multiplicative color graded over the entire underwater region.
  private _tintColor = uniform(new THREE.Color(1, 1, 1));

  // Shared physical/custom model used by the surface shader.
  private _waterColor: WaterColor | null = null;

  // Depth source — owned by `RenderPassManager`, samples routed through
  // its `sampleX(uv)` builders so the backend split (WebGPU
  // single-pass-MIN vs. WebGL three-pass) stays hidden from the
  // post-process node graph.
  private _waterDepthPass: IWaterDepthPass | null = null;

  // Scene-depth sampler from the capture pass (normalized linear depth).
  private _sceneDepth: SceneDepthSampler | null = null;

  // Transparent object color texture (premultiplied alpha in RGB)
  private transparentColorTextureNode: ReturnType<typeof texture>;

  // Transparent object depth texture (R = normalized linear depth)
  private transparentDepthTextureNode: ReturnType<typeof texture>;

  // Depth reconstruction uniforms
  private cameraNearUniform = uniform(0.1);
  private cameraFarUniform = uniform(50000.0);

  constructor() {
    // Placeholder textures — never sampled. RenderPassManager binds the real
    // depth-pass targets at construction, before the node graph is built or the
    // first frame renders, so these contents are arbitrary.
    const createPlaceholder = () => {
      const data = new Float32Array([1, 0, 0, 1]);
      const tex = new THREE.DataTexture(
        data,
        1,
        1,
        THREE.RGBAFormat,
        THREE.FloatType,
      );
      tex.needsUpdate = true;
      return tex;
    };

    this.transparentColorTextureNode = texture(createPlaceholder());
    this.transparentDepthTextureNode = texture(createPlaceholder());
  }

  /**
   * Wire the depth-sample source. Called once during `RenderPassManager`
   * construction; the post-pass samples depth through the source's
   * builder methods, so subsequent texture swaps (resize, quality switch)
   * propagate automatically via the source's internal TSL nodes.
   */
  public setWaterDepthPass(waterDepthPass: IWaterDepthPass): void {
    this._waterDepthPass = waterDepthPass;
  }

  /** Bind the scene-depth sampler from the capture pass. Called once —
   * target rebuilds and camera changes propagate through the sampler. */
  public setSceneDepth(sceneDepth: SceneDepthSampler): void {
    this._sceneDepth = sceneDepth;
  }

  /** Set the transparent object color texture from DepthPass. */
  public setTransparentColorTexture(tex: THREE.Texture): void {
    this.transparentColorTextureNode.value = tex;
  }

  /** Set the transparent object depth/alpha texture from DepthPass. */
  public setTransparentDepthTexture(tex: THREE.Texture): void {
    this.transparentDepthTextureNode.value = tex;
  }

  /** Bind depth reconstruction uniforms. */
  public setDepthUniforms(near: number, far: number): void {
    this.cameraNearUniform.value = near;
    this.cameraFarUniform.value = far;
  }

  /** Bind the same water-color model used by the surface shader. */
  public bindWaterColor(waterColor: WaterColor): void {
    this._waterColor = waterColor;
  }

  /** Whether underwater effects are enabled. */
  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;
    this._enabledUniform.value = value ? 1.0 : 0.0;
  }

  /** Multiplicative tint applied over the entire underwater region (hex string). Default `"#ffffff"` = no tint. */
  get tintColor(): THREE.Color {
    return this._tintColor.value;
  }

  set tintColor(value: THREE.Color | string) {
    this._tintColor.value = new THREE.Color(value);
  }

  /**
   * Update underwater effects. Call once per frame.
   * @param time Current time for animation
   */
  update(time: number): void {
    this.timeUniform.value = time;
  }

  /**
   * Create the post-processing effect node.
   *
   * @param scenePass - The scene pass node for texture resampling.
   * @param aboveWaterNode - Optional node to use when above water (e.g., atmospheric fog result).
   * @param distortedUV - Pre-computed distorted UV from {@link UnderwaterDistortion}.
   *   When provided, all texture sampling uses this UV so the refraction
   *   warp is consistent with other underwater passes (e.g., caustics).
   *   When omitted, sampling uses the undistorted screen UV.
   * @returns TSL node that applies underwater effects.
   */
  public createEffectNode(
    scenePass: PassNode,
    aboveWaterNode?: Node,
    distortedUV?: Node,
  ): Node {
    const waterDepthPass = this._waterDepthPass;
    if (!waterDepthPass) {
      throw new Error(
        "Underwater.createEffectNode: setWaterDepthPass() must be called before building the post-process node graph.",
      );
    }
    const sceneDepth = this._sceneDepth;
    if (!sceneDepth) {
      throw new Error(
        "Underwater.createEffectNode: setSceneDepth() must be called before building the post-process node graph.",
      );
    }
    const waterColor = this._waterColor;
    if (!waterColor) {
      throw new Error(
        "Underwater.createEffectNode: bindWaterColor() must be called first.",
      );
    }
    const tintColor = this._tintColor;
    const transColorTex = this.transparentColorTextureNode;
    const transDepthTex = this.transparentDepthTextureNode;
    const near = this.cameraNearUniform;
    const far = this.cameraFarUniform;

    const sceneTexture = scenePass.getTextureNode("output");
    const aboveWaterInput = aboveWaterNode;
    const externalDistortedUV = distortedUV;

    const enabledUniform = this._enabledUniform;

    return Fn(() => {
      // When disabled, pass through the above-water input (or scene color) unchanged
      const sceneColor = sceneTexture.sample(uv());
      const passthrough = aboveWaterInput ? vec4(aboveWaterInput) : sceneColor;
      const result = vec4(passthrough).toVar("underwaterResult");

      If(enabledUniform.greaterThan(0.5), () => {
        const uvCoord = uv();
        // Use shared distorted UV when provided, otherwise fall back to screen UV
        const sampleUV = externalDistortedUV ?? uvCoord;

        // ========================================
        // PER-PIXEL UNDERWATER DETECTION
        // ========================================
        // A pixel is underwater when the closest behind-clip fragment is a
        // back face — `clippedAny < clippedFront`, since
        // `clippedAny = min(clippedFront, clippedBack)`. The view ray
        // crossed the surface and is now looking back out through the
        // underside (Snell's window). Front-facing pixels
        // (`clippedAny == clippedFront`) never receive fog.
        //
        // This holds for both camera states. When submerged it can leave
        // scattered "firefly" pixels: at wave normals perpendicular to
        // view, a triangle's screen-space winding sits on the rasterizer's
        // coverage knife-edge, so its back face drops out of the depth pass
        // and the pixel reads as front-facing.
        const clippedFrontAtPixel =
          waterDepthPass.sampleClippedFrontDepth(uvCoord);
        const clippedAnyAtPixel =
          waterDepthPass.sampleClippedAnyDepth(uvCoord);
        const origIsUnderwater =
          clippedAnyAtPixel.lessThan(clippedFrontAtPixel);

        // ========================================
        // SAMPLE DEPTHS AT (POSSIBLY DISTORTED) UV
        // ========================================
        // Water depth = closer of the two behind-clip water faces along
        // the view ray. This is the entry point above water (back face
        // closer than front face means the back face is in front) and
        // the exit point below water (whichever surface the ray crosses
        // first back into air).
        const waterClippedNorm =
          waterDepthPass.sampleClippedAnyDepth(sampleUV);

        // Transparent depth comes from its own NEAREST-filtered target, so the
        // per-pixel flag matches the rasterized transparent quad boundary exactly
        // (otherwise the decomposed-fog branch flickers across the edge). Per-pixel
        // alpha comes from the transparent-colour target's A channel below — that
        // is material-agnostic (any material, including node-driven opacity), unlike
        // the depth pass's per-quad constant opacity.
        const transNormDepth = transDepthTex.sample(sampleUV).r;

        // The hardware depth texture samples NEAREST; the scene color
        // target uses LINEAR. At a sub-pixel-offset distortedUV near a
        // silhouette, NEAREST snaps depth across the discontinuity while
        // LINEAR blends the color, so the depth-derived fog factor came
        // from one side and the sampled color from the other — producing
        // the bright "water-behind" halo around plants. Manually bilerping
        // the (linearized) opaque depth puts the fog factor in the same
        // interpolation regime as the scene color, smoothing the silhouette
        // transition without sacrificing the warp visual.
        const dPx = float(1.0).div(screenSize.x);
        const dPy = float(1.0).div(screenSize.y);
        const dPixelCoord = sampleUV.mul(screenSize).sub(vec2(0.5, 0.5));
        const dBase = floor(dPixelCoord);
        const dFx = dPixelCoord.x.sub(dBase.x);
        const dFy = dPixelCoord.y.sub(dBase.y);
        const dUV00 = dBase.add(vec2(0.5, 0.5)).div(screenSize);
        const d00 = sceneDepth.sample(dUV00);
        const d10 = sceneDepth.sample(dUV00.add(vec2(dPx, float(0.0))));
        const d01 = sceneDepth.sample(dUV00.add(vec2(float(0.0), dPy)));
        const d11 = sceneDepth.sample(dUV00.add(vec2(dPx, dPy)));
        const opaqueNormDepth = mix(
          mix(d00, d10, dFx),
          mix(d01, d11, dFx),
          dFy,
        );

        const depthRange = far.sub(near);
        const waterLinearDepth = waterClippedNorm.mul(depthRange).add(near);
        const opaqueLinearDepth = opaqueNormDepth.mul(depthRange).add(near);
        const transLinearDepth = transNormDepth.mul(depthRange).add(near);

        const isUnderwaterPixel = origIsUnderwater.select(
          float(1.0),
          float(0.0),
        );

        // ========================================
        // BEER-LAMBERT FOG (matches surface composite)
        // ========================================
        // Column thickness = how much of the camera→fragment ray was
        // spent in water. A single `min(opaque, water)` covers every
        // geometric case without branching on camera side:
        //   - Submerged + opaque underwater object: opaque < water →
        //     column = opaque (no air on the ray).
        //   - Submerged + ray exits through the surface (sky / land
        //     above): water < opaque → column = water (only the in-
        //     water segment before the ray crosses back into air).
        //   - Above water + Snell's-window pixel (back face closer
        //     than front face fires `origIsUnderwater`): water is the
        //     entry point; opaque wins when the seabed is closer.
        const bgColumn = min(opaqueLinearDepth, waterLinearDepth);
        const transColumn = min(transLinearDepth, waterLinearDepth);

        const clearOpaque = waterColor.buildClearFactor(bgColumn);
        const clearTrans = waterColor.buildClearFactor(transColumn);
        const opaqueMediumColor = waterColor.buildMediumColor();

        const sceneColorSampled = sceneTexture.sample(sampleUV);

        // Background fog (no transparent object at this pixel).
        const standardFogged = vec4(
          mix(opaqueMediumColor, sceneColorSampled.rgb, clearOpaque),
          float(1.0),
        );

        // Decomposed fog for transparent object pixels: attenuate the
        // transparent and background contributions at their respective
        // column thicknesses, then recomposite. transColorTex holds premultiplied
        // colour (alpha * objectColor) in RGB and the true per-pixel alpha in A
        // (NormalBlending over black writes both), so the weights track the
        // object's real silhouette instead of the depth pass's per-quad constant.
        const transColorSample = transColorTex.sample(sampleUV);
        const transColorPremul = transColorSample.rgb;
        const transAlpha = transColorSample.a;
        const bgContrib = sceneColorSampled.rgb
          .sub(transColorPremul)
          .max(float(0.0));
        const oneMinusAlpha = float(1.0).sub(transAlpha);
        const foggedTrans = mix(
          opaqueMediumColor.mul(transAlpha),
          transColorPremul,
          clearTrans,
        );
        const foggedBg = mix(
          opaqueMediumColor.mul(oneMinusAlpha),
          bgContrib,
          clearOpaque,
        );
        const decomposedFogged = vec4(foggedTrans.add(foggedBg), float(1.0));

        // A transparent object counts only where it is actually present, in
        // front of the opaque scene (the transparent-depth target no longer
        // depth-tests against opaques, so that occlusion is resolved here),
        // AND inside the water segment of the ray — closer than the point
        // where the ray exits through the surface. An above-water object
        // reaches a submerged camera only through the surface's own optics
        // (Snell's-window refraction, or not at all under total internal
        // reflection), which the beauty pixel already composited;
        // decomposing it here would paint it over TIR regions where the
        // surface shows only reflection.
        const hasTransparent = transNormDepth
          .lessThan(float(0.999))
          .and(transNormDepth.lessThan(opaqueNormDepth))
          .and(transLinearDepth.lessThan(waterLinearDepth));
        const underwaterFogged = hasTransparent.select(
          decomposedFogged,
          standardFogged,
        );

        const tintedFogged = vec4(
          underwaterFogged.rgb.mul(vec3(tintColor)),
          underwaterFogged.a,
        );

        const normalResult = aboveWaterInput
          ? mix(aboveWaterInput, tintedFogged, isUnderwaterPixel)
          : mix(sceneColorSampled, tintedFogged, isUnderwaterPixel);

        result.assign(normalResult);
      });

      return result;
    })();
  }

  /**
   * Despeckle the underwater region by dilating the fog mask: any non-fog
   * pixel that touches the fog region is reclassified as fog and adopts the
   * neighbouring fog colour. Both underwater artifacts share one root cause —
   * a surface pixel the per-pixel detection misclassifies as not-fog. With sun
   * shafts off it reads as a bright firefly speck (no fog); with shafts on, the
   * shaft brightens its fog neighbours but skips it, so it inverts into a dark
   * hole. Filling it from its fog neighbours fixes both: a misclassified pixel
   * is, by definition, surrounded by correctly-classified fog pixels.
   *
   * This runs after the sun-shaft composite, so the neighbour colour it copies
   * already includes the shaft contribution — the filled pixel matches its
   * shafted surroundings rather than punching a hole in the shaft glow.
   *
   * @param colorTex - Materialized fog + sun-shaft composite (an RTT texture
   *   node) so neighbours can be sampled. Build it with `convertToTexture`.
   */
  public buildDespeckle(colorTex: TextureNode): Node {
    const waterDepthPass = this._waterDepthPass;
    const enabledUniform = this._enabledUniform;

    return Fn(() => {
      const uvCoord = uv();
      const center = colorTex.sample(uvCoord);
      const result = vec4(center).toVar("despeckleResult");

      if (!waterDepthPass) {
        return result;
      }
      const wdp = waterDepthPass;

      If(enabledUniform.greaterThan(0.5), () => {
        const dx = float(1.0).div(screenSize.x);
        const dy = float(1.0).div(screenSize.y);
        const uvN = uvCoord.add(vec2(float(0.0), dy));
        const uvS = uvCoord.sub(vec2(float(0.0), dy));
        const uvE = uvCoord.add(vec2(dx, float(0.0)));
        const uvW = uvCoord.sub(vec2(dx, float(0.0)));

        // A "fog pixel" is one whose closest behind-clip water fragment is a
        // back face (clippedAny < clippedFront) — the same rule the fog uses.
        const isFogAt = (p: Node): Node =>
          wdp.sampleClippedAnyDepth(p).lessThan(wdp.sampleClippedFrontDepth(p));
        const fogCenter = isFogAt(uvCoord);
        const fogN = isFogAt(uvN).select(float(1.0), float(0.0));
        const fogS = isFogAt(uvS).select(float(1.0), float(0.0));
        const fogE = isFogAt(uvE).select(float(1.0), float(0.0));
        const fogW = isFogAt(uvW).select(float(1.0), float(0.0));
        const fogCount = fogN.add(fogS).add(fogE).add(fogW);

        const cN = colorTex.sample(uvN).xyz;
        const cS = colorTex.sample(uvS).xyz;
        const cE = colorTex.sample(uvE).xyz;
        const cW = colorTex.sample(uvW).xyz;

        // Average of the fog neighbours only, so the fill is the local water
        // colour (with shaft) and not a blend with above-water neighbours.
        const fogSum = cN
          .mul(fogN)
          .add(cS.mul(fogS))
          .add(cE.mul(fogE))
          .add(cW.mul(fogW));
        const fogAvg = fogSum.div(fogCount.max(float(1.0)));

        // Non-fog pixel touching the fog region → misclassified firefly.
        // Reclassify it as fog by adopting the neighbouring fog colour.
        const makeFog = fogCenter.not().and(fogCount.greaterThan(float(0.5)));
        result.assign(vec4(makeFog.select(fogAvg, center.xyz), center.w));
      });

      return result;
    })();
  }
}
