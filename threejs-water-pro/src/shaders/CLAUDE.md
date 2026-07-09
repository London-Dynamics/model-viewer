# Shader Class Pattern

When converting a shader builder function (e.g., `buildSSR`, `buildSSS`) into a class, follow this pattern. See `ssr.ts` as the reference implementation.

## Structure

Each shader class encapsulates:
1. **Private uniform fields** — TSL `uniform()` nodes, prefixed with `_`
2. **Public getters/setters** — read/write `.value` on the underlying uniforms, using JS types (`boolean`, `number`) not shader types
3. **Params interface** — defined in the same file, exported, used by `update()` and presets
4. **`update(params)` method** — bulk-set from the params interface (used by presets)
5. **`build()` method** — constructs the TSL node graph, accessing uniforms via `this._*`
6. **Private `build*()` helper methods** — extract distinct stages from `build()` to keep it readable

```typescript
/** Preset-facing parameters for MyEffect. */
export interface MyEffectParams {
  /** Whether the effect is active. */
  enabled: boolean;
  /** Effect intensity (0–1). */
  strength: number;
}

/** Output nodes produced by {@link MyEffect.build}. */
export interface MyEffectResult {
  /** RGB color output. */
  color: Node;
  /** 0–1 mask output. */
  mask: Node;
}

/**
 * Brief description of the effect.
 *
 * Owns its own TSL uniform nodes. External code reads/writes parameters
 * through getters and setters; the shader graph binds to the private
 * uniform nodes via {@link build}.
 */
export class MyEffect {
  // 1. Private uniforms
  private _strength = uniform(0.8);
  private _enabled = uniform(1.0);

  // 2. Getters/setters (JS types, not shader types)
  /** Effect intensity (0–1). */
  get strength(): number { return this._strength.value; }
  set strength(value: number) { this._strength.value = value; }

  // Boolean uniforms: store as 0/1 float, expose as boolean
  /** Whether the effect is active. */
  get enabled(): boolean { return this._enabled.value === 1.0; }
  set enabled(value: boolean) { this._enabled.value = value ? 1.0 : 0.0; }

  // 3. Bulk update from params
  /** Bulk-set parameters from a preset or params object. */
  update(params: MyEffectParams): void {
    this.enabled = params.enabled;
    this.strength = params.strength;
  }

  // 4. Build the node graph
  /**
   * Builds the TSL node graph for this effect.
   *
   * @param depthTexture - Linear depth buffer for the scene.
   * @param reflectDir - World-space reflection direction at the fragment.
   */
  build(depthTexture: Texture, reflectDir: Node): MyEffectResult {
    const result: Node = Fn(() => {
      // ... uses this._strength, this._enabled directly
      const refined = this.buildRefinement(/* args */);
      const confidence = this.buildConfidence(/* args */);
      // ...
    })();
    return { color: result.xyz, mask: result.w };
  }

  // 5. Private helpers for distinct stages
  /**
   * Narrows a coarse hit to sub-pixel precision.
   *
   * @param coarseUV - UV at the coarse hit point.
   * @param lastGoodUV - UV at the last "in front" position.
   */
  private buildRefinement(coarseUV: Node, lastGoodUV: Node): { uv: Node; depth: Node } {
    // ...
  }

  /**
   * Computes a 0–1 confidence value for a hit.
   *
   * @param refinedUV - UV after binary refinement.
   * @param rayOriginZ - View-space Z of the ray origin.
   */
  private buildConfidence(refinedUV: Node, rayOriginZ: Node): Node {
    // ...
  }
}
```

## Rules

- **Uniforms are private.** External code reads/writes through getters/setters. The shader graph accesses them via `this._*`.
- **Params interface lives in the same file** as the class, not in a separate types file. Export it for use by presets and `WaterSystem`.
- **JSDoc on all public API.** Class, params interface, result interface, getters, and `build()` (with `@param` tags). Private methods get a brief doc comment with `@param` tags for each argument.
- **No param object interfaces for private methods.** Pass arguments directly.
- **Private helpers are plain methods, not TSL `Fn()`.** They build node graph fragments during construction, not standalone shader functions. TSL `Fn()` is only needed for reusable GPU-side functions (like `viewPosToScreenUV`).
- **Module-level TSL `Fn()` helpers** (pure GPU functions with no uniform access) stay outside the class.
- **The class replaces both the old `*Uniforms` class and the standalone `build*()` function.** Remove the uniforms class from `uniforms.ts` and remove the entry from `SurfaceUniforms` (since `build()` accesses uniforms via `this`, it no longer needs them passed through the uber-uniform object).
- **`WaterSystem` owns the instance** (e.g., `private _ssr = new SSR()`). It injects instances into `WaterSurfaceMaterial` via `SharedMaterialUniforms`, so they survive quality level changes and external references (e.g., UI bindings) remain valid.
- **UI controls bind directly** to the class instance via `object: ui.water.ssr, key: "strength"`. The setter handles the uniform update — no `onChange` callback needed.
- **Getters/setters use JS types.** `boolean` for on/off uniforms (stored as `0.0`/`1.0`), `number` for numeric uniforms. Never expose the raw `UniformNode`.
