/**
 * Spray billboard shader graph.
 *
 * Builds the `positionNode`, `colorNode`, and `opacityNode` for the spray
 * render material. Each instance reads its particle state from the shared
 * storage buffer:
 *
 *   slot0 = vec4(posX, posY, posZ, lifeRemaining)
 *   slot1 = vec4(sizeScale, heightScale, variantIdx, birthLife)
 *   slot2 = vec4(size, stretchX, stretchY, opacity)             ← spawn-baked
 *   slot3 = vec4(bottomFadeStart, bottomFadeStop, fadeOutTime, submersionDepth)
 *
 * `sizeScale` and `heightScale` are per-particle multipliers frozen at
 * spawn (a function of the firing probe's speed) — fast impacts produce
 * larger and/or taller plumes. `sizeScale` multiplies both axes;
 * `heightScale` further multiplies only the Y axis. `variantIdx` selects
 * one of `SPRAY_VARIANT_COUNT` flipbook atlases packed as layers in the
 * `DataArrayTexture` so consecutive plumes don't all play the same burst.
 *
 * `size`, `stretchX`, `stretchY`, `opacity`, `bottomFadeStart`,
 * `bottomFadeStop`, and `fadeOutTime` are **per-emitter** values, frozen
 * onto the particle at spawn. Editing the emitter's params mid-burst
 * doesn't retro-update alive particles, but new bursts pick up the
 * change immediately.
 *
 * The billboard is **upright and bottom-anchored**:
 *   - The local `up` axis is world-up `(0, 1, 0)`. Particles never tilt —
 *     the plume always rises straight out of the water.
 *   - The local `right` axis is the camera's right vector projected onto
 *     the horizontal plane (XZ), so the quad faces the camera horizontally
 *     while keeping its long axis vertical. When the camera is rolled or
 *     looking straight down, the projection collapses; the resulting quad
 *     is degenerate but invisible at those angles anyway.
 *   - The quad is anchored at its bottom edge (vtxY = -0.5 sits at the
 *     particle position) and extends *upward*. Combined with the emission
 *     shader spawning at the displaced water surface, the bottom of the
 *     texture lands exactly on the waterline.
 *
 * `stretchX` and `stretchY` independently scale the right and up axes so
 * the user can tune width vs height without re-authoring the texture.
 *
 * Alpha comes from a 7×7 flipbook atlas — a one-shot burst that walks
 * frames 0 → frameCount-1 over the *active* portion of life
 * (`birthLife − fadeOutTime`) and then holds the final frame while alpha
 * fades to zero across the trailing `fadeOutTime` seconds.
 *
 * Per-particle, frozen at spawn:
 *   - `sizeScale` / `heightScale` — velocity-driven billboard scale.
 *   - `variantIdx` — atlas layer index in [0, SPRAY_VARIANT_COUNT), so
 *     consecutive plumes off the same probe play different bursts.
 *   - `size` / `stretchX` / `stretchY` / `opacity` / fade params /
 *     `submersionDepth` — emitter-tunable values captured at spawn.
 *
 * Frame phase, UV flip, and brightness are *not* per-particle: every alive
 * particle reads the same flipbook frame at the same active progress.
 */

import {
  attribute,
  cameraPosition,
  cameraWorldMatrix,
  Discard,
  float,
  int,
  floor,
  Fn,
  instanceIndex,
  mod,
  normalize,
  positionWorld,
  screenUV,
  smoothstep,
  texture,
  uv,
  vec2,
  vec3,
} from "three/tsl";
import {
  SPRAY_ATLAS_FRAME_COUNT,
  SPRAY_ATLAS_GRID,
} from "../sprayTexture";
import type * as THREE from "three/webgpu";
import type {
  Node,
  StorageBufferNode,
  UniformFloatNode,
} from "../../../shaders/types";

