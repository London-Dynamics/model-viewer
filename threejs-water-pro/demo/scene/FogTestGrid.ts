// Three.js Water Pro © 2025–2026 DRG Software Solutions LLC.
// Proprietary — licensed, not sold. See LICENSE.md.

import * as THREE from "three/webgpu";
import type { WaterSystem } from "threejs-water-pro";

const CELL_SIZE = 8;
const CELL_SPACING = CELL_SIZE * 1.5;
const GRID_COLUMNS = 3;
/** Extra vertical pitch leaves room for each cell's label plate. */
const ROW_SPACING = CELL_SPACING * 1.2;
const ALPHA_OPACITY = 0.6;
const TEXTURE_SIZE = 256;

type BlendKind = "additive" | "normal";
type ObjectKind = "quad" | "sprite";

interface Variant {
  alphaTest: number;
  blend: BlendKind;
  label: string;
  object: ObjectKind;
  opaque: boolean;
  /** Number of overlapping copies (tests stacked transparency). */
  stack: number;
  tint: number;
}

/** One cell per transparency variant the atmospheric fog must compose with. */
const VARIANTS: Variant[] = [
  { label: "OPAQUE", object: "quad", opaque: true, blend: "normal", alphaTest: 0, stack: 1, tint: 0xcccccc },
  { label: "ALPHA", object: "quad", opaque: false, blend: "normal", alphaTest: 0, stack: 1, tint: 0x4d9fff },
  { label: "SPRITE", object: "sprite", opaque: false, blend: "normal", alphaTest: 0, stack: 1, tint: 0x4dff88 },
  { label: "SPRITE ADD", object: "sprite", opaque: false, blend: "additive", alphaTest: 0, stack: 1, tint: 0xffe14d },
  { label: "ALPHATEST", object: "quad", opaque: false, blend: "normal", alphaTest: 0.1, stack: 1, tint: 0xff9a4d },
  { label: "ADDITIVE", object: "quad", opaque: false, blend: "additive", alphaTest: 0, stack: 1, tint: 0xff4d4d },
  { label: "ADD ATEST", object: "quad", opaque: false, blend: "additive", alphaTest: 0.1, stack: 1, tint: 0xff4dff },
  { label: "STACK x3", object: "quad", opaque: false, blend: "normal", alphaTest: 0, stack: 3, tint: 0x9a4dff },
];

