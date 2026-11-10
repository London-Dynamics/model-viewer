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

import {Material, MeshPhysicalMaterial, MeshStandardMaterial} from 'three';

/**
 * Scene-graph materials are MeshPhysicalMaterial so clearcoat, sheen and
 * transmission setters work. Extension materials already are. A plain glTF
 * material comes back as MeshStandardMaterial; copy its standard fields onto
 * a physical material and drop the unused program. Textures stay shared.
 */
export function ensurePhysicalMaterial(material: Material):
    MeshPhysicalMaterial {
  if ((material as MeshPhysicalMaterial).isMeshPhysicalMaterial === true) {
    return material as MeshPhysicalMaterial;
  }
  const physical = new MeshPhysicalMaterial();
  MeshStandardMaterial.prototype.copy.call(physical, material);
  physical.name = material.name;
  material.dispose();
  return physical;
}
