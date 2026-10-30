import {GUI} from 'https://cdn.jsdelivr.net/npm/lil-gui@0.20.0/dist/lil-gui.esm.min.js';

import {MODELS} from './models.js';

const UPSTREAM = 'https://gkjohnson.github.io/three-gpu-pathtracer/index.html';
const DEFAULT_ENV_NAME = 'Aristea Wreck Puresky';
const NO_ENVIRONMENT = 'none';

// Same HDR URLs as three-gpu-pathtracer v0.0.27 example/index.js.
const ENV_MAPS = {
  'none': NO_ENVIRONMENT,
  'Royal Esplanade': 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/textures/equirectangular/royal_esplanade_1k.hdr',
  'Moonless Golf': 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/textures/equirectangular/moonless_golf_1k.hdr',
  'Overpass': 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/textures/equirectangular/pedestrian_overpass_1k.hdr',
  'Venice Sunset': 'https://raw.githubusercontent.com/mrdoob/three.js/r150/examples/textures/equirectangular/venice_sunset_1k.hdr',
  'Small Studio': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/studio_small_05_1k.hdr',
  'Pfalzer Forest': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/phalzer_forest_01_1k.hdr',
  'Leadenhall Market': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/leadenhall_market_1k.hdr',
  'Kloppenheim': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/kloppenheim_05_1k.hdr',
  'Hilly Terrain': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/hilly_terrain_01_1k.hdr',
  'Circus Arena': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/circus_arena_1k.hdr',
  'Chinese Garden': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/chinese_garden_1k.hdr',
  'Autoshop': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/autoshop_01_1k.hdr',
  'Measuring Lab': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/vintage_measuring_lab_2k.hdr',
  'Whale Skeleton': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/whale_skeleton_2k.hdr',
  'Hall of Mammals': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/hall_of_mammals_2k.hdr',
  'Drachenfels Cellar': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/drachenfels_cellar_2k.hdr',
  'Adams Place Bridge': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/adams_place_bridge_2k.hdr',
  'Sepulchral Chapel Rotunda': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/sepulchral_chapel_rotunda_2k.hdr',
  'Peppermint Powerplant': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/peppermint_powerplant_2k.hdr',
  'Noon Grass': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/noon_grass_2k.hdr',
  'Narrow Moonlit Road': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/narrow_moonlit_road_2k.hdr',
  'St Peters Square Night': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/st_peters_square_night_2k.hdr',
  'Brown Photostudio 01': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/brown_photostudio_01_2k.hdr',
  'Rainforest Trail': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/rainforest_trail_2k.hdr',
  'Brown Photostudio 07': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/brown_photostudio_07_2k.hdr',
  'Brown Photostudio 06': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/brown_photostudio_06_2k.hdr',
  'Dancing Hall': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/dancing_hall_2k.hdr',
  'Aristea Wreck Puresky': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aristea_wreck_puresky_2k.hdr',
  'Modern Buildings 2': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/modern_buildings_2_2k.hdr',
  'Thatch Chapel': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/thatch_chapel_2k.hdr',
  'Vestibule': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/vestibule_2k.hdr',
  'Blocky Photo Studio': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/blocky_photo_studio_1k.hdr',
  'Christmas Photo Studio 07': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/christmas_photo_studio_07_2k.hdr',
  'Aerodynamics Workshop': 'https://raw.githubusercontent.com/gkjohnson/3d-demo-data/master/hdri/aerodynamics_workshop_1k.hdr',
};

const LIGHT_RIGS = [
  'none',
  'three point',
  'softbox',
  'overhead',
  'side strips',
  'light box',
  'overhead strips',
];

const UNSUPPORTED = {
  pause: 'model-viewer has no pause. Turn enable off to leave path tracing and show the real-time view.',
  frameBudget: 'frameBudget is a WebGPUPathTracer limit. model-viewer still uses WebGLPathTracer.',
  multipleImportanceSampling: 'The WebGL path tracer keeps multiple importance sampling on. There is no attribute to turn it off.',
  randomStrategy: 'Blue Dither, Sobol, and PCG are WebGPUPathTracer random strategies.',
  cameraProjection: 'model-viewer cameras are perspective. Orthographic is not a camera-orbit mode.',
  denoise: 'Upstream toggles the WebGPU OIDN denoiser. model-viewer spatial denoise is path-tracer-denoise on the settings page, not OIDN.',
  upscale: 'FSR upscaling ships with the WebGPU path tracer and is not exposed.',
  sharpness: 'Sharpness belongs to the FSR upscaler, which model-viewer does not run.',
  lighting: 'Rect area light rigs are not exposed. Lighting comes from the environment map.',
};

const viewer = document.querySelector('#viewer');
const statusNode = document.querySelector('#status');
const upstreamLink = document.querySelector('#upstream-link');

