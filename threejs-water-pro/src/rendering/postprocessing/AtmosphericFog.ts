/**
 * Post-processing atmospheric fog that applies distance-based fog to the scene.
 * The fog colour starts as a flat constant near the camera and blends toward the
 * sky colour (sampled in the view direction) with distance, so distant geometry
 * matches the sky at the horizon while nearby fog stays a controllable tint.
 *
 * Uses the scene pass depth buffer which includes water surface depth.
 */
import {
  Fn,
  uv,
  vec3,
  vec4,
  float,
  min,
  smoothstep,
  step,
  normalize,
  mix,
  pow,
  uniform,
  length,
  abs,
  texture,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { Node, PassNode } from "three/webgpu";
import type { TextureNode } from "three/webgpu";
import type { Sky } from "../../components/sky/Sky";

/**
 * 1×1 stand-in for the depth-pass texture nodes. Its contents are never sampled:
 * `RenderPassManager` binds the real targets at construction, before the node
 * graph is built or the first frame renders — so the value is arbitrary.
 */
function createPlaceholder(): THREE.DataTexture {
  const tex = new THREE.DataTexture(
    new Float32Array([0, 0, 0, 0]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.needsUpdate = true;
  return tex;
}

/** Parameters for atmospheric fog. */
export interface FogParams {
  /** Constant near-distance fog colour (hex string or THREE.Color). */
  color: string;
  /** Whether fog is enabled. */
  enabled: boolean;
  /** Distance where fog reaches full intensity (world units). */
  fadeEnd: number;
  /** Power curve for fog falloff. 1 = linear, <1 = faster ramp, >1 = slower ramp. */
  fadePower: number;
  /** Distance where fog begins (world units). */
  fadeStart: number;
  /** Distance over which the fog colour blends from `color` to the sky colour (world units). */
  skyBlendDistance: number;
}

/**
 * Post-processing atmospheric fog.
 *
 * Applies distance-based fog using the scene pass depth buffer,
 * which includes water surface depth for correct fog on water.
 */
export class AtmosphericFog {
  private sky: Sky | null = null;

  // Uniform nodes for fog parameters
  private _color = uniform(new THREE.Color("#b4c0cc"));
  private _fadeStart = uniform(500.0);
  private _fadeEnd = uniform(1800.0);
  private _fadePower = uniform(1.0);
  private _skyBlendDistance = uniform(1500.0);
  private _enabled = uniform(1.0);

  /** Transparent object depth (B=depth) from the depth pre-pass. */
  private transparentDepthTextureNode = texture(createPlaceholder());
  /** Transparent object per-pixel alpha (A) from the depth pre-pass colour target. */
  private transparentColorTextureNode = texture(createPlaceholder());

  /**
   * Constant near-distance fog colour. Distant fog blends toward the sky colour
   * over `skyBlendDistance`, so this is the tint nearby geometry fades into.
   */
  get color(): THREE.Color {
    return this._color.value;
  }

  set color(value: THREE.Color | string) {
    this._color.value = new THREE.Color(value);
  }

  /** Distance where fog begins (world units). */
  get fadeStart(): number {
    return this._fadeStart.value;
  }

  set fadeStart(value: number) {
    this._fadeStart.value = value;
  }

  /** Distance where fog reaches full intensity (world units). */
  get fadeEnd(): number {
    return this._fadeEnd.value;
  }

  set fadeEnd(value: number) {
    this._fadeEnd.value = value;
  }

  /** Power curve for fog falloff. 1 = linear, <1 = faster ramp, >1 = slower ramp. */
  get fadePower(): number {
    return this._fadePower.value;
  }

  set fadePower(value: number) {
    this._fadePower.value = value;
  }

  /**
   * Distance over which the fog colour blends from `color` (near) to the sky
   * colour (far), in world units. Smaller values reach the sky colour sooner.
   */
  get skyBlendDistance(): number {
    return this._skyBlendDistance.value;
  }

  set skyBlendDistance(value: number) {
    this._skyBlendDistance.value = value;
  }

  /** Whether fog is enabled. */
  get enabled(): boolean {
    return this._enabled.value === 1.0;
  }

  set enabled(value: boolean) {
    this._enabled.value = value ? 1.0 : 0.0;
  }

  /** Bulk-set parameters from a preset or params object. */
  update(params: FogParams): void {
    this.color = params.color;
    this.enabled = params.enabled;
    this.fadeEnd = params.fadeEnd;
    this.fadePower = params.fadePower;
    this.fadeStart = params.fadeStart;
    this.skyBlendDistance = params.skyBlendDistance;
  }

  /**
   * Set the sky for fog colour sampling.
   */
  setSky(sky: Sky | null): void {
    this.sky = sky;
  }

  /** Bind the transparent object depth texture from the depth pre-pass. */
  setTransparentDepthTexture(tex: THREE.Texture): void {
    this.transparentDepthTextureNode.value = tex;
  }

  /** Bind the transparent object premultiplied-colour/alpha texture from the depth pre-pass. */
  setTransparentColorTexture(tex: THREE.Texture): void {
    this.transparentColorTextureNode.value = tex;
  }

  /**
   * Create the post-processing effect node.
   *
   * @param scenePass - The scene pass node for texture sampling (includes depth)
   * @returns TSL node that applies atmospheric fog, or the input unchanged if no sky
   */
  createEffectNode(scenePass: PassNode, inputColor?: Node): Node {
    const sceneColor = inputColor ?? scenePass.getTextureNode("output");

    // Fog requires a sky for colour sampling
    if (!this.sky) {
      return sceneColor;
    }

    const fogSampler = this.sky.createFogSampler();
    const fogColorConst = this._color;
    const fadeStart = this._fadeStart;
    const fadeEnd = this._fadeEnd;
    const fadePower = this._fadePower;
    const skyBlendDistance = this._skyBlendDistance;
    const fogEnabled = this._enabled;

    // Raw depth for sky detection AND for manual viewZ reconstruction. Backdrop
    // meshes (sky domes, clouds, starfields) follow the depthWrite:false
    // convention, so the depth buffer stays at the clear value where they render.
    // Any geometry that writes depth — mountains, ships, trees, water, floor —
    // gets a value strictly less than the clear value and correctly receives fog.
    // We derive viewZ manually from raw depth + camera near/far rather than
    // calling scenePass.getViewZNode() because the pass's internal near/far
    // uniforms can lag behind actual camera state in some pipelines.
    const rawDepthNode: TextureNode = scenePass.getTextureNode("depth");
    const transDepthNode = this.transparentDepthTextureNode;
    const transColorNode = this.transparentColorTextureNode;

    // Use the scene pass's camera matrices for world direction reconstruction.
    // TSL built-ins (cameraProjectionMatrixInverse, cameraWorldMatrix) reference
    // the post-processing camera, not the scene camera.
    const camera = scenePass.camera as THREE.PerspectiveCamera;
    const projectionMatrixInverse = uniform(camera.projectionMatrixInverse);
    const cameraMatrixWorld = uniform(camera.matrixWorld);
    const cameraNearU = uniform(camera.near);
    const cameraFarU = uniform(camera.far);

    return Fn(() => {
      const uvCoord = uv();

      // Sample raw depth explicitly at this pixel. Using a TextureNode as a
      // scalar in arithmetic otherwise returns vec4, silently poisoning viewZ.
      const rawDepth = rawDepthNode.sample(uvCoord).r;

      // Reconstruct view-space direction from screen UV
      // UV (0,0) is top-left in WebGPU, NDC (0,1) is top - flip Y
      const ndcX = uvCoord.x.mul(2.0).sub(1.0);
      const ndcY = float(1.0).sub(uvCoord.y.mul(2.0));
      const ndcPos = vec4(ndcX, ndcY, float(1.0), float(1.0));

      // Transform from NDC to view space using scene camera's projection matrix
      const viewPos = projectionMatrixInverse.mul(ndcPos);
      const viewDir3 = vec3(
        viewPos.x.div(viewPos.w),
        viewPos.y.div(viewPos.w),
        viewPos.z.div(viewPos.w),
      );

      // Reconstruct view-space Z from raw depth (forward-Z). Positive distance.
      // perspectiveDepthToViewZ: viewZ_neg = near*far / ((far-near)*d - far)
      const viewZ = cameraNearU
        .mul(cameraFarU)
        .div(cameraFarU.sub(cameraNearU).mul(rawDepth).sub(cameraFarU))
        .negate();
      // Transparent objects don't write the scene depth buffer, so a near
      // transparent object must be fogged separately from the background behind
      // it. Decompose the pixel into the transparent layer (premultiplied colour
      // and coverage alpha, at its own depth) and the background (the remainder,
      // at the scene depth), fog each at its own distance, then recomposite — so
      // the object fogs by its near depth while the empty texels of a billboard
      // and the background seen through it fog by the far depth.
      const transColorSample = transColorNode.sample(uvCoord);
      const transNormDepth = transDepthNode.sample(uvCoord).z;
      const transViewZ = transNormDepth
        .mul(cameraFarU.sub(cameraNearU))
        .add(cameraNearU);
      // The colour target has no occlusion against opaques, so only treat the
      // transparent object as present where it is in front of the scene depth.
      const inFront = transViewZ.lessThan(viewZ);
      const transAlpha = inFront.select(transColorSample.a, float(0.0));
      const transPremul = inFront.select(transColorSample.rgb, vec3(0.0));

      // Detect sky pixels by the unwritten-depth convention: a backdrop mesh
      // with depthWrite:false leaves the raw depth at the clear value (1.0 in
      // forward-Z), while any rendered geometry writes a value strictly less.
      // NOTE: forward-Z only; reverse-Z would invert the comparison.
      const isSky = step(float(1.0), rawDepth);
      const clampedStart = min(fadeStart, fadeEnd);

      // Fog factor at each layer's distance. Radial distance = |viewPosition| =
      // viewDir3 * (viewZ / |viewDir3.z|); the direction factor is shared. The
      // background's fog is suppressed on sky pixels (unwritten depth); the
      // transparent layer is real near geometry, so it is not.
      const dirOverZ = length(viewDir3).div(abs(viewDir3.z));
      const bgDist = dirOverZ.mul(viewZ);
      const transDist = dirOverZ.mul(transViewZ);
      const fogFar = pow(smoothstep(clampedStart, fadeEnd, bgDist), fadePower)
        .mul(fogEnabled)
        .mul(float(1.0).sub(isSky));
      const fogNear = pow(
        smoothstep(clampedStart, fadeEnd, transDist),
        fadePower,
      ).mul(fogEnabled);

      // Transform from view space to world space direction using scene camera's world matrix
      const worldDir4 = cameraMatrixWorld.mul(vec4(viewDir3, float(0.0)));
      const worldDir = normalize(vec3(worldDir4.x, worldDir4.y, worldDir4.z));

      // Sky colour sampled along the view direction (depends only on direction).
      const skyColor = fogSampler(worldDir);

      // Blend the flat near-fog colour toward the sky colour with distance: near
      // fog is the constant `color`, distant fog matches the sky so geometry
      // meeting the horizon carries no colour seam. Each layer blends at its own
      // distance. Guard against a degenerate (zero) blend distance.
      const constColor = vec3(fogColorConst);
      const blendDist = skyBlendDistance.max(float(1.0));
      const fogColorNear = mix(
        constColor,
        skyColor,
        smoothstep(float(0.0), blendDist, transDist),
      );
      const fogColorFar = mix(
        constColor,
        skyColor,
        smoothstep(float(0.0), blendDist, bgDist),
      );

      // Recomposite the two premultiplied layers: the transparent contribution
      // fogged at its own distance + the background remainder fogged at the scene
      // distance. With no transparent object (alpha 0) this reduces to the
      // standard single-layer fog.
      const bgContrib = vec3(sceneColor).sub(transPremul).max(float(0.0));
      const foggedTrans = mix(transPremul, fogColorNear.mul(transAlpha), fogNear);
      const foggedBg = mix(
        bgContrib,
        fogColorFar.mul(float(1.0).sub(transAlpha)),
        fogFar,
      );
      const foggedColor = foggedTrans.add(foggedBg);

      return vec4(foggedColor, sceneColor.a);
    })();
  }
}
