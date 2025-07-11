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

const RENDER_ORDER = 920;

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
      depthTest: false,
      transparent: true,
    });

    this.shaft = this.createShaft(material);
    this.head = this.createHead(material);

    this.shaft.renderOrder = RENDER_ORDER;
    this.head.renderOrder = RENDER_ORDER;

    this.group.add(this.shaft);
    this.group.add(this.head);
    this.add(this.group);
    this.position.y = this.baseY;
  }

  setVisible(visible: boolean) {
    super.setVisible(visible);

    if (!visible) {
      // Stop animation when not visible
      this.stopAnimation();
    }
  }

  cleanup() {
    // Remove all geometry from the cursor
    this.clear();
    this.stopAnimation();
    super.cleanup();
  }

  private createShaft(material: MeshStandardMaterial): Mesh {
    // Shaft is a block
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
      // (No bottom face)
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
    // Head is a split triangular prism (not flat), with a gap at the top matching the shaft width
    const w = this.radius;
    const h = this.radius * GOLDEN_RATIO;
    const d = this.radius * ARROW_DEPTH;
    const shaftW = this.radius * GOLDEN_RATIO;
    const gap = shaftW;
    // Vertices: 8 total (4 front, 4 back)
    // 0: left outer top, 1: left inner top, 2: right inner top, 3: right outer top (front)
    // 4: left outer top, 5: left inner top, 6: right inner top, 7: right outer top (back)
    // 8: bottom front, 9: bottom back
    const vertices = new Float32Array([
      // Front face (z = +d/2)
      -w / 2,
      0,
      d / 2, // 0: left outer top
      -gap / 2,
      0,
      d / 2, // 1: left inner top
      gap / 2,
      0,
      d / 2, // 2: right inner top
      w / 2,
      0,
      d / 2, // 3: right outer top
      0,
      -h,
      d / 2, // 4: bottom front
      // Back face (z = -d/2)
      -w / 2,
      0,
      -d / 2, // 5: left outer top
      -gap / 2,
      0,
      -d / 2, // 6: left inner top
      gap / 2,
      0,
      -d / 2, // 7: right inner top
      w / 2,
      0,
      -d / 2, // 8: right outer top
      0,
      -h,
      -d / 2, // 9: bottom back
    ]);
    // Indices: split top, sides, and bottom
    const indices = [
      // Front face (split top)
      0,
      1,
      4, // left triangle
      1,
      2,
      4, // center triangle (gap)
      2,
      3,
      4, // right triangle
      // Back face (split top)
      5,
      9,
      6, // left triangle
      6,
      9,
      7, // center triangle (gap)
      7,
      9,
      8, // right triangle
      // Bottom face
      4,
      9,
      5,
      4,
      5,
      0, // left
      4,
      3,
      8,
      4,
      8,
      9, // right
      // Sides
      0,
      5,
      1,
      1,
      5,
      6, // left outer
      1,
      6,
      2,
      2,
      6,
      7, // left inner
      2,
      7,
      3,
      3,
      7,
      8, // right inner
      3,
      8,
      4,
      4,
      8,
      9, // right outer
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
