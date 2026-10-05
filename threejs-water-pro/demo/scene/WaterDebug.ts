// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import {
  BuoyancyDebugVisualizer,
  SprayDebugVisualizer,
  WakeDebugVisualizer,
} from "threejs-water-pro";
import type { WaterSystem } from "threejs-water-pro";

import {
  computeBuoyancySampling,
  computeSprayProbes,
} from "../ship/shipHullPoints";
import type { LoadedModels } from "./ModelLoader";

/** Demo-specific buoyancy tuning for one floating model (not part of library presets). */
export interface BuoyancyObjectParams {
  enabled: boolean;
  heightOffset: number;
  heightSmoothing: number;
  multiPoint: boolean;
  showSamplePoints: boolean;
  tiltAmount: number;
  tiltSmoothing: number;
}

export interface WaterDebugParams {
  buoy: BuoyancyObjectParams;
  ship: BuoyancyObjectParams;
}

/**
 * Binds the demo models to the water: buoyancy objects for the ship and the
 * island buoys, the ship's wake generator and spray emitter, the hull water
 * mask, and the debug visualizers for each.
 */
export class WaterDebug {
  private readonly water: WaterSystem;

  public readonly buoyancyDebugVisualizer: BuoyancyDebugVisualizer;
  public readonly sprayDebugVisualizer: SprayDebugVisualizer;
  public readonly wakeDebugVisualizer: WakeDebugVisualizer;
  public readonly islandBuoyIds: readonly number[];
  public readonly shipBuoyancyId: number;
  /** Wake generator ids for the ship; a single generator at the bow. */
  public readonly shipWakeIds: readonly number[];

  constructor(
    water: WaterSystem,
    models: LoadedModels,
    params: WaterDebugParams,
  ) {
    this.water = water;

    this.buoyancyDebugVisualizer = new BuoyancyDebugVisualizer(water.scene);
    this.buoyancyDebugVisualizer.setEnabled(
      params.ship.showSamplePoints || params.buoy.showSamplePoints,
    );
    this.sprayDebugVisualizer = new SprayDebugVisualizer(water.scene);
    this.sprayDebugVisualizer.setEnabled(false);
    // Wake generator indicators (off by default; toggled from the Wake folder).
    this.wakeDebugVisualizer = new WakeDebugVisualizer(water.scene);

    // Inset the bow/stern sample points inboard of the bounding-box tips so
    // they ride the hull. The bow needs a far larger inset than the stern
    // because the bowsprit stretches the AABB forward well past the actual bow.
    const shipSampling = computeBuoyancySampling(models.shipModel, {
      bow: 6,
      stern: 1.5,
    });
    this.shipBuoyancyId = water.buoyancy.addObject(models.shipModel, {
      multiPoint: params.ship.multiPoint,
      heightOffset: params.ship.heightOffset,
      rotationInfluence: params.ship.tiltAmount,
      heightSmoothing: params.ship.heightSmoothing,
      rotationSmoothing: params.ship.tiltSmoothing,
      useBoundingBox: false,
      ...shipSampling,
    });

    this.islandBuoyIds = models.islandBuoys.map((buoy) =>
      water.buoyancy.addObject(buoy, {
        multiPoint: params.buoy.multiPoint,
        heightOffset: params.buoy.heightOffset,
        rotationInfluence: params.buoy.tiltAmount,
        heightSmoothing: params.buoy.heightSmoothing,
        rotationSmoothing: params.buoy.tiltSmoothing,
      }),
    );

    this.shipWakeIds = [
      water.wake.addGenerator(models.shipModel, {
        depth: 0.6,
        radius: 3,
        offset: new THREE.Vector3(0, 0, -8),
      }),
    ];

    if (water.spray) {
      water.spray.addEmitter(models.shipModel, {
        probes: computeSprayProbes(models.shipModel),
      });
    }

    if (models.shipWaterMask) {
      water.masking.add(models.shipWaterMask);
    }
  }

  /** Per-frame refresh of whichever debug visualizers are enabled. */
  public update(): void {
    if (this.buoyancyDebugVisualizer.isEnabled()) {
      this.buoyancyDebugVisualizer.update(this.water.buoyancy.getDebugData());
    }
    if (this.sprayDebugVisualizer.isEnabled() && this.water.spray) {
      this.sprayDebugVisualizer.update(this.water.spray.getProbeDebugData());
    }
    if (this.wakeDebugVisualizer.isEnabled()) {
      this.wakeDebugVisualizer.update(this.water.wake.getDebugData());
    }
  }
}
