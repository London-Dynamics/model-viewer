/* @license
 * Copyright 2024 London Dynamics. All Rights Reserved.
 */

/**
 * SelectionOutlineEffect - An outline effect for selected objects
 *
 * This effect is designed specifically for highlighting selected objects in model-viewer.
 * Properties:
 * - color: Outline color (hex string, e.g., "#165dfc")
 * - width: Outline thickness 0-5 (default 1.5)
 * - edge-strength: Edge intensity (higher = more visible), default 15
 * - blend-mode: Blend function ('skip' to disable, 'default' for normal)
 *
 * Usage:
 * ```html
 * <model-viewer ...>
 *   <effect-composer>
 *     <selection-outline-effect
 *       color="#165dfc"
 *       width="1.5"
 *       edge-strength="15"
 *       blend-mode="skip"
 *     ></selection-outline-effect>
 *   </effect-composer>
 * </model-viewer>
 * ```
 */

import { LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { BlendFunction, Effect, OutlineEffect } from 'postprocessing';
import { Color, Object3D, PerspectiveCamera } from 'three';

// Symbols for internal properties
const $effectComposer = Symbol('effectComposer');
const $updateProperties = Symbol('updateProperties');

// Temporary camera for effect initialization
const TEMP_CAMERA = new PerspectiveCamera();

// Blend mode type
type BlendMode =
  | 'SKIP'
  | 'DEFAULT'
  | 'ADD'
  | 'ALPHA'
  | 'AVERAGE'
  | 'COLOR'
  | 'COLOR_BURN'
  | 'COLOR_DODGE'
  | 'DARKEN'
  | 'DIFFERENCE'
  | 'DIVIDE'
  | 'DST'
  | 'EXCLUSION'
  | 'HARD_LIGHT'
  | 'HARD_MIX'
  | 'HUE'
  | 'INVERT'
  | 'INVERT_RGB'
  | 'LIGHTEN'
  | 'LINEAR_BURN'
  | 'LINEAR_DODGE'
  | 'LINEAR_LIGHT'
  | 'LUMINOSITY'
  | 'MULTIPLY'
  | 'NEGATION'
  | 'NORMAL'
  | 'OVERLAY'
  | 'PIN_LIGHT'
  | 'REFLECT'
  | 'SATURATION'
  | 'SCREEN'
  | 'SET'
  | 'SOFT_LIGHT'
  | 'SRC'
  | 'SUBTRACT'
  | 'VIVID_LIGHT';

interface MVEffectComposer {
  updateEffects(): void;
  queueRender(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

interface IMVEffect extends Effect {
  requireSeparatePass?: boolean;
  requireNormals?: boolean;
  requireDirtyRender?: boolean;
  disabled?: boolean;
  blendMode: any;
}

/**
 * SelectionOutlineEffect provides a sharp, opaque outline for selected objects.
 */
export class SelectionOutlineEffect extends LitElement {
  static get is() {
    return 'selection-outline-effect';
  }

  /**
   * Outline color. String or RGB hex.
   * @default '#165dfc'
   */
  @property({ type: String, attribute: 'color', reflect: true })
  color: string = '#165dfc';

  /**
   * Outline width/thickness. 0=thinnest, 5=thickest.
   * @default 1.5
   */
  @property({ type: Number, attribute: 'width', reflect: true })
  width: number = 1.5;

  /**
   * Edge strength (intensity). Higher values = more visible outline.
   * @default 15
   */
  @property({ type: Number, attribute: 'edge-strength', reflect: true })
  edgeStrength: number = 15;

  /**
   * Blend mode for the effect. Use 'SKIP' to disable, 'DEFAULT' or other blend functions.
   * @default 'DEFAULT'
   */
  @property({ type: String, attribute: 'blend-mode', reflect: true })
  blendMode: BlendMode = 'DEFAULT';

  /**
   * Internal storage for selection
   */
  private _selection: Array<string | Object3D> = [];

  /**
   * Array of objects to outline. Can be Object3D instances or object names.
   * Setting this property immediately applies the selection to the effect.
   */
  get selection(): Array<string | Object3D> {
    return this._selection;
  }

  set selection(value: Array<string | Object3D>) {
    this._selection = value;
    // Immediately apply selection when set
    this._applySelection();
  }

  // Internal effect instance
  effects: IMVEffect[] = [];

  // Reference to parent effect composer
  private [$effectComposer]?: MVEffectComposer;

  // Default blend function storage
  private _defaultBlendFunction?: BlendFunction;

  // Track previous blend mode for detecting skip transitions
  private _previousBlendMode: BlendMode = 'SKIP';

  constructor() {
    super();
    // Create the outline effect
    // Use ALPHA blend for colored outlines (SCREEN only works well for white)
    // Enable blur with VERY_SMALL kernel for thickness while staying sharp
    const outlineEffect = new OutlineEffect(undefined, TEMP_CAMERA, {
      blendFunction: BlendFunction.ALPHA,
      edgeStrength: 15,
      pulseSpeed: 0,
      visibleEdgeColor: 0x165dfc, // Blue by default
      hiddenEdgeColor: 0x165dfc,
      blur: true, // Enable for thickness
      kernelSize: 0, // VERY_SMALL - gives thickness without too much blur
      xRay: true,
      resolutionScale: 1.0, // Full resolution for crisp edges
    });

    // Use a high layer number (10) to avoid conflicts with effect-composer's
    // default selection which uses layer 2
    outlineEffect.selection.layer = 10;

    // Store ALPHA as the default blend function for colored outlines
    this._defaultBlendFunction = BlendFunction.ALPHA;

    this.effects = [outlineEffect as unknown as IMVEffect];
  }

  /**
   * The parent effect-composer element.
   */
  protected get effectComposer(): MVEffectComposer {
    if (!this[$effectComposer]) {
      throw new Error(
        '<selection-outline-effect> must be a child of an <effect-composer> element.'
      );
    }
    return this[$effectComposer];
  }

  connectedCallback(): void {
    super.connectedCallback();

    // Find parent effect-composer
    if (this.parentNode?.nodeName.toLowerCase() === 'effect-composer') {
      this[$effectComposer] = this.parentNode as unknown as MVEffectComposer;
    }

    // DON'T overwrite _defaultBlendFunction here - it's already set in constructor
    // Store on effect for compatibility with effect-composer
    (this.effects[0].blendMode as any).defaultBlendFunction =
      this._defaultBlendFunction;

    // Initialize previous blend mode from the current attribute value
    this._previousBlendMode = this.blendMode.toUpperCase() as BlendMode;

    // Apply initial properties
    this[$updateProperties]();

    // DON'T listen for updated-selection from effect-composer
    // We manage our own selection directly through the selection property

    // Register with effect composer
    this.effectComposer.updateEffects();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();

    // Dispose effects
    this.effects.forEach((effect) => effect.dispose());

    // Update effect composer
    this.effectComposer?.updateEffects();
  }

  updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);

    // Handle property changes
    if (
      changedProperties.has('color') ||
      changedProperties.has('width') ||
      changedProperties.has('edgeStrength')
    ) {
      this[$updateProperties]();
    }

    // Selection is now handled via setter, no need to check here

    if (changedProperties.has('blendMode')) {
      this._updateBlendMode();
    }
  }

  /**
   * Update the outline effect properties.
   */
  private [$updateProperties](): void {
    const outlineEffect = this.effects[0] as unknown as OutlineEffect;

    // width controls kernelSize for outline thickness (0-5)
    // Blur is always enabled for visible outlines
    outlineEffect.blurPass.enabled = true;
    const kernelSizeValue = Math.max(0, Math.min(5, Math.round(this.width)));
    (outlineEffect.blurPass as any).blurMaterial.kernelSize = kernelSizeValue;

    // edgeStrength controls the edge intensity directly
    outlineEffect.edgeStrength = this.edgeStrength;

    // Set both visible and hidden edge colors to the same value
    const edgeColor = new Color(this.color);
    outlineEffect.visibleEdgeColor = edgeColor;
    outlineEffect.hiddenEdgeColor = edgeColor;

    outlineEffect.xRay = true;

    this.effectComposer?.queueRender();
  }

  /**
   * Apply selection to the outline effect.
   * Called automatically when the selection property is set.
   */
  private _applySelection(): void {
    const outlineEffect = this.effects[0] as unknown as OutlineEffect;

    if (!outlineEffect?.selection) {
      return;
    }

    if (this._selection.length > 0) {
      // Filter to only Object3D instances (names would need scene traversal)
      const objects = this._selection.filter(
        (item): item is Object3D => item instanceof Object3D
      );

      // Clear first, then add objects one by one
      outlineEffect.selection.clear();
      for (const obj of objects) {
        outlineEffect.selection.add(obj);
      }
    } else {
      outlineEffect.selection.clear();
    }

    this.effectComposer?.queueRender();
  }

  /**
   * Update blend mode on the effect.
   */
  private _updateBlendMode(): void {
    const blendModeUpper = this.blendMode.toUpperCase() as BlendMode;
    const wasSkip = this._previousBlendMode === 'SKIP';
    const isSkip = blendModeUpper === 'SKIP';

    this.effects.forEach((effect) => {
      if (blendModeUpper === 'DEFAULT') {
        // Restore default blend function - use ALPHA for colored outlines

        effect.blendMode.blendFunction = BlendFunction.ALPHA;
      } else if (blendModeUpper === 'SKIP') {
        effect.blendMode.blendFunction = BlendFunction.SKIP;
      } else {
        // Apply the specified blend function
        const blendFunc = BlendFunction[blendModeUpper];
        if (blendFunc !== undefined) {
          effect.blendMode.blendFunction = blendFunc;
        }
      }

      effect.disabled = isSkip;
    });

    // Store previous value for next time
    this._previousBlendMode = blendModeUpper;

    // Rebuild effect passes if toggling to/from skip
    // This is critical - when going FROM skip TO enabled, we need to rebuild
    if (wasSkip !== isSkip) {
      this.effectComposer?.updateEffects();

      // IMPORTANT: Re-apply the selection AFTER updateEffects rebuilds the passes
      // The selection needs to be set on the effect when it's part of the new pass
      this._applySelection();
    }

    this.effectComposer?.queueRender();
  }
}

// Register the custom element
customElements.define(SelectionOutlineEffect.is, SelectionOutlineEffect);
