import { property } from 'lit/decorators.js';

import ModelViewerElementBase from '../model-viewer-base.js';

import { Constructor } from '../utilities.js';

export declare interface LDDebugInterface {
  debug: boolean;
}

export const LDDebugMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDDebugInterface> & T => {
  class LDDebugModelViewerElement extends ModelViewerElement {
    @property({ type: Boolean, attribute: 'debug' })
    debug: boolean = false;

    log(...args: any[]) {
      if (this.debug) {
        console.log(...args);
      }
    }

    warn(...args: any[]) {
      if (this.debug) {
        console.warn(...args);
      }
    }

    error(...args: any[]) {
      if (this.debug) {
        console.error(...args);
      }
    }

    updated(changedProperties: Map<string | number | symbol, unknown>) {
      super.updated(changedProperties);
      if (changedProperties.has('debug')) {
        const oldValue = changedProperties.get('debug');
        if (this.debug && !oldValue) {
          console.info('Debug Mode enabled');
        } else if (!this.debug && oldValue) {
          console.info('Debug Mode disabled');
        }
      }
    }
  }
  return LDDebugModelViewerElement;
};
