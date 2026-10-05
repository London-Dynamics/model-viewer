// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

export interface OceanFloorObjects {
  grass: THREE.InstancedMesh[];
  rocks: THREE.InstancedMesh[];
  seaweed: THREE.InstancedMesh[];
}

export interface LoadedModels {
  islandBuoys: THREE.Mesh[];
  islandModel: THREE.Mesh;
  oceanFloorObjects: OceanFloorObjects;
  shipModel: THREE.Mesh;
  shipWaterMask: THREE.Object3D | undefined;
}

/**
 * Create and configure the GLTF loader with Draco support
 */
function createGLTFLoader(): GLTFLoader {
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(
    "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
  );
  gltfLoader.setDRACOLoader(dracoLoader);
  return gltfLoader;
}

/**
 * Load and configure the ship model
 */
async function loadShipModel(gltfLoader: GLTFLoader): Promise<{
  shipModel: THREE.Mesh;
  shipWaterMask: THREE.Mesh;
}> {
  const shipGltf = await gltfLoader.loadAsync(
    "/models/dutch_ship_medium_2k.glb",
  );

  const shipModel = shipGltf.scene as unknown as THREE.Mesh;
  shipModel.rotation.y = Math.PI;
  shipModel.position.set(-40, 0, 0);
  shipModel.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  // The model is authored at real-world size (~24 m hull), matching the
  // water's physical calibration, so it needs no scale.

  // Use the ship itself as its mask (no dedicated mask geometry for this model).
  const shipWaterMask = shipModel;

  return { shipModel, shipWaterMask };
}

/**
 * Random number generator with seed for reproducible results
 */
function seededRandom(seed: number): () => number {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/**
 * Check if a position is within the island exclusion zone
 */
function isInIslandZone(x: number, z: number): boolean {
  const islandX = 25;
  const islandZ = -25;
  const exclusionRadius = 15;
  const dx = x - islandX;
  const dz = z - islandZ;
  return dx * dx + dz * dz < exclusionRadius * exclusionRadius;
}

/**
 * Generate a valid spawn position outside the island zone
 */
function generateValidPosition(
  random: () => number,
  spawnRadius: number,
  centerX: number,
  centerZ: number,
): { x: number; z: number } {
  let x: number, z: number;
  let attempts = 0;
  do {
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(random()) * spawnRadius;
    x = centerX + Math.cos(angle) * radius;
    z = centerZ + Math.sin(angle) * radius;
    attempts++;
  } while (isInIslandZone(x, z) && attempts < 100);
  return { x, z };
}

interface ExtractOptions {
  fixAlpha?: boolean;
  brightenMaterial?: boolean;
}

/**
 * Extract geometry and material from a GLTF scene
 */
function extractMeshData(
  scene: THREE.Object3D,
  options: ExtractOptions = {},
): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
  let result: {
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
  } | null = null;
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh && !result) {
      const material = (obj.material as THREE.Material).clone();

      if (material instanceof THREE.MeshStandardMaterial) {
        // Ensure proper texture color space
        if (material.map) {
          material.map.colorSpace = THREE.SRGBColorSpace;
        }

        // Fix alpha/depth issues for vegetation
        if (options.fixAlpha) {
          material.alphaTest = 0.5;
          material.transparent = false;
          material.depthWrite = true;
          material.side = THREE.DoubleSide;
        }

        // Brighten dark materials (underwater objects)
        if (options.brightenMaterial) {
          material.metalness = Math.min(material.metalness, 0.1);
          material.roughness = Math.max(material.roughness, 0.7);
        }
      }

      result = {
        geometry: obj.geometry.clone(),
        material,
      };
    }
  });
  return result;
}

/**
 * Extract all meshes from a GLTF scene (for multi-object GLB files)
 */
function extractAllMeshData(
  scene: THREE.Object3D,
  options: ExtractOptions = {},
): Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> {
  const meshes: Array<{
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
  }> = [];

  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      const material = (obj.material as THREE.Material).clone();

      if (material instanceof THREE.MeshStandardMaterial) {
        if (material.map) {
          material.map.colorSpace = THREE.SRGBColorSpace;
        }
        if (options.fixAlpha) {
          material.alphaTest = 0.5;
          material.transparent = false;
          material.depthWrite = true;
          material.side = THREE.DoubleSide;
        }
        if (options.brightenMaterial) {
          material.metalness = Math.min(material.metalness, 0.1);
          material.roughness = Math.max(material.roughness, 0.7);
        }
      }

      meshes.push({
        geometry: obj.geometry.clone(),
        material,
      });
    }
  });

  return meshes;
}

/**
 * Load and configure ocean floor objects using instancing
 */
