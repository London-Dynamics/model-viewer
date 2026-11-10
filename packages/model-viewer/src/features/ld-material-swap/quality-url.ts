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

/**
 * Puzzle's qualityPickAsset names a quality file by inserting `@<quality>`
 * before the extension: `paint.glb` -> `paint@mobile.glb`. Query and hash are
 * kept. A path with no extension gets the suffix appended.
 */
export function qualityFileUrl(url: string, quality: string): string {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const withoutHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const queryAt = withoutHash.indexOf('?');
  const query = queryAt >= 0 ? withoutHash.slice(queryAt) : '';
  const path = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const dot = path.lastIndexOf('.');
  const stamped = dot > slash ?
      path.slice(0, dot) + '@' + quality + path.slice(dot) :
      path + '@' + quality;
  return stamped + query + hash;
}
