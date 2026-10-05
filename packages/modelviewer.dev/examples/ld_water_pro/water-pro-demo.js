import * as THREE from 'three/webgpu';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {UltraHDRLoader} from 'three/addons/loaders/UltraHDRLoader.js';
import {Sky, WaterSystem, getPresetParams} from 'threejs-water-pro';

import {
  boatDemoPlacement,
  boatFromParam,
  frameCameraPose,
  hdriForTime,
  lakeLook,
  lakePresentation,
} from './boat-placement.js';

const params = new URLSearchParams(location.search);
const boat = boatFromParam(params.get('boat'));
const placement = boatDemoPlacement(boat);
console.info('[ld_water_pro] boat', {
  id: boat.id,
  label: boat.label,
  sku: boat.sku,
  url: boat.url,
  bowAxis: boat.bowAxis,
  bounds: boat.bounds,
  windshield: boat.windshield,
  placement,
});
const canvas = document.querySelector('#water-pro-canvas');
const statusEl = document.querySelector('#water-pro-status');
const detailEl = document.querySelector('#water-pro-detail');

const requestedTime = params.get('time');
const state = {
  time: requestedTime === 'midday' || requestedTime === 'afternoon' ?
    requestedTime :
    'sunset',
  sea: params.get('sea') === 'calm' ? 'calm' : 'light',
  reference: params.get('reference') === '1',
  view: params.get('view') === 'glass' ? 'glass' : 'hero',
  boat: boat.id,
};
const pmremSize = Number(params.get('pmremsize'));

const syncUrl = () => {
  const url = new URL(location.href);
  url.searchParams.set('boat', state.boat);
  url.searchParams.set('time', state.time);
  url.searchParams.set('sea', state.sea);
  url.searchParams.set('view', state.view);
  url.searchParams.set('reference', state.reference ? '1' : '0');
  history.replaceState(null, '', url);
};

const setStatus = (text) => {
  statusEl.textContent = text;
};

const isBoat = (obj) => {
  let current = obj;
  while (current != null) {
    if (current.userData != null && current.userData.isBoat === true) {
      return true;
    }
    current = current.parent;
  }
  return false;
};

const configureTexture = (texture) => {
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.wrapS = THREE.RepeatWrapping;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
};

/**
 * UltraHDRLoader returns a half-float DataTexture. A full 4k prefilter did
 * not finish on a software WebGPU adapter. `?pmremsize=512` keeps the sunset
 * units and still lights the hull.
 */
const downsampleEquirect = (texture, width) => {
  const image = texture.image;
  const src = image.data;
  const sw = image.width;
  const sh = image.height;
  const height = Math.max(2, Math.round(width / 2));
  const dst = new src.constructor(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sh - 1, Math.floor((y + 0.5) * sh / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sw - 1, Math.floor((x + 0.5) * sw / width));
      const si = (sy * sw + sx) * 4;
      const di = (y * width + x) * 4;
      dst[di] = src[si];
      dst[di + 1] = src[si + 1];
      dst[di + 2] = src[si + 2];
      dst[di + 3] = src[si + 3];
    }
  }
  texture.image = {data: dst, width, height};
  texture.needsUpdate = true;
};

const loadHdri = (url) =>
  new Promise((resolve, reject) => {
    new UltraHDRLoader().load(url, (texture) => {
      const configured = configureTexture(texture);
      if (pmremSize > 0) {
        downsampleEquirect(configured, pmremSize);
      }
      resolve(configured);
    }, undefined, reject);
  });

const useSkyEnvironment = (scene, sky) => {
  scene.environment = sky._pmrem != null ? sky._pmrem.texture : null;
};

const frameCamera = (camera, controls) => {
  const pose = frameCameraPose(placement, boat.windshield, state.view) ??
      frameCameraPose(placement, boat.windshield, 'hero');
  controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
  camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
  camera.near = 0.1;
  camera.far = 50000;
  camera.updateProjectionMatrix();
  controls.update();
};

