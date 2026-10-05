/**
 * Place a meter-authored Centurion hull in the threejs-water-pro demo world.
 *
 * The vendored demo scales dutch_ship_medium_2k.glb by 15 and treats +Z as
 * forward. Water wavelengths, the clipmap, and the camera far plane are
 * authored in that scaled world. Dividing those distances by 15 does not
 * reproduce the demo.
 *
 * Ri230 is the regression fixture (7.56 m on +X). The demo boat is Ri245
 * MY 2027 (sku ri245-my-2027, product 6e5439be-9bf5-40a4-bd09-13d529639b38).
 * The ready puzzle AABB is 8.23 m on +X and 3.88 m of beam on Z. Bow
 * nose is +X, swim step is −X. The product ruler unit is millimetres; the
 * glTF positions are metres (bow plate near +4 m). The glTF origin sits
 * about half a metre above the keel, which is a usable waterline.
 *
 * Swap a newer puzzle by replacing CENTURION_RI245_GLB and, if the AABB
 * moved, CENTURION_RI245_BOUNDS. Scale stays 15.
 */

export const DEMO_BOAT_SCALE = 15;

export const CENTURION_RI230_GLB =
  'https://assets.v2.londondynamics.com/daa34851-84b3-4c29-8823-fc258ccd9049/puzzle/8561d8b0-f8a3-6ef4-241a-3f90abe64dc5.glb';

export const CENTURION_RI230_BOUNDS = {
  min: [-4.080442611, -0.49104356728503906, -1.485993053981708],
  max: [3.482599, 3.1320764625479978, 1.485283801134457],
};

export const CENTURION_RI245_SKU = 'ri245-my-2027';

export const CENTURION_RI245_GLB =
  'https://assets.v2.londondynamics.com/daa34851-84b3-4c29-8823-fc258ccd9049/puzzle/17949ff9-26b2-7158-9112-42b65bcb9d37.glb';

/** Metres. Bow +X (bow nose plate), beam Z, keel at min Y. */
export const CENTURION_RI245_BOUNDS = {
  min: [-4.14444285111618, -0.516443714513612, -2.1203018954619215],
  max: [4.088056631242676, 2.9131391683349652, 1.7613145123184413],
};

/** dummy_windscreen / Dummy New Windscreen Vented, glTF metres. */
export const CENTURION_RI245_WINDSHIELD = [1.23223591, 1.62456667, 0];

export const HDRI = {
  sunset:
    '/threejs-water-pro/demo/public/hdris/industrial_sunset_02_puresky_4k.jpg',
  midday:
    '/threejs-water-pro/demo/public/hdris/kloofendal_43d_clear_puresky_4k.jpg',
};

export function boundsSize(bounds) {
  return {
    length: bounds.max[0] - bounds.min[0],
    height: bounds.max[1] - bounds.min[1],
    beam: bounds.max[2] - bounds.min[2],
    center: [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ],
  };
}

/**
 * Child matrix is T * Ry(-90°) * S. Scaled local (x, y, z) lands on parent
 * (-z, y, x). XZ of the hull centre is moved to the parent origin. The glTF
 * origin stays at parent y = 0 so the keel remains ~0.49 m (real) underwater
 * after scaling.
 */
export function centurionDemoPlacement(
  bounds = CENTURION_RI230_BOUNDS,
  scale = DEMO_BOAT_SCALE
) {
  const size = boundsSize(bounds);
  const [cx, , cz] = size.center;
  return {
    scale,
    yaw: -Math.PI / 2,
    meshPosition: [scale * cz, 0, -scale * cx],
    worldLength: size.length * scale,
    worldBeam: size.beam * scale,
    worldHeight: size.height * scale,
    keelLocalY: bounds.min[1],
    buoyancy: {
      sampleLength: size.length * scale * 0.85,
      sampleWidth: size.beam * scale * 0.8,
      sampleOffset: [0, 0, 0],
      heightOffset: 0,
    },
  };
}

/** Parent-space point for a glTF-local point under centurionDemoPlacement. */
export function demoParentPoint(local, placement) {
  const s = placement.scale;
  const x = local[0] * s;
  const y = local[1] * s;
  const z = local[2] * s;
  return [
    -z + placement.meshPosition[0],
    y + placement.meshPosition[1],
    x + placement.meshPosition[2],
  ];
}

/**
 * Lake looks keep the sunset preset's spatial units (clipmap, cascade tile
 * scale, gerstner wavelength). Calm only lowers wave height and wind.
 * Midday raises the sun and cools the fog without retuning the ocean grid.
 */
export function lakeLook(preset, {time, sea}) {
  const next = structuredClone(preset);
  if (sea === 'calm') {
    next.waves.fft.amplitude *= 0.28;
    next.waves.gerstner.amplitude *= 0.28;
    next.waves.fft.windSpeed = 6;
  } else if (sea !== 'light') {
    throw new Error(`Unknown sea state: ${sea}`);
  }
  if (time === 'midday') {
    next.sky.sun.elevation = 58;
    next.sky.sun.azimuth = 165;
    next.sky.sun.diskColor = '#fff4d2';
    next.fog.color = '#d7e6f0';
    next.color.waterColor = '#0c4a62';
    next.color.transmissionColor = '#7ec8c0';
  } else if (time !== 'sunset') {
    throw new Error(`Unknown time of day: ${time}`);
  }
  return next;
}

export function hdriForTime(time) {
  if (time === 'midday') {
    return HDRI.midday;
  }
  if (time === 'sunset') {
    return HDRI.sunset;
  }
  throw new Error(`Unknown time of day: ${time}`);
}
