import {Texture} from 'three';
import {USDZExporter} from 'three/examples/jsm/exporters/USDZExporter.js';
import {decompress} from 'three/examples/jsm/utils/WebGLTextureUtils.js';

import ModelViewerElementBase from '../model-viewer-base.js';
import {Constructor} from '../utilities.js';

import {$configureUSDZExporter} from './ar.js';

export const LDARMixin = <T extends Constructor<ModelViewerElementBase>>(
    ModelViewerElement: T): T => {
  class LDARModelViewerElement extends ModelViewerElement {
    [$configureUSDZExporter](exporter: USDZExporter, maxTextureSize: number) {
      (exporter as any).setTextureUtils({
        decompress: (texture: Texture) => decompress(texture, maxTextureSize),
      });
    }
  }

  return LDARModelViewerElement;
};
