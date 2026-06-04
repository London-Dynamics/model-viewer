/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import type {Object3D} from 'three';

import type ModelViewerElementBase from '../../model-viewer-base.js';
import type {LDBloomInterface} from '../ld-bloom.js';
import type {LDAmbientOcclusionInterface} from '../ld-ambient-occlusion.js';

export interface LDSelectionOutlineState {
  enabled: boolean;
  color: string;
  width: number;
  edgeStrength: number;
  selectedMeshes: Object3D[];
}

export type LDEffectsHost = ModelViewerElementBase &
    LDBloomInterface &
    LDAmbientOcclusionInterface & {
      highlightSelected: boolean;
      selectionHighlightColor?: string;
    };

export interface LDEffectsFlags {
  bloom: boolean;
  ambientOcclusion: boolean;
  highlightSelected: boolean;
}
