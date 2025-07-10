import {
  //BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { Cursor as CursorBase } from './Cursor';

const GOLDEN_RATIO = 0.618; // Approximate value of the golden ratio
const ARROW_DEPTH = 0.33; // Depth of the arrow head

const ROTATION_PERIOD = 1000; // 1 second for a full rotation
const BOUNCE_PERIOD = 1500; // 1.5 seconds for a full bounce cycle

export class Cursor extends CursorBase {
  private group: Group;
  private shaft: Mesh;
  private head: Mesh;
  private radius: number;
  private baseY: number = 0.01;
  private elapsedTime: number = 0;

  constructor(scene: any, targetObject: Object3D, radius: number = 0.1) {
    super(scene, targetObject);

    this.radius = radius;

    this.group = new Group();

    const material = new MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.1,
      roughness: 0.3,
    });

    this.shaft = this.createShaft(material);
    this.head = this.createHead(material);
    this.group.add(this.shaft);
    this.group.add(this.head);
    this.add(this.group);
    this.position.set(0, this.baseY, 0);
  }

  setVisible(visible: boolean) {
    super.setVisible(visible);

    if (!visible) {
      // Stop animation when not visible
      this.stopAnimation();
    }
  }

  private createShaft(material: MeshStandardMaterial): Mesh {
    // Shaft is a block, width = 0.3*radius, height = radius, depth = 0.33*radius
    const w = this.radius * GOLDEN_RATIO;
    const h = this.radius;
    const d = this.radius * ARROW_DEPTH;
    // const geometry = new BoxGeometry(w, h, d);

    const vertices = new Float32Array([
      // Front face (z = +d/2)
      -w / 2,
      h / 2,
      d / 2, // 0: top-left-front
      w / 2,
      h / 2,
      d / 2, // 1: top-right-front
      -w / 2,
      -h / 2,
      d / 2, // 2: bottom-left-front
      w / 2,
      -h / 2,
      d / 2, // 3: bottom-right-front
      // Back face (z = -d/2)
      -w / 2,
      h / 2,
      -d / 2, // 4: top-left-back
      w / 2,
      h / 2,
      -d / 2, // 5: top-right-back
      -w / 2,
      -h / 2,
      -d / 2, // 6: bottom-left-back
      w / 2,
      -h / 2,
      -d / 2, // 7: bottom-right-back
    ]);

    const indices = [
      // Front face
      0, 1, 2, 1, 3, 2,
      // Right face
      1, 5, 3, 5, 7, 3,
      // Back face
      5, 4, 7, 4, 6, 7,
      // Left face
      4, 0, 6, 0, 2, 6,
      // Top face
      4, 5, 0, 5, 1, 0,
      // Bottom face
      2, 3, 6, 3, 7, 6,
    ];

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.y = h / 2 + this.radius * GOLDEN_RATIO; // half heightarrow head height;
    return mesh;
  }

  private createHead(material: MeshStandardMaterial): Mesh {
    // Head is a triangular prism (not flat)
    const w = this.radius;
    const h = this.radius * GOLDEN_RATIO;
    const d = this.radius * ARROW_DEPTH;
    // 6 vertices (3 front, 3 back)
    const vertices = new Float32Array([
      // Front face (z = +d/2)
      -w / 2,
      0,
      d / 2, // left
      w / 2,
      0,
      d / 2, // right
      0,
      -h,
      d / 2, // bottom
      // Back face (z = -d/2)
      -w / 2,
      0,
      -d / 2, // left
      w / 2,
      0,
      -d / 2, // right
      0,
      -h,
      -d / 2, // bottom
    ]);
    // 8 triangles (2 per face: front, back, bottom; 2 for sides)
    const indices = [
      // Front face
      0, 1, 2,
      // Back face
      5, 4, 3,
      // Bottom face
      2, 1, 5, 2, 5, 5, 1, 4, 5,
      // Left face
      0, 2, 3, 2, 5, 3,
      // Right face
      1, 0, 4, 0, 3, 4,
    ];
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Position head so its tip is at y=0
    mesh.position.y = h;
    return mesh;
  }

  tick(_: number, delta: number) {
    if (!this.visible) return;

    this.elapsedTime += delta;
    // Rotate around Y axis
    this.group.rotation.y =
      (this.elapsedTime / ROTATION_PERIOD) * MathUtils.DEG2RAD * 45; // 45 deg/sec
    // Bounce up and down
    const bounce =
      (Math.sin((this.elapsedTime / BOUNCE_PERIOD) * 2 * Math.PI) + 1) *
      0.5 *
      (this.radius * 0.2);
    this.group.position.y = this.baseY + bounce;

    // Tell the renderer that we need it to update
    if (this.needsRender) {
      this.needsRender();
    }
  }

  private stopAnimation() {
    this.elapsedTime = 0;
  }
}
