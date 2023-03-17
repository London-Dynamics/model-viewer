import { Object3D } from 'three';
import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
} from '../model-viewer-base.js';
import { Constructor, debounce } from '../utilities.js';

export declare interface PuzzlerInterface {
  updateMeshPosition(name: string, position: [number, number, number]): void;
  updateMeshRotation(name: string, rotation: [number, number, number]): void;
  updateMeshScale(name: string, scale: [number, number, number]): void;
  updateObjectPosition(name: string, position: [number, number, number]): void;
  updateObjectRotation(name: string, rotation: [number, number, number]): void;
  updateObjectScale(name: string, scale: [number, number, number]): void;
  getSceneMeshes(): Array<string>;
  getSceneObjects(): Array<string>;
}

const $meshRoot = Symbol('meshRoot');
const $meshes = Symbol('meshes');
const $objects = Symbol('objects');

export const PuzzlerMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<PuzzlerInterface> & T => {
  class PuzzlerModelViewerElement extends ModelViewerElement {
    private [$meshRoot] = new Object3D();
    private [$meshes] = new Map<string, Object3D>();
    private [$objects] = new Map<string, Object3D>();

    private _prepareScene() {
      this[$scene].updateShadow();
      this[$scene].queueRender();
      this._updateSceneDebounced();
    }

    private _updateSceneDebounced = debounce(async () => {
      this[$scene].updateBoundingBox();
      this[$scene].updateShadow();
      await this[$scene].updateFraming();
      this[$scene].queueRender();
    }, 300);

    private _updateNodePosition(
      node: Object3D | undefined,
      value: [number, number, number]
    ) {
      if (node) {
        node.position.set(...value);
        this._prepareScene();
      }
    }

    private _updateNodeRotation(
      node: Object3D | undefined,
      value: [number, number, number]
    ) {
      if (node) {
        node.rotation.set(...value);
        this._prepareScene();
      }
    }

    private _updateNodeScale(
      node: Object3D | undefined,
      value: [number, number, number]
    ) {
      if (node) {
        node.scale.set(...value);
        this._prepareScene();
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

    updateMeshRotation(name: string, rotation: [number, number, number]) {
      const node = this[$meshes].get(name);
      this._updateNodeRotation(node, rotation);
    }

    updateMeshScale(name: string, scale: [number, number, number]) {
      const node = this[$meshes].get(name);
      this._updateNodeScale(node, scale);
    }

    updateObjectPosition(name: string, position: [number, number, number]) {
      const node = this[$objects].get(name);
      this._updateNodePosition(node, position);
    }

    updateObjectRotation(name: string, rotation: [number, number, number]) {
      const node = this[$objects].get(name);
      this._updateNodeRotation(node, rotation);
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

    [$onModelLoad]() {
      super[$onModelLoad]();

      const { currentGLTF } = this[$scene];

      if (currentGLTF != null) {
        const scene = this[$scene];

        this[$meshes].clear();
        this[$objects].clear();

        scene.traverse((node) => {
          if (node.type === 'Group' && node.name === 'Scene') {
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

  return PuzzlerModelViewerElement;
};
