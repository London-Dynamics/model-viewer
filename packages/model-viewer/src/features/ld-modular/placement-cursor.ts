import {
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Object3D,
  Quaternion,
  RingGeometry,
  CircleGeometry,
  Vector3,
} from 'three';

export const PLACEMENT_CURSOR_DIAMETER_M = 0.2;
export const PLACEMENT_CURSOR_PULSE_SPEED = 0.5;
export const PLACEMENT_CURSOR_PULSE_GROWTH_RATIO = 0.12;

const CURSOR_RENDER_ORDER = 9999;
const CURSOR_COLOUR = 0x165dfc;
const CURSOR_SURFACE_OFFSET_M = 0.001;
const CURSOR_BASE_NORMAL = new Vector3(0, 1, 0);
const TMP_QUATERNION = new Quaternion();
const TMP_PARENT_QUATERNION = new Quaternion();
const TMP_PARENT_QUATERNION_INV = new Quaternion();
const TMP_NORMAL = new Vector3();
const TMP_POSITION = new Vector3();

export class PlacementCursor extends Object3D {
  private fillMesh: Mesh;
  private ringMesh: Mesh;
  private elapsedSeconds = 0;
  private readonly radius = PLACEMENT_CURSOR_DIAMETER_M * 0.5;
  private readonly onNeedsRender: () => void;

  constructor(onNeedsRender: () => void) {
    super();
    this.onNeedsRender = onNeedsRender;

    const fillGeometry = new CircleGeometry(1, 40);
    fillGeometry.rotateX(-Math.PI / 2);
    const fillMaterial = new MeshBasicMaterial({
      color: CURSOR_COLOUR,
      transparent: true,
      opacity: 0.14,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending,
    });
    this.fillMesh = new Mesh(fillGeometry, fillMaterial);
    this.fillMesh.renderOrder = CURSOR_RENDER_ORDER;
    this.fillMesh.frustumCulled = false;
    this.fillMesh.userData.noHit = true;
    this.fillMesh.userData.selectable = false;
    this.add(this.fillMesh);

    const ringGeometry = new RingGeometry(0.92, 1, 64);
    ringGeometry.rotateX(-Math.PI / 2);
    const ringMaterial = new MeshBasicMaterial({
      color: CURSOR_COLOUR,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
      blending: NormalBlending,
    });
    this.ringMesh = new Mesh(ringGeometry, ringMaterial);
    this.ringMesh.renderOrder = CURSOR_RENDER_ORDER + 1;
    this.ringMesh.frustumCulled = false;
    this.ringMesh.userData.noHit = true;
    this.ringMesh.userData.selectable = false;
    this.add(this.ringMesh);

    this.visible = false;
    this.applyScale();
  }

  private applyScale() {
    const pulse =
      1 +
      Math.sin(
        this.elapsedSeconds * Math.PI * 2 * PLACEMENT_CURSOR_PULSE_SPEED
      ) *
        PLACEMENT_CURSOR_PULSE_GROWTH_RATIO;
    const scale = this.radius * pulse;
    this.fillMesh.scale.set(scale, 1, scale);
    this.ringMesh.scale.set(scale, 1, scale);
  }

  private setPose(worldPoint: Vector3, worldNormal: Vector3) {
    TMP_NORMAL.copy(worldNormal).normalize();
    TMP_QUATERNION.setFromUnitVectors(CURSOR_BASE_NORMAL, TMP_NORMAL);
    if (this.parent) {
      this.parent.updateMatrixWorld(true);
      this.parent.getWorldQuaternion(TMP_PARENT_QUATERNION);
      TMP_PARENT_QUATERNION_INV.copy(TMP_PARENT_QUATERNION).invert();
      this.quaternion.copy(TMP_PARENT_QUATERNION_INV).multiply(TMP_QUATERNION);
    } else {
      this.quaternion.copy(TMP_QUATERNION);
    }

    TMP_POSITION.copy(worldPoint).addScaledVector(
      TMP_NORMAL,
      CURSOR_SURFACE_OFFSET_M
    );
    if (this.parent) {
      this.position.copy(this.parent.worldToLocal(TMP_POSITION.clone()));
    } else {
      this.position.copy(TMP_POSITION);
    }
    this.visible = true;
    this.onNeedsRender();
  }

  showOnFloor(worldPoint: Vector3) {
    this.setPose(worldPoint, CURSOR_BASE_NORMAL);
  }

  showOnSurface(worldPoint: Vector3, worldNormal: Vector3) {
    this.setPose(worldPoint, worldNormal);
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.onNeedsRender();
  }

  tick(deltaMs: number) {
    if (!this.visible) return;
    this.elapsedSeconds += deltaMs / 1000;
    this.applyScale();
    this.onNeedsRender();
  }

  dispose() {
    this.hide();
    if (this.parent) {
      this.parent.remove(this);
    }
    this.fillMesh.geometry.dispose();
    (this.fillMesh.material as MeshBasicMaterial).dispose();
    this.ringMesh.geometry.dispose();
    (this.ringMesh.material as MeshBasicMaterial).dispose();
  }
}
