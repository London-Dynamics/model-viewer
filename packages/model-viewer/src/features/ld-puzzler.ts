declare global {
  interface Window {
    deDraco: any;
  }
}

import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

import ModelViewerElementBase from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';
import {createSafeObjectUrlFromArrayBuffer} from '../utilities/create_object_url.js';


export declare interface LDPuzzlerInterface {
  setSrcFromBuffer(buffer: ArrayBuffer): void;
}

export const LDPuzzlerMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDPuzzlerInterface> & T => {
  class LDPuzzlerModelViewerElement extends ModelViewerElement {
    async setSrcFromBuffer(buffer: ArrayBuffer) {
      try {
        const safeObjectUrl = createSafeObjectUrlFromArrayBuffer(buffer);

        this.setAttribute('src', safeObjectUrl.url);
      } catch(e) {
        console.error(e);
      }
    }

    /* Remove draco compression from a glb
    *
    * @param {ArrayBuffer} inputBuffer GLB with draco
    * @return {Promise<ArrayBuffer>} GLB without draco
    */
    deDraco(inputBuffer:ArrayBuffer) {
      return new Promise((res) => {
        const loader = new GLTFLoader()
        const dracoLoader = new DRACOLoader()
        dracoLoader.setDecoderPath(
          'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/',
        )
        loader.setDRACOLoader(dracoLoader)

        loader.parse(
          inputBuffer,
          '',
          (model) => {
            if (model.scene) {
              model.scene.traverse((node) => {
                if (node.children.length === 0 && (!node.name || node.name.length === 0)) {
                  node.name = node.parent?.name ?? ''
                }
              })
              const exporter = new GLTFExporter()
              exporter.parse(
                model.scene,
                (arrayBuffer) => {
                  res(arrayBuffer)
                },
                function (err) {
                  console.error(err)
                },
                { binary: true },
              )
            } else {
              res(inputBuffer)
            }
          },
          (error) => {
            console.error(error)
          },
        )
      })
    }

    connectedCallback() {
      super.connectedCallback();

      if (typeof window !== 'undefined') {
        window.deDraco = this.deDraco;
      }
    }
  }


  return LDPuzzlerModelViewerElement;
};