const isWindowMaterial = (material) => {
  if (material == null) {
    return false;
  }
  if (material.transmission > 0) {
    return true;
  }
  return /glass|windshield/i.test(material.name || '');
};

/**
 * Transmission glass is drawn before the water pass, and the hull mask
 * hides every water fragment behind the boat. Both show the sand floor
 * through the windshield. Windows become a light alpha blend and leave
 * the mask so the lake composites behind them.
 */
const separateWindows = (hull, boatGroup) => {
  const windows = [];
  hull.traverse((obj) => {
    if (obj.isMesh !== true) {
      return;
    }
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    if (!materials.some(isWindowMaterial)) {
      return;
    }
    for (const material of materials) {
      if (!isWindowMaterial(material)) {
        continue;
      }
      material.transmission = 0;
      material.transparent = true;
      material.opacity = Math.min(material.opacity || 1, 0.2);
      material.depthWrite = false;
      material.roughness = Math.min(material.roughness ?? 0.05, 0.08);
      material.side = THREE.DoubleSide;
      material.needsUpdate = true;
    }
    windows.push(obj);
  });
  const glassGroup = new THREE.Group();
  glassGroup.name = 'windows';
  boatGroup.add(glassGroup);
  boatGroup.updateMatrixWorld(true);
  for (const mesh of windows) {
    glassGroup.attach(mesh);
  }
  return windows.length;
};

const applyPresentation = (renderer, sky, look) => {
  const grade = lakePresentation(state.time);
  renderer.toneMappingExposure = grade.exposure;
  if (sky != null) {
    sky.brightnessUniform.value = grade.skyBrightness;
    sky.reflectionRoughnessUniform.value = look.sky.reflectionRoughness;
    sky.sunEnabledUniform.value = look.sky.sun.diskEnabled ? 1 : 0;
    sky.sunColorUniform.value.set(look.sky.sun.diskColor);
  }
};

