/* @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { AnimationMixin } from './features/animation.js';
import { AnnotationMixin } from './features/annotation.js';
import { ARMixin } from './features/ar.js';
import { EnvironmentMixin } from './features/environment.js';
import { LoadingMixin } from './features/loading.js';
import { SceneGraphMixin } from './features/scene-graph.js';
import { StagingMixin } from './features/staging.js';

import { LDAnimationMixin } from './features/ld-animation.js';
import { LDBloomMixin } from './features/ld-bloom.js';
import { LDControlsMixin } from './features/ld-controls/index.js';
import { LDDebugMixin } from './features/ld-debug.js';
import { LDEnvironmentMixin } from './features/ld-environment/index.js';
import { LDCameraMixin } from './features/ld-camera.js';
import { LDImageCaptureMixin } from './features/ld-image-capture.js';
import { LDFloatingControlStripMixin } from './features/ld-floating-control-strip.js';
import { LDLightsMixin } from './features/ld-lights.js';
import { LDMaterialManagerMixin } from './features/ld-material-manager.js';
import { LDMeasureMixin } from './features/ld-measure/index.js';
import { LDModularMixin } from './features/ld-modular/index.js';
import { LDSelectionMixin } from './features/ld-selection/index.js';

// Import custom effects to register them
import './features/ld-selection/selection-outline-effect.js';

import ModelViewerElementBase from './model-viewer-base.js';

// Export these to allow lazy-loaded LottieLoader.js to find what it needs.
// Requires an import map - "three": "path/to/model-viewer.min.js".
export { CanvasTexture, FileLoader, Loader, NearestFilter } from 'three';

const ModelViewerElementImpl = LDMaterialManagerMixin(
  LDFloatingControlStripMixin(
    LDMeasureMixin(
      LDBloomMixin(
        LDModularMixin(
          LDSelectionMixin(
            LDLightsMixin(
              LDImageCaptureMixin(
                LDCameraMixin(
                  LDEnvironmentMixin(
                    LDAnimationMixin(
                      LDDebugMixin(
                        AnnotationMixin(
                          SceneGraphMixin(
                            StagingMixin(
                              EnvironmentMixin(
                                LDControlsMixin(
                                  ARMixin(
                                    LoadingMixin(
                                      AnimationMixin(ModelViewerElementBase)
                                    )
                                  )
                                )
                              )
                            )
                          )
                        )
                      )
                    )
                    )
                  )
                )
              )
            )
          )
        )
      )
    )
  )
);

export const ModelViewerElement = ModelViewerElementImpl;
export type ModelViewerElement = InstanceType<typeof ModelViewerElementImpl>;

export type { RGB, RGBA } from './three-components/gltf-instance/gltf-2.0';

customElements.define('model-viewer', ModelViewerElement);

declare global {
  interface HTMLElementTagNameMap {
    'model-viewer': ModelViewerElement;
  }
}
