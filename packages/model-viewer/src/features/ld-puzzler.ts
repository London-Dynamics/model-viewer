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
  }

  return LDPuzzlerModelViewerElement;
};
