import { EulerOrder, Object3D } from 'three';
import ModelViewerElementBase, {
  $scene,
  $needsRender,
  $onModelLoad,
} from '../model-viewer-base.js';
import { Constructor, throttle } from '../utilities.js';

export declare interface LDTransformsInterface {
  updateMeshPosition(name: string, position: [number, number, number]): void;
  updateMeshRotation(
    name: string,
    rotation: [number, number, number],
    order?: EulerOrder
  ): void;
  updateMeshScale(name: string, scale: [number, number, number]): void;

  updateObjectPosition(name: string, position: [number, number, number]): void;
  updateObjectRotation(
    name: string,
    rotation: [number, number, number],
    order?: EulerOrder
  ): void;
  updateObjectScale(name: string, scale: [number, number, number]): void;

  updateScenePosition(position: [number, number, number]): void;
  updateSceneRotation(rotation: [number, number, number]): void;
  updateSceneScale(scale: [number, number, number]): void;

  getSceneRotation(): number[];

  getSceneMeshes(): Array<string>;
  getSceneObjects(): Array<string>;
}

const $meshRoot = Symbol('meshRoot');
const $meshes = Symbol('meshes');
const $objects = Symbol('objects');

export const $updateFramingThrottled = Symbol('updateFramingThrottled');

export const LDTransformsMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDTransformsInterface> & T => {
  class TransformerModelViewerElement extends ModelViewerElement {
    private [$meshRoot] = new Object3D();
    private [$meshes] = new Map<string, Object3D>();
    private [$objects] = new Map<string, Object3D>();

    private [$updateFramingThrottled] = throttle(async () => {
      await this[$scene].updateFraming();
      this[$needsRender]();
    }, 400);

    private _updateNodePosition(
      node: Object3D | undefined,
      value: [number, number, number]
    ) {
      if (node) {
        node.position.set(...value);
        this[$scene].updateBoundingBox();
        this[$scene].updateShadow();
        this[$needsRender]();
        this[$updateFramingThrottled]();
      }
    }

    private _updateNodeRotation(
      node: Object3D | undefined,
      value: [number, number, number],
      order: EulerOrder = 'XYZ'
    ) {
      if (node) {
        node.rotation.set(...value, order);
        this[$scene].updateBoundingBox();
        this[$scene].updateShadow();
        this[$needsRender]();
        this[$updateFramingThrottled]();
      }
    }

    private _updateNodeScale(
      node: Object3D | undefined,
      value: [number, number, number]
    ) {
      if (node) {
        node.scale.set(...value);
        this[$scene].updateBoundingBox();
        this[$scene].updateShadow();
        this[$needsRender]();
        this[$updateFramingThrottled]();
      }
    }

    getSceneMeshes() {
      return [...this[$meshes].keys()];
    }
    getSceneObjects() {
      return [...this[$objects].keys()];
    }

    updateMeshPosition(name: string, position: [number, number, number]) {
      const node = this[$meshes].get(name);
      this._updateNodePosition(node, position);
    }

    updateMeshRotation(
      name: string,
      rotation: [number, number, number],
      order?: EulerOrder
    ) {
      const node = this[$meshes].get(name);
      this._updateNodeRotation(node, rotation, order);
    }

    updateMeshScale(name: string, scale: [number, number, number]) {
      const node = this[$meshes].get(name);
      this._updateNodeScale(node, scale);
    }

    updateObjectPosition(name: string, position: [number, number, number]) {
      const node = this[$objects].get(name);
      this._updateNodePosition(node, position);
    }

    updateObjectRotation(
      name: string,
      rotation: [number, number, number],
      order?: EulerOrder
    ) {
      const node = this[$objects].get(name);
      this._updateNodeRotation(node, rotation, order);
    }

    updateObjectScale(name: string, scale: [number, number, number]) {
      const node = this[$objects].get(name);
      this._updateNodeScale(node, scale);
    }

    updateScenePosition(position: [number, number, number]) {
      const node = this[$meshRoot];
      this._updateNodePosition(node, position);
    }

    updateSceneRotation(rotation: [number, number, number]) {
      const node = this[$meshRoot];
      this._updateNodeRotation(node, rotation);
    }

    updateSceneScale(scale: [number, number, number]) {
      const node = this[$meshRoot];
      this._updateNodeScale(node, scale);
    }

    getSceneRotation() {
      const rotation = this[$meshRoot]?.rotation
        ?.toArray()
        .map((v) => +(v || 0)) || [0, 0, 0];

      return rotation.slice(0, 3);
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      const { currentGLTF } = this[$scene];

      if (currentGLTF != null) {
        const scene = this[$scene];

        this[$meshes].clear();
        this[$objects].clear();

        scene.traverse((node) => {
          if (!node.parent) {
            this[$meshRoot] = node;
          }
          if (node.type === 'Mesh' && node.name.length) {
            this[$meshes].set(node.name, node);
          }
          if (node.type === 'Object3D' && node.name.length) {
            this[$objects].set(node.name, node);
          }
        });
      }
    }
  }

  return TransformerModelViewerElement;
};
