/**
 * Place a meter-authored hull in the threejs-water-pro demo world.
 *
 * The vendored demo scales dutch_ship_medium_2k.glb by 15 and treats +Z as
 * forward. Water wavelengths, the clipmap, and the camera far plane are
 * authored in that scaled world. Dividing those distances by 15 does not
 * reproduce the demo.
 *
 * Ri230 is the regression fixture (7.56 m on +X). The default demo boat is
 * Ri245 MY 2027 (sku ri245-my-2027, product
 * 6e5439be-9bf5-40a4-bd09-13d529639b38). The ready puzzle AABB is 8.23 m on
 * +X and 3.88 m of beam on Z. Bow nose is +X, swim step is −X. A −90° yaw
 * puts that bow on +Z.
 *
 * Aquila 45 Sport (sku 45-sport, product
 * 6f7c6465-0a86-4ea6-81c5-ac8856f7e6a0) is 14.18 m on +Z and 4.61 m of beam
 * on X. Outdrives sit at −Z and the windshield mesh is forward of midships,
 * so the bow already faces +Z and the yaw stays 0. The glTF origin sits
 * about 0.41 m above the keel.
 *
 * Select a boat with ?boat=ri245 (default), ?boat=aquila, or ?boat=45-sport.
 * Scale stays 15.
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

export const AQUILA_45_SKU = '45-sport';

export const AQUILA_45_GLB =
  'https://assets.v2.londondynamics.com/019e4651-0c20-7aa0-a5f4-789b9df05fd0/puzzle/49cdcf76-f547-483d-ce9b-dee55109f95e.glb';

/**
 * Metres. Length on +Z (bow), beam on X, keel at min Y.
 * Measured from the ready puzzle GLB, world-space mesh corners.
 */
export const AQUILA_45_BOUNDS = {
  min: [-2.3033783566787505, -0.411751904, -6.948886279595587],
  max: [2.303379119618076, 4.4675432399999995, 7.230014832557959],
};

/** windshield-glass mesh centre, glTF metres. Bow is +Z. */
export const AQUILA_45_WINDSHIELD = [0, 2.8839784, 2.12949878];

/**
 * `bowAxis` is the glTF axis that points at the bow before yaw.
 * `x` needs −90° so the bow lands on demo +Z. `z` is already forward.
 */
export const BOATS = {
  ri245: {
    id: 'ri245',
    label: 'Centurion Ri245',
    sku: CENTURION_RI245_SKU,
    url: CENTURION_RI245_GLB,
    bounds: CENTURION_RI245_BOUNDS,
    windshield: CENTURION_RI245_WINDSHIELD,
    bowAxis: 'x',
  },
  aquila: {
    id: 'aquila',
    label: 'Aquila 45 Sport',
    sku: AQUILA_45_SKU,
    url: AQUILA_45_GLB,
    bounds: AQUILA_45_BOUNDS,
    windshield: AQUILA_45_WINDSHIELD,
    bowAxis: 'z',
  },
};

const BOAT_PARAMS = {
  ri245: 'ri245',
  aquila: 'aquila',
  '45-sport': 'aquila',
};

/** `boat` query param. Unknown values stay on Ri245. */
export function boatFromParam(param) {
  const key = param == null || param === '' ? 'ri245' : String(param).toLowerCase();
  return BOATS[BOAT_PARAMS[key] ?? 'ri245'];
}

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

/** Yaw that maps `bowAxis` onto the water-pro forward axis (+Z). */
export function yawForBow(bowAxis) {
  if (bowAxis === 'x' || bowAxis === '+x') {
    return -Math.PI / 2;
  }
  if (bowAxis === '-x') {
    return Math.PI / 2;
  }
  if (bowAxis === '-z') {
    return Math.PI;
  }
  if (bowAxis === 'z' || bowAxis === '+z') {
    return 0;
  }
  throw new Error(`Unknown bow axis: ${bowAxis}`);
}