/** Soft white blob whose alpha falls off radially. */
function createBlobTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = TEXTURE_SIZE;
  canvas.height = TEXTURE_SIZE;
  const ctx = canvas.getContext("2d")!;
  const center = TEXTURE_SIZE / 2;
  const gradient = ctx.createRadialGradient(
    center,
    center,
    0,
    center,
    center,
    center,
  );
  gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
  gradient.addColorStop(0.7, "rgba(255, 255, 255, 0.6)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Opaque label plate — doubles as a fogs-like-geometry reference. */
function createLabelTexture(text: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 56px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * In-scene verification grid for atmospheric fog × transparent billboards:
 * one labelled cell per variant in {@link VARIANTS}, all stock three.js
 * materials with no special setup. Fog is per-material, so every cell must
 * blend correctly and melt into the haze on the same curve as the scene.
 *
 * Position the rig in the fog band with the distance/height controls and
 * orbit the camera.
 */
export class FogTestGrid {
  public readonly group = new THREE.Group();

  private readonly blobTexture = createBlobTexture();
  private readonly cellGeometry = new THREE.PlaneGeometry(
    CELL_SIZE,
    CELL_SIZE,
  );
  private readonly labelGeometry = new THREE.PlaneGeometry(
    CELL_SIZE * 1.3,
    CELL_SIZE * 0.32,
  );
  /** Camera-facing quads and labels (sprites billboard themselves). */
  private readonly billboards: THREE.Mesh[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly scene: THREE.Scene;

  private _enabled = false;
  private _distance = 150;
  private _height = 20;
  private _followCameraAzimuth = true;
  private _azimuth = 0;
  private readonly _lastCameraPosition = new THREE.Vector3();

  // Per-frame scratch (no allocations in update).
  private readonly _forward = new THREE.Vector3();
  private readonly _groupQuatInverse = new THREE.Quaternion();
  private readonly _billboardQuat = new THREE.Quaternion();

  constructor(waterSystem: WaterSystem) {
    this.scene = waterSystem.scene;
    this.disposables.push(
      this.blobTexture,
      this.cellGeometry,
      this.labelGeometry,
    );

    // 3-wide rows, variants in reading order (top-left → bottom-right).
    VARIANTS.forEach((variant, index) => {
      const column = index % GRID_COLUMNS;
      const row = Math.floor(index / GRID_COLUMNS);
      const x = (column - (GRID_COLUMNS - 1) / 2) * CELL_SPACING;
      const y = (1 - row) * ROW_SPACING;
      for (let copy = 0; copy < variant.stack; copy++) {
        // Overlap stacked copies with a small diagonal offset so their
        // silhouettes cross.
        const offset = (copy - (variant.stack - 1) / 2) * CELL_SIZE * 0.3;
        this.addCell(
          variant,
          new THREE.Vector3(x + offset, y + offset, copy * 2),
        );
      }
      this.addLabel(variant.label, x, y - CELL_SPACING * 0.55);
    });

    this.group.visible = false;
    this.scene.add(this.group);
  }

  // ── Controls (bound by the Debug UI folder) ──

  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(value: boolean) {
    this._enabled = value;
    this.group.visible = value;
  }

  /** Horizontal distance from the camera to the rig (world units). */
  get distance(): number {
    return this._distance;
  }
  set distance(value: number) {
    this._distance = value;
    this.applyPlacement();
  }

  /** Height of the grid's centre above sea level (world units). */
  get height(): number {
    return this._height;
  }
  set height(value: number) {
    this._height = value;
    this.applyPlacement();
  }

  /** Keep the rig centred ahead of the camera so pitch sweeps the fog band across it. */
  get followCameraAzimuth(): boolean {
    return this._followCameraAzimuth;
  }
  set followCameraAzimuth(value: boolean) {
    this._followCameraAzimuth = value;
  }

  public update(activeCamera: THREE.PerspectiveCamera): void {
    if (!this._enabled) return;

    activeCamera.getWorldDirection(this._forward);
    this._forward.y = 0;
    if (this._followCameraAzimuth && this._forward.lengthSq() > 1e-6) {
      this._azimuth = Math.atan2(this._forward.x, this._forward.z);
    }
    this._lastCameraPosition.setFromMatrixPosition(activeCamera.matrixWorld);
    this.applyPlacement();

    // Billboard the quads/labels: local orientation that yields the camera's
    // world orientation under the group's own yaw.
    this._groupQuatInverse.copy(this.group.quaternion).invert();
    this._billboardQuat
      .copy(this._groupQuatInverse)
      .multiply(activeCamera.quaternion);
    for (const mesh of this.billboards) {
      mesh.quaternion.copy(this._billboardQuat);
    }
  }

  public dispose(): void {
    this.scene.remove(this.group);
    for (const resource of this.disposables) {
      resource.dispose();
    }
    this.disposables.length = 0;
    this.billboards.length = 0;
  }

  // ── Construction ──

  private addCell(variant: Variant, position: THREE.Vector3): void {
    const material = this.createMaterial(variant);
    let object: THREE.Object3D;
    if (variant.object === "sprite") {
      const sprite = new THREE.Sprite(material as THREE.SpriteMaterial);
      sprite.scale.set(CELL_SIZE, CELL_SIZE, 1);
      object = sprite;
    } else {
      const mesh = new THREE.Mesh(this.cellGeometry, material);
      this.billboards.push(mesh);
      object = mesh;
    }
    object.position.copy(position);
    this.group.add(object);
  }

  /** Stock three.js material — the grid tests the library as-is. */
  private createMaterial(variant: Variant): THREE.Material {
    const additive = variant.blend === "additive";
    const shared = {
      alphaTest: variant.alphaTest,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      color: variant.tint,
      depthWrite: false,
      map: this.blobTexture,
      opacity: additive ? 1.0 : ALPHA_OPACITY,
      transparent: true,
    };
    let material: THREE.Material;
    if (variant.object === "sprite") {
      material = new THREE.SpriteMaterial(shared);
    } else if (variant.opaque) {
      material = new THREE.MeshBasicMaterial({ color: variant.tint });
    } else {
      material = new THREE.MeshBasicMaterial({
        ...shared,
        side: THREE.DoubleSide,
      });
    }
    this.disposables.push(material);
    return material;
  }

  private addLabel(text: string, x: number, y: number): void {
    const labelTexture = createLabelTexture(text);
    const material = new THREE.MeshBasicMaterial({
      map: labelTexture,
      side: THREE.DoubleSide,
    });
    this.disposables.push(labelTexture, material);
    const mesh = new THREE.Mesh(this.labelGeometry, material);
    mesh.position.set(x, y, 0);
    this.billboards.push(mesh);
    this.group.add(mesh);
  }

  // ── Placement ──

  private applyPlacement(): void {
    this.group.position.set(
      this._lastCameraPosition.x + Math.sin(this._azimuth) * this._distance,
      this._height,
      this._lastCameraPosition.z + Math.cos(this._azimuth) * this._distance,
    );
    this.group.rotation.y = this._azimuth;
  }
}
