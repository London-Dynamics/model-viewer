import { Object3D } from 'three';
import ModelViewerElementBase, {
  $scene,
  $onModelLoad,
} from '../model-viewer-base.js';
import { Constructor, debounce } from '../utilities.js';

export declare interface PuzzlerInterface {
  updateNodePosition(name: string, position: [number, number, number]): void;
  updateNodeRotation(name: string, rotation: [number, number, number]): void;
}

const $meshes = Symbol('meshes');

export const PuzzlerMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<PuzzlerInterface> & T => {
  class PuzzlerModelViewerElement extends ModelViewerElement {
    private [$meshes] = new Map<string, Object3D>();

    private _updateNodePositionDebounced = debounce(async () => {
      this[$scene].updateBoundingBox();
      this[$scene].updateShadow();
      await this[$scene].updateFraming();
      this[$scene].queueRender();
    }, 300);

    updateNodePosition(name: string, position: [number, number, number]) {
      const node = this[$meshes].get(name);
      if (node) {
        node.position.set(...position);
        this[$scene].updateShadow();
        this[$scene].queueRender();
        this._updateNodePositionDebounced();
      }
    }

    updateNodeRotation(name: string, rotation: [number, number, number]) {
      const node = this[$meshes].get(name);
      if (node) {
        node.rotation.set(...rotation);
        this[$scene].updateShadow();
        this[$scene].queueRender();
        this._updateNodePositionDebounced();
      }
    }

    updateNodeScale(name: string, scale: [number, number, number]) {
      const node = this[$meshes].get(name);
      if (node) {
        node.scale.set(...scale);
        this[$scene].updateShadow();
        this[$scene].queueRender();
        this._updateNodePositionDebounced();
      }
    }

    [$onModelLoad]() {
      super[$onModelLoad]();

      const { currentGLTF } = this[$scene];

      if (currentGLTF != null) {
        const scene = this[$scene];

        this[$meshes].clear();

        scene.traverse((node) => {
          if (node.type === 'Mesh' && node.name.length) {
            this[$meshes].set(node.name, node);
          }
        });
      }
    }
  }

  return PuzzlerModelViewerElement;
};