export interface DropletShaderBindings {
  /**
   * Particle pool storage (4 × vec4 per particle):
   *   slot0 = `(posX, posY, posZ, lifeRemaining)`
   *   slot1 = `(sizeScale, heightScale, variantIdx, birthLife)`
   *   slot2 = `(size, stretchX, stretchY, opacity)`             — spawn-baked
   *   slot3 = `(bottomFadeStart, bottomFadeStop, fadeOutTime, submersionDepth)`
   */
  particleBuffer: StorageBufferNode;
  /**
   * Pre-baked spray flipbook atlas array (one-shot bursts, life-indexed).
   * Each layer is an independent 7×7 atlas; the per-particle `variantIdx`
   * (slot1.z) selects which one this fragment samples.
   */
  sprayTexture: THREE.DataArrayTexture;
  /**
   * Screen-space mask texture from the water mask pass. Spray fragments
   * behind a registered mask object (e.g., the boat hull) are discarded
   * so the plume doesn't visibly cut through the geometry.
   *   R = mask presence (1.0 = masked, 0.0 = visible)
   *   G = camera distance to the mask fragment
   */
  maskTexture: THREE.Texture;
  /** Master mask enable (0.0 = off — discard skipped). */
  maskEnabled: UniformFloatNode;
}

export interface DropletShaderNodes {
  positionNode: Node;
  colorNode: Node;
  opacityNode: Node;
}