async function loadOceanFloorObjects(
  gltfLoader: GLTFLoader,
): Promise<OceanFloorObjects> {
  const seaweedNames = ["seaweed", "seaweed_tall"];

  const [rocksGltf, seaweedGltfs, grassGltf] = await Promise.all([
    gltfLoader.loadAsync("/models/rocks.glb"),
    Promise.all(
      seaweedNames.map((n) => gltfLoader.loadAsync(`/models/${n}.glb`)),
    ),
    gltfLoader.loadAsync("/models/grass.glb"),
  ]);

  const result: OceanFloorObjects = {
    grass: [],
    rocks: [],
    seaweed: [],
  };
  const random = seededRandom(42);

  // Configuration. Instances are baked relative to the ocean floor, sunk
  // slightly so they never hover over displaced terrain; each mesh's own Y is
  // set from the floor depth (see `UnderwaterScenery.setFloorDepth`).
  const floorDepth = -0.01;
  const spawnRadius = 40;
  const centerX = -15;
  const centerZ = 15;

  // Instance counts per model type
  const rockCount = 50;
  const normalSeaweedCount = 100;
  const tallSeaweedCount = 100;
  const grassCount = 25;

  const tempMatrix = new THREE.Matrix4();
  const tempPosition = new THREE.Vector3();
  const tempQuaternion = new THREE.Quaternion();
  const tempScale = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);

  // Extract individual rock meshes from the combined GLB file
  const rockMeshData = extractAllMeshData(rocksGltf.scene, {
    brightenMaterial: true,
  });
  const rockTypeCount = rockMeshData.length;

  // Each rock type gets an equal share of the total count
  if (rockTypeCount > 0) {
    const countPerType = Math.ceil(rockCount / rockTypeCount);

    for (const meshData of rockMeshData) {
      const instancedMesh = new THREE.InstancedMesh(
        meshData.geometry,
        meshData.material,
        countPerType,
      );
      instancedMesh.castShadow = true;
      instancedMesh.receiveShadow = true;

      for (let i = 0; i < countPerType; i++) {
        const pos = generateValidPosition(
          random,
          spawnRadius,
          centerX,
          centerZ,
        );
        tempPosition.set(pos.x, floorDepth, pos.z);
        tempQuaternion.setFromAxisAngle(yAxis, random() * Math.PI * 2);
        const scale = 5 + random() * 2.5;
        tempScale.set(scale, scale, scale);
        tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
        instancedMesh.setMatrixAt(i, tempMatrix);
      }

      instancedMesh.instanceMatrix.needsUpdate = true;
      result.rocks.push(instancedMesh);
    }
  }

  // Create instanced mesh for normal seaweed
  const normalSeaweedData = extractMeshData(seaweedGltfs[0].scene, {
    fixAlpha: true,
  });
  if (normalSeaweedData) {
    const instancedMesh = new THREE.InstancedMesh(
      normalSeaweedData.geometry,
      normalSeaweedData.material,
      normalSeaweedCount,
    );
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;

    for (let i = 0; i < normalSeaweedCount; i++) {
      const pos = generateValidPosition(random, spawnRadius, centerX, centerZ);
      tempPosition.set(pos.x, floorDepth, pos.z);
      tempQuaternion.setFromAxisAngle(yAxis, random() * Math.PI * 2);
      const scale = 0.006 + random() * 0.008;
      tempScale.set(scale, scale, scale);
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      instancedMesh.setMatrixAt(i, tempMatrix);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    result.seaweed.push(instancedMesh);
  }

  // Create instanced mesh for tall seaweed
  const tallSeaweedData = extractMeshData(seaweedGltfs[1].scene, {
    fixAlpha: true,
  });
  if (tallSeaweedData) {
    const instancedMesh = new THREE.InstancedMesh(
      tallSeaweedData.geometry,
      tallSeaweedData.material,
      tallSeaweedCount,
    );
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = true;

    for (let i = 0; i < tallSeaweedCount; i++) {
      const pos = generateValidPosition(random, spawnRadius, centerX, centerZ);
      tempPosition.set(pos.x, floorDepth, pos.z);
      tempQuaternion.setFromAxisAngle(yAxis, random() * Math.PI * 2);
      const scale = 0.75 + random() * 1;
      tempScale.set(scale, scale, scale);
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      instancedMesh.setMatrixAt(i, tempMatrix);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    result.seaweed.push(instancedMesh);
  }

  // Create instanced mesh for grass
  const grassMeshData = extractMeshData(grassGltf.scene, { fixAlpha: true });
  if (grassMeshData) {
    const grassInstancedMesh = new THREE.InstancedMesh(
      grassMeshData.geometry,
      grassMeshData.material,
      grassCount,
    );
    grassInstancedMesh.castShadow = true;
    grassInstancedMesh.receiveShadow = true;

    const xAxis = new THREE.Vector3(1, 0, 0);
    for (let i = 0; i < grassCount; i++) {
      const pos = generateValidPosition(
        random,
        spawnRadius / 2,
        centerX,
        centerZ,
      );
      tempPosition.set(pos.x, floorDepth, pos.z);
      tempQuaternion.setFromAxisAngle(xAxis, -Math.PI / 2);
      const scale = 0.05 + random() * 0.05;
      tempScale.set(scale, scale, scale);
      tempMatrix.compose(tempPosition, tempQuaternion, tempScale);
      grassInstancedMesh.setMatrixAt(i, tempMatrix);
    }

    grassInstancedMesh.instanceMatrix.needsUpdate = true;
    result.grass.push(grassInstancedMesh);
  }

  return result;
}

/**
 * Load and configure the island model
 */
async function loadIslandModel(gltfLoader: GLTFLoader): Promise<THREE.Mesh> {
  const islandGltf = await gltfLoader.loadAsync("/models/island.glb");
  const islandModel = islandGltf.scene as unknown as THREE.Mesh;
  islandModel.position.set(25, 3.5, -25);
  islandModel.scale.set(1, 1, 1);
  islandModel.rotation.x = Math.PI / 2;
  islandModel.rotation.y = -Math.PI;

  islandModel.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;

    // The scan ships position + uv only; the lit material needs normals.
    if (!obj.geometry.getAttribute("normal")) {
      obj.geometry.computeVertexNormals();
    }

    obj.castShadow = true;
    obj.receiveShadow = true;

    const materials = Array.isArray(obj.material)
      ? obj.material
      : [obj.material];

    for (const material of materials) {
      if (!material) continue;
      const mat = material as THREE.MeshStandardMaterial;

      // Foliage panels are authored single-sided; render both faces.
      mat.side = THREE.DoubleSide;

      // Foliage alpha-cutout: only force alpha test on materials that
      // actually have an alpha channel to test. An opaque trunk with just a
      // diffuse map shouldn't have its alpha tested — it has no alpha to
      // begin with, and turning on `alphaTest` + `alphaToCoverage` breaks
      // shadow casting because the shadow depth pass can't run MSAA.
      const isAlphaCutout =
        mat.alphaMap || mat.transparent || (mat.alphaTest ?? 0) > 0;
      if (isAlphaCutout) {
        mat.alphaTest = 0.1;
        mat.alphaToCoverage = true;
        mat.transparent = false;
        mat.depthWrite = true;
      }

      // Ensure the diffuse map's color space is correct (glTF exports can
      // leave it as Linear when it should be sRGB).
      if (mat.map) mat.map.colorSpace = THREE.SRGBColorSpace;
    }
  });
  return islandModel;
}

