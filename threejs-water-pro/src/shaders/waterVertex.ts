import type { Node } from "three/webgpu";
import {
  vec2,
  vec3,
  float,
  Fn,
  positionLocal,
  varying,
} from "three/tsl";
import type { IWaveSimulation } from "../simulation/waves";
import type { TSLUniformNode } from "../types/tsl";
import type { CascadeSampler } from "./cascadeSampler";
import type { IWakeFieldSampler } from "../simulation/waves/wake";
import { computeGerstner } from "./index";

export interface WaterVertexParams {
  clipmapOffset: TSLUniformNode;
  oceanSim: IWaveSimulation;
  /** CascadeSampler instance for WebGPU path. Null for WebGL. */
  cascadeSampler: CascadeSampler | null;
  gerstnerMaxWaves: number;
  /** Wave-particle displacement sampler. Null when the material is built before the wake system is wired. */
  wakeFieldSampler: IWakeFieldSampler | null;
}

export interface WaterVertexResult {
  positionNode: Node;
  vSampleCoords: Node;
  vSampleCoords0: Node;
  vGerstnerNormal: Node;
  vGerstnerFolding: Node;
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
  const { clipmapOffset, oceanSim, cascadeSampler, gerstnerMaxWaves, wakeFieldSampler } = params;

  const pos = positionLocal;
  const worldX = pos.x.add(clipmapOffset.x);
  const worldZ = pos.z.add(clipmapOffset.y);

  let totalDispX: Node;
  let totalDispY: Node;
  let totalDispZ: Node;
  let sampleX0: Node;
  let sampleZ0: Node;
  const hasStorageBuffers = cascadeSampler !== null;

  if (cascadeSampler) {
    // WebGPU path: use CascadeSampler for hierarchical cascade sampling
    const buffer0 = oceanSim.getDisplacementBuffer(0);
    const buffer1 = cascadeSampler.cascadeCount >= 2
      ? oceanSim.getDisplacementBuffer(1)
      : undefined;

    const result = cascadeSampler.sampleDisplacement(worldX, worldZ, buffer0, buffer1);

    totalDispX = result.displacement.x;
    totalDispY = result.displacement.y;
    totalDispZ = result.displacement.z;
    sampleX0 = result.hierarchicalCoordsX;
    sampleZ0 = result.hierarchicalCoordsZ;
  } else {
    // WebGL path: use noise-based displacement nodes
    const displacementNodes = oceanSim.getDisplacementNodes();
    const disp = displacementNodes.sampleDisplacement(worldX, worldZ);

    totalDispX = disp.x;
    totalDispY = disp.y;
    totalDispZ = disp.z;

    // For WebGL, sample coords are just the world coords (no hierarchical sampling)
    sampleX0 = worldX;
    sampleZ0 = worldZ;
  }

  // Add Gerstner wave displacement (works on both WebGPU and WebGL via uniformArray)
  let gerstnerNormalNode: Node = vec3(0, 1, 0);
  let gerstnerFoldingNode: Node = float(0.0);
  if (gerstnerMaxWaves > 0) {
    const gerstner = computeGerstner({
      worldX,
      worldZ,
      time: oceanSim.getTimeUniform()!,
      waveBuffer: oceanSim.getGerstnerWaveBuffer()!,
      waveCount: oceanSim.getGerstnerWaveCountUniform()!,
      maxWaves: gerstnerMaxWaves,
    });

    totalDispX = totalDispX.add(gerstner.displacement.x);
    totalDispY = totalDispY.add(gerstner.displacement.y);
    totalDispZ = totalDispZ.add(gerstner.displacement.z);
    gerstnerNormalNode = gerstner.normal;
    gerstnerFoldingNode = gerstner.folding;
  }

  // Add wake field displacement. The wake field is world-anchored, so sample it
  // at the horizontally-displaced surface position (grid XZ + FFT/Gerstner choppy
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
  const vSampleCoords0 = varying(vec2(sampleX0, sampleZ0), "vSampleCoords0");

  // Pass Gerstner normal and folding as varyings to avoid per-fragment sin/cos
  const vGerstnerNormal = varying(gerstnerNormalNode, "vGerstnerNormal");
  const vGerstnerFolding = varying(gerstnerFoldingNode, "vGerstnerFolding");

  return {
    positionNode: customPosition(),
    vSampleCoords,
    vSampleCoords0,
    vGerstnerNormal,
    vGerstnerFolding,
    worldX,
    worldZ,
    hasStorageBuffers,
  };
}
