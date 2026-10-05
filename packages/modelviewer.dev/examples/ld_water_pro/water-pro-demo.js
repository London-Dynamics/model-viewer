import * as THREE from 'three/webgpu';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {UltraHDRLoader} from 'three/addons/loaders/UltraHDRLoader.js';
import {Sky, WaterSystem, getPresetParams} from 'threejs-water-pro';

import {
  boatDemoPlacement,
  boatFromParam,
  demoParentPoint,
  hdriForTime,
  LAKE_REFLECTION_ROUGHNESS,
  lakeLook,
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

const state = {
  time: params.get('time') === 'midday' ? 'midday' : 'sunset',
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
  const windshield = demoParentPoint(boat.windshield, placement);
  if (state.view === 'glass') {
    controls.target.set(windshield[0], windshield[1], windshield[2]);
    camera.position.set(
        windshield[0] + placement.scale * 0.35,
        windshield[1] + placement.scale * 0.2,
        windshield[2] + placement.scale * 1.35);
  } else {
    controls.target.set(0, placement.worldHeight * 0.28, 0);
    camera.position.set(
        placement.worldLength * 0.45,
        placement.worldHeight * 0.62,
        placement.worldLength * 0.9);
  }
  camera.near = 0.1;
  camera.far = 50000;
  camera.updateProjectionMatrix();
  controls.update();
};

const countTransparency = (root) => {
  const blend = [];
  const mask = [];
  root.traverse((obj) => {
    if (obj.isMesh !== true) {
      return;
    }
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      if (material == null) {
        continue;
      }
      if (material.transparent === true && !(material.alphaTest > 0)) {
        blend.push(material.name || '(unnamed)');
      } else if (material.alphaTest > 0) {
        mask.push(material.name || '(unnamed)');
      }
    }
  });
  return {
    blend: [...new Set(blend)],
    mask: [...new Set(mask)],
  };
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
  const sky = new Sky({
    equirect: skyTexture,
    brightness: 0.3,
    reflectionBlurDistance: 1500,
    reflectionDistanceBlur: 0.5,
    reflectionRoughness: LAKE_REFLECTION_ROUGHNESS,
    sunDirection: water.lighting.sun.direction,
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

  const transparency = countTransparency(hull);
  water.masking.add(boatGroup);
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
    water.loadPreset(lakeLook(sunset, state));
    const nextUrl = hdriForTime(state.time);
    if (skyTexture.userData.sourceUrl !== nextUrl) {
      const nextTexture = await loadHdri(nextUrl);
      nextTexture.userData.sourceUrl = nextUrl;
      sky.setTexture(nextTexture, renderer);
      useSkyEnvironment(scene, sky);
      skyTexture = nextTexture;
    }
    const seaLabel = state.sea === 'calm' ? 'calm (~4 cm)' : 'light (sunset demo)';
    const modeLabel = state.reference ? 'hull only' : 'water';
    setStatus(`${state.time} / ${seaLabel} / ${modeLabel}`);
    detailEl.textContent =
        `${boat.label} ${placement.worldLength.toFixed(1)} m world length ` +
        `(${(placement.worldLength / placement.scale).toFixed(2)} m real × ${placement.scale}). ` +
        `Beam ${placement.worldBeam.toFixed(1)} m. ` +
        `Glass blend: ${transparency.blend.join(', ') || 'none'}. ` +
        `Alpha mask: ${transparency.mask.length}.`;
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