/**
 * Load all models for the scene
 */
export async function loadAllModels(): Promise<LoadedModels> {
  const gltfLoader = createGLTFLoader();

  const [shipResult, buoyGltf, islandModel, oceanFloorObjects] =
    await Promise.all([
      loadShipModel(gltfLoader),
      gltfLoader.loadAsync("/models/buoy.glb"),
      loadIslandModel(gltfLoader),
      loadOceanFloorObjects(gltfLoader),
    ]);

  // Create buoys in a ring around the island
  const buoyTemplate = buoyGltf.scene as unknown as THREE.Mesh;
  buoyTemplate.scale.set(0.25, 0.25, 0.25);
  const islandCenter = islandModel.position;
  const buoyRadius = 50;
  const buoyCount = 12;
  const islandBuoys: THREE.Mesh[] = [];
  for (let i = 0; i < buoyCount; i++) {
    const angle = (i / buoyCount) * Math.PI * 2;
    const clone = buoyTemplate.clone();
    clone.position.set(
      islandCenter.x + Math.cos(angle) * buoyRadius,
      0,
      islandCenter.z + Math.sin(angle) * buoyRadius,
    );
    clone.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    islandBuoys.push(clone);
  }

  return {
    islandBuoys,
    islandModel,
    oceanFloorObjects,
    shipModel: shipResult.shipModel,
    shipWaterMask: shipResult.shipWaterMask,
  };
}

/**
 * Add all models to the scene
 */
export function addModelsToScene(
  scene: THREE.Scene,
  models: LoadedModels,
): void {
  scene.add(models.shipModel);
  scene.add(models.islandModel);
  for (const buoy of models.islandBuoys) {
    scene.add(buoy);
  }
  const { grass, rocks, seaweed } = models.oceanFloorObjects;
  for (const obj of [...grass, ...rocks, ...seaweed]) {
    scene.add(obj);
  }
}