const params = {
  model: MODELS[0].name,
  enable: true,
  pause: false,
  maxBounces: 15,
  renderScale: window.innerWidth / window.innerHeight < 0.65 ?
      1 / (window.devicePixelRatio || 1) :
      1,
  frameBudget: window.innerWidth / window.innerHeight < 0.65 ? 100000 : 250000,
  maxSamples: 16,
  multipleImportanceSampling: true,
  randomStrategy: 'Blue Dither',
  cameraProjection: 'Perspective',
  denoise: true,
  upscale: true,
  sharpness: 1,
  bokehSize: 0,
  focusDistance: 1,
  envMap: ENV_MAPS[DEFAULT_ENV_NAME],
  stage: 'floor',
  background: 'white',
  lighting: 'none',
};

let gui;
let currentModel = MODELS[0];

const modelByName = (name) => MODELS.find((model) => model.name === name);

const supportedFormat = (model) => model.format === 'glb' || model.format === 'gltf';

const envUrl = (value) => {
  if (value == null || value === '') {
    return ENV_MAPS[DEFAULT_ENV_NAME];
  }
  if (value === NO_ENVIRONMENT) {
    return '';
  }
  if (ENV_MAPS[value]) {
    return ENV_MAPS[value] === NO_ENVIRONMENT ? '' : ENV_MAPS[value];
  }
  if (/^https?:\/\//.test(value)) {
    return value;
  }
  return ENV_MAPS[DEFAULT_ENV_NAME];
};

const singleAxisOrientation = (rotation) => {
  if (rotation == null) {
    return '0deg 0deg 0deg';
  }
  const [x, y, z] = rotation;
  const axes = [x, y, z].filter((value) => Math.abs(value) > 1e-6).length;
  if (axes > 1) {
    return null;
  }
  return `${z}rad ${x}rad ${y}rad`;
};

const setStatus = (text) => {
  statusNode.textContent = text;
};

const notesFor = (model) => {
  const notes = [];
  if (!supportedFormat(model)) {
    notes.push(`model-viewer cannot load .${model.format}. The upstream demo can.`);
  }
  if (model.postProcess) {
    notes.push('Upstream edits materials or replaces emissive quads with area lights after load. This page loads the file as published.');
  }
  if (model.stage === 'pedestal' || model.stage === 'backdrop') {
    notes.push('Pedestal and backdrop meshes are not in model-viewer.');
  }
  if (model.rotation && singleAxisOrientation(model.rotation) == null) {
    notes.push('This model uses a multi-axis Euler. model-viewer orientation is YXZ, so it is left unrotated.');
  }
  if (!params.envMap || params.envMap === NO_ENVIRONMENT) {
    notes.push('With no environment URL, model-viewer applies neutral lighting instead of a black environment.');
  }
  return notes;
};

const applyBackground = () => {
  document.body.classList.toggle('checkerboard', params.background === 'transparent');
  document.body.classList.toggle('light-background', params.background === 'white');
  document.body.classList.toggle('dark-background', params.background === 'black');
};

const applyStage = () => {
  if (params.stage === 'floor') {
    viewer.setAttribute('shadow-mode', 'path-tracer');
    viewer.setAttribute('shadow-intensity', '1');
    return;
  }
  viewer.setAttribute('shadow-mode', 'none');
  viewer.setAttribute('shadow-intensity', '0');
};

const applyEnvironment = () => {
  const url = envUrl(params.envMap);
  if (url) {
    viewer.setAttribute('environment-image', url);
  } else {
    viewer.removeAttribute('environment-image');
  }
};

const applyDepthOfField = () => {
  if (params.bokehSize <= 0) {
    viewer.removeAttribute('path-tracer-depth-of-field');
    return;
  }
  const focal = Number(viewer.getAttribute('path-tracer-focal-length') || 50);
  viewer.setAttribute('path-tracer-depth-of-field', '');
  viewer.setAttribute('path-tracer-f-stop', String(Math.max(0.1, focal / params.bokehSize)));
  viewer.setAttribute('path-tracer-focus-distance', String(params.focusDistance));
};

const applyTracer = () => {
  if (params.enable) {
    viewer.setAttribute('path-tracer', '');
  } else {
    viewer.removeAttribute('path-tracer');
  }
  viewer.setAttribute('path-tracer-bounces', String(params.maxBounces));
  viewer.setAttribute('path-tracer-render-scale', String(params.renderScale));
  viewer.setAttribute('path-tracer-samples', String(Math.max(1, params.maxSamples)));
  applyDepthOfField();
};

const refreshGui = () => {
  if (gui == null) {
    return;
  }
  const visit = (folder) => {
    for (const controller of folder.controllers) {
      controller.updateDisplay();
    }
    for (const child of folder.folders) {
      visit(child);
    }
  };
  visit(gui);
};

const applyModel = (model) => {
  currentModel = model;
  params.model = model.name;
  params.envMap = model.envMap ?? ENV_MAPS[DEFAULT_ENV_NAME];
  if (model.envMap && ENV_MAPS[model.envMap]) {
    params.envMap = ENV_MAPS[model.envMap];
  } else if (model.envMap) {
    params.envMap = model.envMap;
  }
  params.stage = model.stage ?? 'floor';
  params.background = 'white';
  params.lighting = 'none';
  params.bokehSize = model.bokehSize ?? 0;
  params.focusDistance = model.focusDistance ?? 1;

  if (supportedFormat(model)) {
    viewer.setAttribute('src', model.url);
  }

  applyEnvironment();
  applyStage();
  applyBackground();
  applyTracer();
  setStatus([model.credit, ...notesFor(model)].filter(Boolean).join(' '));
  upstreamLink.href = upstreamHref();
  refreshGui();
};