/** Build the three material nodes for the spray render pass. */
export function buildDropletShader(
  bindings: DropletShaderBindings,
): DropletShaderNodes {
  const { particleBuffer, sprayTexture, maskTexture, maskEnabled } = bindings;

  const gridSize = float(SPRAY_ATLAS_GRID);
  const frameCount = float(SPRAY_ATLAS_FRAME_COUNT);

  // Vertex: expand each instance into an upright, bottom-anchored quad.
  const positionNode = Fn(() => {
    const slot0 = instanceIndex.mul(4);
    const posLife = particleBuffer.element(slot0);
    const meta = particleBuffer.element(slot0.add(1));
    const visual = particleBuffer.element(slot0.add(2));
    const center = vec3(posLife.x, posLife.y, posLife.z);
    const life = posLife.w;

    // Per-particle, velocity-derived multipliers frozen at spawn. A dead
    // slot still has zeros here; `sizeMul` zeros the whole expansion in
    // that case so a stale 0 doesn't matter.
    const sizeScale = meta.x;
    const heightScale = meta.y;

    // Per-emitter visual params, frozen at spawn.
    const size = visual.x;
    const stretchX = visual.y;
    const stretchY = visual.z;

    // Collapse dead particles to a degenerate point so they don't render.
    const alive = life.greaterThan(0.0);

    // Up is world-up; right is the camera's right vector flattened to the
    // horizontal plane so the quad faces the camera without tilting.
    const axisUp = vec3(0.0, 1.0, 0.0);
    const camRight = cameraWorldMatrix.element(int(0)).xyz;
    const axisRight = normalize(vec3(camRight.x, 0.0, camRight.z));

    const sizeMul = alive.select(float(1.0), float(0.0));

    // Base PlaneGeometry vertex is in XY [-0.5, 0.5]. Bottom-anchor: shift
    // vtxY by +0.5 so the quad's bottom edge sits at `center` and extends
    // upward along `axisUp`.
    const vtxX = attribute("position", "vec3").x;
    const vtxY = attribute("position", "vec3").y;
    const vtxYBottomAnchored = vtxY.add(0.5);

    return center
      .add(
        axisRight
          .mul(vtxX)
          .mul(size)
          .mul(stretchX)
          .mul(sizeScale)
          .mul(sizeMul),
      )
      .add(
        axisUp
          .mul(vtxYBottomAnchored)
          .mul(size)
          .mul(stretchY)
          .mul(sizeScale)
          .mul(heightScale)
          .mul(sizeMul),
      );
  })();

  // Fragment color: off-white base. Foam carries a faint blue tint from
  // the water below it. Also handles the screen-space mask discard so
  // plumes don't visibly cut through registered mask objects (boat hull
  // etc.) — fragments behind the mask in camera-distance terms die here.
  const colorNode = Fn(() => {
    const maskSample = texture(maskTexture, screenUV);
    const fragDist = positionWorld.sub(cameraPosition).length();
    Discard(
      maskEnabled
        .greaterThan(0.5)
        .and(maskSample.r.greaterThan(0.5))
        .and(fragDist.greaterThanEqual(maskSample.g)),
    );
    return vec3(0.92, 0.96, 1.0);
  })();

  // Fragment alpha: flipbook sample × fade-out × surface fade × opacity.
  const opacityNode = Fn(() => {
    const slot0 = instanceIndex.mul(4);
    const posLife = particleBuffer.element(slot0);
    const meta = particleBuffer.element(slot0.add(1));
    const visual = particleBuffer.element(slot0.add(2));
    const fade = particleBuffer.element(slot0.add(3));

    const life = posLife.w;
    const birthLife = meta.w.max(0.001);
    const opacity = visual.w;
    const bottomFadeStart = fade.x;
    const bottomFadeStop = fade.y;
    const fadeOutTime = fade.z;
    const alive = life.greaterThan(0.0);

    // Flipbook walks 0 → frameCount-1 over the *active* portion of life
    // (`birthLife − fadeOutTime`), so the burst always reaches its final
    // frame before the fade starts. `activeDuration` is floored to a small
    // epsilon so a fadeOutTime ≥ birthLife collapses cleanly instead of
    // dividing by zero.
    const elapsed = birthLife.sub(life);
    const activeDuration = birthLife.sub(fadeOutTime).max(0.0001);
    const flipbookProgress = elapsed.div(activeDuration).clamp(0.0, 1.0);

    const currentFrame = floor(
      flipbookProgress.mul(frameCount),
    ).clamp(0.0, frameCount.sub(1.0));

    // Cell column counts left-to-right; row counts top-down in the source
    // image, but `flipY=true` (Three.js loader default) puts UV y bottom-up.
    // The billboard's vtxY=+0.5 vertex aligns with world-up, which lands at
    // uv.y=1; after the flip that samples the *top* of the source image, so
    // authored row 0 (top) sits at fy=grid-1 in UV space.
    const fx = mod(currentFrame, gridSize);
    const fyFromTop = floor(currentFrame.div(gridSize));
    const fy = gridSize.sub(1.0).sub(fyFromTop);

    const atlasUV = vec2(uv().x.add(fx), uv().y.add(fy)).div(gridSize);

    // Pick the array layer baked at spawn so consecutive plumes don't
    // play the same animation. Cast to int — TSL `.depth()` requires an
    // integer layer index for `texture_2d_array<>` sampling.
    const variantLayer = meta.z.toInt();
    const texAlpha = texture(sprayTexture, atlasUV).depth(variantLayer).r;

    // User-tunable death fade. Alpha is 1 while `life > fadeOutTime`,
    // smoothly ramping to 0 over the final `fadeOutTime` seconds. The
    // window matches the flipbook's hold-on-last-frame phase, so the burst
    // visibly completes and then fades.
    const fadeAlpha = smoothstep(float(0.0), fadeOutTime.max(0.0001), life);

    // User-tunable bottom fade: linear ramp on billboard-vertical UV. With
    // bottom-anchored geometry, `uv().y` is 0 at the bottom edge of the
    // quad (waterline) and 1 at the top, so the ramp transparent → opaque
    // hides the lower portion of the texture without the user having to
    // re-author the atlas. `start == stop` collapses to no fade.
    const fadeDenom = bottomFadeStop.sub(bottomFadeStart).max(0.0001);
    const bottomFade = uv()
      .y.sub(bottomFadeStart)
      .div(fadeDenom)
      .clamp(0.0, 1.0);

    const a = texAlpha
      .mul(fadeAlpha)
      .mul(bottomFade)
      .mul(opacity);
    return alive.select(a, float(0.0));
  })();

  return { positionNode, colorNode, opacityNode };
}