const boot = async () => {
  setStatus('water: starting WebGPU');
  const renderer = new THREE.WebGPURenderer({canvas, antialias: false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  await renderer.init();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
      50, canvas.clientWidth / canvas.clientHeight, 0.1, 50000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 5;
  controls.maxDistance = 3000;
  frameCamera(camera, controls);

  setStatus('water: creating water system');
  const water = await WaterSystem.create(renderer, scene, camera, 'medium');
  const sunset = getPresetParams('sunset');
  water.loadPreset(lakeLook(sunset, state));
  water.setElevation(0);

  setStatus('water: loading sky');
  let skyTexture = await loadHdri(hdriForTime(state.time));
  const openingLook = lakeLook(sunset, state);
  const sky = new Sky({
    equirect: skyTexture,
    brightness: lakePresentation(state.time).skyBrightness,
    reflectionBlurDistance: 1500,
    reflectionDistanceBlur: 0.5,
    reflectionRoughness: openingLook.sky.reflectionRoughness,
    sunDirection: water.lighting.sun.direction,
    sunOverlay: {
      enabled: openingLook.sky.sun.diskEnabled,
      color: openingLook.sky.sun.diskColor,
      emissiveColor: '#fff8e0',
      emissiveIntensity: 5,
      radius: 0.02,
    },
  });
  water.setSky(sky);
  useSkyEnvironment(scene, sky);
  for (const mesh of sky.getMeshes()) {
    scene.add(mesh);
  }

  setStatus(`water: loading ${boat.label}`);
  const draco = new DRACOLoader();
  draco.setDecoderPath(
      '/threejs-water-pro/node_modules/three/examples/jsm/libs/draco/gltf/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  const gltf = await loader.loadAsync(boat.url);
  gltf.scene.traverse((obj) => {
    if (obj.isMesh !== true || obj.geometry == null) {
      return;
    }
    if (obj.geometry.getAttribute('normal') == null &&
        obj.geometry.getAttribute('position') != null) {
      obj.geometry.computeVertexNormals();
    }
  });
  const boatGroup = new THREE.Group();
  boatGroup.name = boat.id;
  boatGroup.userData.isBoat = true;
  const hull = gltf.scene;
  hull.rotation.y = placement.yaw;
  hull.scale.setScalar(placement.scale);
  hull.position.set(
      placement.meshPosition[0],
      placement.meshPosition[1],
      placement.meshPosition[2]);
  boatGroup.add(hull);
  scene.add(boatGroup);
  const windowCount = separateWindows(hull, boatGroup);
  water.masking.add(hull);
  water.buoyancy.addObject(boatGroup, {
    multiPoint: true,
    useBoundingBox: false,
    heightOffset: placement.buoyancy.heightOffset,
    heightSmoothing: 0.2,
    rotationInfluence: 0.35,
    rotationSmoothing: 0.35,
    sampleLength: placement.buoyancy.sampleLength,
    sampleWidth: placement.buoyancy.sampleWidth,
    sampleOffset: new THREE.Vector3(0, 0, 0),
  });

  scene.traverse((obj) => {
    if (obj !== scene && !isBoat(obj) && obj.isLight !== true) {
      obj.userData.waterManaged = true;
    }
  });

  const referenceBackground = new THREE.Color('#d5e7f2');
  const applyVisibility = () => {
    scene.traverse((obj) => {
      if (obj.userData.waterManaged === true) {
        obj.visible = !state.reference;
      }
    });
    scene.background = state.reference ? referenceBackground : null;
  };

  const applyLook = async () => {
    const look = lakeLook(sunset, state);
    water.loadPreset(look);
    applyPresentation(renderer, sky, look);
    const nextUrl = hdriForTime(state.time);
    if (skyTexture.userData.sourceUrl !== nextUrl) {
      const nextTexture = await loadHdri(nextUrl);
      nextTexture.userData.sourceUrl = nextUrl;
      sky.setTexture(nextTexture, renderer);
      useSkyEnvironment(scene, sky);
      skyTexture = nextTexture;
    }
    const seaLabel = state.sea === 'calm' ? 'calm' : 'light';
    const modeLabel = state.reference ? 'hull only' : 'water';
    setStatus(`${boat.label} / ${state.time} / ${seaLabel} / ${modeLabel}`);
    detailEl.textContent =
        `${boat.label} ${placement.worldLength.toFixed(1)} m world length ` +
        `(${(placement.worldLength / placement.scale).toFixed(2)} m real × ${placement.scale}). ` +
        `Beam ${placement.worldBeam.toFixed(1)} m. ` +
        `Waterline ${placement.waterlineLocalY.toFixed(2)} m. ` +
        `Windows ${windowCount}.`;
  };
  skyTexture.userData.sourceUrl = hdriForTime(state.time);
  await applyLook();

  document.querySelectorAll('[data-time]').forEach((button) => {
    button.addEventListener('click', () => {
      state.time = button.dataset.time;
      syncUrl();
      applyLook();
    });
  });
  document.querySelectorAll('[data-sea]').forEach((button) => {
    button.addEventListener('click', () => {
      state.sea = button.dataset.sea;
      syncUrl();
      applyLook();
    });
  });
  document.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      syncUrl();
      frameCamera(camera, controls);
    });
  });
  document.querySelector('#water-pro-reference').addEventListener('click', () => {
    state.reference = !state.reference;
    syncUrl();
    applyVisibility();
    applyLook();
  });
  applyVisibility();
  syncUrl();

  const resize = () => {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) {
      return;
    }
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    water.resize(width, height);
  };
  window.addEventListener('resize', resize);
  resize();

  let last = performance.now();
  const frame = async (now) => {
    const delta = Math.min(0.05, (now - last) / 1000);
    last = now;
    controls.update();
    try {
      if (!state.reference) {
        await water.update(delta);
        water.render();
      } else {
        renderer.render(scene, camera);
      }
    } catch (error) {
      console.error(error);
      setStatus(`water: ${error.message}`);
      return;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

boot().catch((error) => {
  console.error(error);
  setStatus(`water: ${error.message}`);
});