const upstreamHref = () => {
  const url = new URL(UPSTREAM);
  url.searchParams.set('model', params.model);
  return url.href;
};

const onModelChange = (name) => {
  const model = modelByName(name) ?? MODELS[0];
  const page = new URL(location.href);
  page.searchParams.set('model', model.name);
  history.pushState({}, '', page);
  applyModel(model);
};

const disable = (controller, reason) => {
  controller.disable();
  controller.domElement.title = reason;
};

const buildGui = () => {
  gui = new GUI({title: 'Path tracer'});
  gui.add(params, 'model', MODELS.map((model) => model.name)).onChange(onModelChange);

  const pathTracingFolder = gui.addFolder('Path Tracer');
  pathTracingFolder.add(params, 'enable').onChange(applyTracer);
  disable(pathTracingFolder.add(params, 'pause'), UNSUPPORTED.pause);
  pathTracingFolder.add(params, 'maxBounces', 1, 50, 1).onChange(applyTracer);
  pathTracingFolder.add(params, 'renderScale', 0.1, 1.0, 0.01).onChange(applyTracer);
  disable(pathTracingFolder.add(params, 'frameBudget', 50000, 2000000, 50000), UNSUPPORTED.frameBudget);
  pathTracingFolder.add(params, 'maxSamples', 1, 500, 1)
      .name('maxSamples')
      .onChange(applyTracer);
  disable(
      pathTracingFolder.add(params, 'multipleImportanceSampling'),
      UNSUPPORTED.multipleImportanceSampling);
  disable(
      pathTracingFolder.add(params, 'randomStrategy', ['Blue Dither', 'Sobol', 'PCG']),
      UNSUPPORTED.randomStrategy);
  disable(
      pathTracingFolder.add(params, 'cameraProjection', ['Perspective', 'Orthographic']),
      UNSUPPORTED.cameraProjection);
  pathTracingFolder.add({
    note: 'maxSamples 0 (unlimited) is not supported. The slider starts at 1.',
  }, 'note').name('maxSamples note').disable();
  pathTracingFolder.open();

  const postFolder = gui.addFolder('Denoise / Upscale');
  disable(postFolder.add(params, 'denoise'), UNSUPPORTED.denoise);
  disable(postFolder.add(params, 'upscale'), UNSUPPORTED.upscale);
  disable(postFolder.add(params, 'sharpness', 0, 1, 0.01), UNSUPPORTED.sharpness);

  const cameraFolder = gui.addFolder('Camera');
  cameraFolder.add(params, 'bokehSize', 0, 100, 0.5).onChange(applyDepthOfField);
  cameraFolder.add(params, 'focusDistance', 0.05, 10, 0.01).onChange(applyDepthOfField);

  const backdropFolder = gui.addFolder('Backdrop');
  backdropFolder.add(params, 'envMap', ENV_MAPS).name('environment').onChange(() => {
    applyEnvironment();
    setStatus([currentModel.credit, ...notesFor(currentModel)].filter(Boolean).join(' '));
  });
  backdropFolder.add(params, 'stage', ['floor', 'pedestal', 'backdrop', 'none'])
      .name('stage')
      .onChange(() => {
        applyStage();
        setStatus([currentModel.credit, ...notesFor(currentModel)].filter(Boolean).join(' '));
      });
  backdropFolder.add(params, 'background', ['black', 'white', 'transparent'])
      .name('background')
      .onChange(applyBackground);
  disable(
      backdropFolder.add(params, 'lighting', LIGHT_RIGS).name('lighting'),
      UNSUPPORTED.lighting);
  backdropFolder.add({
    note: 'Background is the page behind a transparent canvas, not upstream\'s gradient environment. Floor is the path-tracer shadow catcher, not the radial floor texture. Pedestal and backdrop are not built.',
  }, 'note').name('stage note').disable();
  backdropFolder.open();

  gui.add({
    openUpstream() {
      window.open(upstreamHref(), '_blank', 'noopener');
    },
  }, 'openUpstream').name('Open upstream demo');
};

const readModelQuery = () => {
  const requested = new URLSearchParams(location.search).get('model');
  return modelByName(requested)?.name ?? MODELS[0].name;
};

buildGui();
params.model = readModelQuery();
applyModel(modelByName(params.model));
window.addEventListener('popstate', () => {
  params.model = readModelQuery();
  applyModel(modelByName(params.model));
});

viewer.addEventListener('load', () => {
  const orientation = singleAxisOrientation(currentModel?.rotation);
  viewer.setAttribute('orientation', orientation ?? '0deg 0deg 0deg');
});

viewer.addEventListener('error', () => {
  setStatus(`Failed to load ${viewer.getAttribute('src') || 'the model'}.`);
});
