// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import type { Node } from "three/webgpu";
import {
  vec2,
  vec3,
  Fn,
  positionLocal,
  varying,
} from "three/tsl";
import type { IWaveSimulation } from "../simulation/waves";
import type { TSLUniformNode } from "../types/tsl";
import type { CascadeSampler, HierarchicalCoords } from "./cascadeSampler";
import type { IWakeFieldSampler } from "../simulation/waves/wake";

export interface WaterVertexParams {
  clipmapOffset: TSLUniformNode;
  oceanSim: IWaveSimulation;
  /** CascadeSampler instance for WebGPU path. Null for WebGL. */
  cascadeSampler: CascadeSampler | null;
  /** Wave-particle displacement sampler. Null when the material is built before the wake system is wired. */
  wakeFieldSampler: IWakeFieldSampler | null;
}

export interface WaterVertexResult {
  positionNode: Node;
  vSampleCoords: Node;
  /**
   * Hierarchical sample coordinates for cascades 1..cascadeCount-1, in
   * order, one varying per cascade. Empty on the WebGL path (no
   * hierarchical sampling).
   */
  vHierarchicalCoords: Node[];
  worldX: Node;
  worldZ: Node;
  hasStorageBuffers: boolean;
}

/**
 * Builds vertex displacement shader nodes and returns varyings for the fragment shader.
 *
 * Uses hierarchical cascade sampling: waves displace the sampling position
 * of ripples, so ripples "ride" on larger wave structures. This prevents
 * the patterning artifacts that occur when cascades are combined independently.
 *
 * When storage buffers are not available (WebGL), uses noise-based displacement nodes.
 */
export function buildWaterVertexDisplacement(
  params: WaterVertexParams,
): WaterVertexResult {
  const { clipmapOffset, oceanSim, cascadeSampler, wakeFieldSampler } = params;

  const pos = positionLocal;
  const worldX = pos.x.add(clipmapOffset.x);
  const worldZ = pos.z.add(clipmapOffset.y);

  let totalDispX: Node;
  let totalDispY: Node;
  let totalDispZ: Node;
  let hierarchicalCoords: HierarchicalCoords[] = [];
  const hasStorageBuffers = cascadeSampler !== null;

  if (cascadeSampler) {
    // WebGPU path: use CascadeSampler for hierarchical cascade sampling
    const buffers = Array.from({ length: cascadeSampler.cascadeCount }, (_, i) =>
      oceanSim.getDisplacementBuffer(i),
    );

    const result = cascadeSampler.sampleDisplacement(worldX, worldZ, buffers);

    totalDispX = result.displacement.x;
    totalDispY = result.displacement.y;
    totalDispZ = result.displacement.z;
    hierarchicalCoords = result.hierarchicalCoords;
  } else {
    // WebGL path: use noise-based displacement nodes
    const displacementNodes = oceanSim.getDisplacementNodes();
    const disp = displacementNodes.sampleDisplacement(worldX, worldZ);

    totalDispX = disp.x;
    totalDispY = disp.y;
    totalDispZ = disp.z;
  }

  // Add wake field displacement. The wake field is world-anchored, so sample it
  // at the horizontally-displaced surface position (grid XZ + FFT choppy
  // displacement) rather than the grid XZ — otherwise the choppy advection shears
  // the wake sideways off the ship in rough seas.
  if (wakeFieldSampler) {
    const wakeWorldX = worldX.add(totalDispX);
    const wakeWorldZ = worldZ.add(totalDispZ);
    const wake = wakeFieldSampler.sample(wakeWorldX, wakeWorldZ);
    totalDispY = totalDispY.add(wake.height);
  }

  // Custom position with displacement
  const customPosition = Fn(() => {
    const displacedPos = vec3(
      pos.x.add(totalDispX),
      pos.y.add(totalDispY),
      pos.z.add(totalDispZ),
    );
    return displacedPos;
  });

  // Create varyings for fragment shader
  const vSampleCoords = varying(vec2(worldX, worldZ), "vSampleCoords");
  const vHierarchicalCoords = hierarchicalCoords.map((coords, i) =>
    varying(vec2(coords.x, coords.z), `vHierarchicalCoords${i}`),
  );

  return {
    positionNode: customPosition(),
    vSampleCoords,
    vHierarchicalCoords,
    worldX,
    worldZ,
    hasStorageBuffers,
  };
}
