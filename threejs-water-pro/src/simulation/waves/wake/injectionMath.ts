/** Outcome of one frame's per-generator injection check. */
export type InjectionDecision =
  | { kind: "first-frame" }
  | { kind: "teleport" }
  | { kind: "stationary" }
  | { kind: "inject"; speed: number };

/** Inputs mirror the runtime state captured during `WakeSystem._injectFromGenerators`. */
export interface InjectionDecisionParams {
  deltaTime: number;
  isFirstFrame: boolean;
  lastWorldPos: { x: number; z: number };
  newWorldPos: { x: number; z: number };
  teleportThreshold: number;
}

/**
 * Pure decision function for the per-frame generator step (solver-agnostic).
 *
 * - **first-frame**: only a baseline position is captured; nothing injected.
 * - **teleport**: motion beyond `teleportThreshold` is a re-anchor, not travel.
 * - **stationary**: no motion (or `deltaTime ≤ 0`) → no wake.
 * - **inject**: returns the object's speed `distance / deltaTime`.
 */
export function decideInjectionForFrame(
  params: InjectionDecisionParams,
): InjectionDecision {
  if (params.isFirstFrame) return { kind: "first-frame" };
  if (params.deltaTime <= 0) return { kind: "stationary" };

  const dx = params.newWorldPos.x - params.lastWorldPos.x;
  const dz = params.newWorldPos.z - params.lastWorldPos.z;
  const distance = Math.hypot(dx, dz);

  if (distance > params.teleportThreshold) return { kind: "teleport" };
  if (distance < 1e-4) return { kind: "stationary" };

  return { kind: "inject", speed: distance / params.deltaTime };
}
