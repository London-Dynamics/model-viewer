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

    // Each face gets its own 4 unique vertices for flat shading
    const vertices = new Float32Array([
      // Front face (z = +d/2)
      -w / 2,
      h / 2,
      d / 2, // 0 top-left-front
      w / 2,
      h / 2,
      d / 2, // 1 top-right-front
      -w / 2,
      -h / 2,
      d / 2, // 2 bottom-left-front
      w / 2,
      -h / 2,
      d / 2, // 3 bottom-right-front
      // Right face (x = +w/2)
      w / 2,
      h / 2,
      d / 2, // 4 top-left-front (same as 1)
      w / 2,
      h / 2,
      -d / 2, // 5 top-right-back
      w / 2,
      -h / 2,
      d / 2, // 6 bottom-left-front (same as 3)
      w / 2,
      -h / 2,
      -d / 2, // 7 bottom-right-back
      // Back face (z = -d/2)
      w / 2,
      h / 2,
      -d / 2, // 8 top-right-back (same as 5)
      -w / 2,
      h / 2,
      -d / 2, // 9 top-left-back
      w / 2,
      -h / 2,
      -d / 2, //10 bottom-right-back (same as 7)
      -w / 2,
      -h / 2,
      -d / 2, //11 bottom-left-back
      // Left face (x = -w/2)
      -w / 2,
      h / 2,
      -d / 2, //12 top-left-back (same as 9)
      -w / 2,
      h / 2,
      d / 2, //13 top-left-front (same as 0)
      -w / 2,
      -h / 2,
      -d / 2, //14 bottom-left-back (same as 11)
      -w / 2,
      -h / 2,
      d / 2, //15 bottom-left-front (same as 2)
      // Top face (y = +h/2)
      -w / 2,
      h / 2,
      -d / 2, //16 top-left-back (same as 9)
      w / 2,
      h / 2,
      -d / 2, //17 top-right-back (same as 5)
      -w / 2,
      h / 2,
      d / 2, //18 top-left-front (same as 0)
      w / 2,
      h / 2,
      d / 2, //19 top-right-front (same as 1)
    ]);

    const indices = [
      // Front face (CCW)
      0, 2, 1, 1, 2, 3,
      // Right face (CCW)
      4, 6, 5, 5, 6, 7,
      // Back face (CCW)
      8, 10, 9, 9, 10, 11,
      // Left face (CCW)
      12, 14, 13, 13, 14, 15,
      // Top face (CCW)
      16, 18, 17, 17, 18, 19,
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

    // Unique vertices for each face for flat shading (no split top)
    const vertices = new Float32Array([
      // Top face (y = 0)
      -w / 2,
      0,
      d / 2, // 0: left front
      w / 2,
      0,
      d / 2, // 1: right front
      w / 2,
      0,
      -d / 2, // 2: right back
      -w / 2,
      0,
      -d / 2, // 3: left back
      // Bottom face (y = -h)
      0,
      -h,
      d / 2, // 4: front bottom
      0,
      -h,
      -d / 2, // 5: back bottom
      // Left face (x = -w/2)
      -w / 2,
      0,
      d / 2, // 6: top front
      -w / 2,
      0,
      -d / 2, // 7: top back
      0,
      -h,
      d / 2, // 8: bottom front
      0,
      -h,
      -d / 2, // 9: bottom back
      // Right face (x = +w/2)
      w / 2,
      0,
      d / 2, //10: top front
      w / 2,
      0,
      -d / 2, //11: top back
      0,
      -h,
      d / 2, //12: bottom front
      0,
      -h,
      -d / 2, //13: bottom back
      // Front face (z = +d/2)
      -w / 2,
      0,
      d / 2, //14: top left
      w / 2,
      0,
      d / 2, //15: top right
      0,
      -h,
      d / 2, //16: bottom
      // Back face (z = -d/2)
      -w / 2,
      0,
      -d / 2, //17: top left
      w / 2,
      0,
      -d / 2, //18: top right
      0,
      -h,
      -d / 2, //19: bottom
    ]);

    const indices = [
      // Top face (CCW)
      0, 1, 2, 0, 2, 3,
      // Bottom face (CCW)
      4, 5, 9, 4, 9, 8,
      // Left face (CCW, fix winding)
      6, 7, 8, 7, 9, 8,
      // Right face (CCW, fix winding)
      10, 12, 11, 11, 12, 13,
      // Front face (CCW)
      14, 16, 15,
      // Back face (CCW)
      17, 18, 19,
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