/** Ry(yaw) on the XZ plane. −90° maps (x, z) to (−z, x). */
export function rotateYawXZ(x, z, yaw) {
  if (yaw === 0) {
    return [x, z];
  }
  if (yaw === -Math.PI / 2) {
    return [-z, x];
  }
  if (yaw === Math.PI / 2) {
    return [z, -x];
  }
  if (yaw === Math.PI || yaw === -Math.PI) {
    return [-x, -z];
  }
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return [x * cos + z * sin, -x * sin + z * cos];
}

/**
 * Child matrix is T * Ry(yaw) * S. XZ of the hull centre moves to the parent
 * origin. The glTF origin stays at parent y = 0 so the keel stays under the
 * waterline after scaling. `bowAxis` `x` is length-on-X (Ri245). `z` is
 * length-on-Z (Aquila).
 */
export function boatDemoPlacement(boat, scale = DEMO_BOAT_SCALE) {
  const {bounds, bowAxis} = boat;
  const cx = (bounds.min[0] + bounds.max[0]) / 2;
  const cz = (bounds.min[2] + bounds.max[2]) / 2;
  const spanX = bounds.max[0] - bounds.min[0];
  const spanZ = bounds.max[2] - bounds.min[2];
  const alongX = bowAxis === 'x' || bowAxis === '+x' || bowAxis === '-x';
  const yaw = yawForBow(bowAxis);
  const [rx, rz] = rotateYawXZ(scale * cx, scale * cz, yaw);
  const length = alongX ? spanX : spanZ;
  const beam = alongX ? spanZ : spanX;
  return {
    scale,
    yaw,
    meshPosition: [-rx, 0, -rz],
    worldLength: length * scale,
    worldBeam: beam * scale,
    worldHeight: (bounds.max[1] - bounds.min[1]) * scale,
    keelLocalY: bounds.min[1],
    buoyancy: {
      sampleLength: length * scale * 0.85,
      sampleWidth: beam * scale * 0.8,
      sampleOffset: [0, 0, 0],
      heightOffset: 0,
    },
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
  return boatDemoPlacement({bounds, bowAxis: 'x'}, scale);
}

/** Parent-space point for a glTF-local point under boatDemoPlacement. */
export function demoParentPoint(local, placement) {
  const s = placement.scale;
  const [x, z] = rotateYawXZ(local[0] * s, local[2] * s, placement.yaw);
  return [
    x + placement.meshPosition[0],
    local[1] * s + placement.meshPosition[1],
    z + placement.meshPosition[2],
  ];
}

/**
 * Grazing Fresnel on the sunset preset mirrors the sun and the white deck,
 * so the near water goes grey. A lake look keeps the body blue: slightly
 * lower IOR, a soft sky reflection, and little screen-space reflection.
 */
export const LAKE_REFLECTION_ROUGHNESS = 0.36;

const assignPath = (root, path, value) => {
  let current = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i];
    current[key] = current[key] ?? {};
    current = current[key];
  }
  current[path[path.length - 1]] = value;
};

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
  assignPath(next, ['color', 'absorptionColor'], '#2a1008');
  assignPath(next, ['color', 'waterColor'], '#0a8ec4');
  assignPath(next, ['color', 'transmissionColor'], '#b5e6f7');
  assignPath(next, ['fresnel', 'surface', 'iorRatio'], 1.08);
  assignPath(next, ['ssr', 'strength'], 0.08);
  assignPath(next, ['sparkle', 'intensity'], 0.12);
  assignPath(next, ['foam', 'surface', 'opacity'], 0.08);
  assignPath(next, ['foam', 'surface', 'coverage'], 0.04);
  assignPath(next, ['foam', 'waves', 'opacity'], 0.06);
  assignPath(next, ['sky', 'reflectionRoughness'], LAKE_REFLECTION_ROUGHNESS);
  if (time === 'midday') {
    next.sky.sun.elevation = 58;
    next.sky.sun.azimuth = 165;
    next.sky.sun.diskColor = '#fff4d2';
    next.fog.color = '#d7e6f0';
    next.color.waterColor = '#1a8fbe';
    next.color.transmissionColor = '#b7e4f5';
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
