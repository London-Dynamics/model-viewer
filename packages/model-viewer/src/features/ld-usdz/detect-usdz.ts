/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
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

/** Official USDZ MIME type (AOUSD / IANA). */
export const USDZ_CONTENT_TYPE = 'model/vnd.usdz+zip';

const SKIP_CONTENT_TYPE_PROBE = new Set(['glb', 'gltf']);

/**
 * File extension of a URL, ignoring query and hash. `data:` URLs have none.
 */
export const urlExtension = (url: string): string => {
  if (url.startsWith('data:')) {
    return '';
  }
  const path = url.split('#')[0].split('?')[0];
  const slash = path.lastIndexOf('/');
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    return '';
  }
  return base.slice(dot + 1).toLowerCase();
};

export const isUsdzContentType = (header: string|null): boolean => {
  if (header == null) {
    return false;
  }
  const mime = header.split(';')[0].trim().toLowerCase();
  return mime === USDZ_CONTENT_TYPE || mime === 'model/vnd.usdz';
};

const fetchCredentials = (withCredentials: boolean): RequestCredentials =>
    withCredentials ? 'include' : 'same-origin';

/**
 * True when `src` should be converted before the glTF loader sees it.
 * `.usdz` is enough. Other URLs are probed with HEAD, except `.glb` / `.gltf`,
 * which stay on the normal path. `ios-src` is never passed here.
 */
export const sourceNeedsUsdzConversion =
    async(url: string, withCredentials: boolean): Promise<boolean> => {
  if (url.startsWith('data:')) {
    const mime = url.slice('data:'.length).split(/[;,]/)[0];
    return isUsdzContentType(mime);
  }

  const extension = urlExtension(url);
  if (extension === 'usdz') {
    return true;
  }
  if (SKIP_CONTENT_TYPE_PROBE.has(extension)) {
    return false;
  }

  // Blob URLs have no filename. HEAD on a blob URL does not report the
  // Blob's type in every browser, so read it with GET. The body is local.
  try {
    const response = await fetch(url, {
      method: url.startsWith('blob:') ? 'GET' : 'HEAD',
      credentials: fetchCredentials(withCredentials),
    });
    return isUsdzContentType(response.headers.get('content-type'));
  } catch {
    return false;
  }
};

export const fetchModelBytes =
    async(url: string, withCredentials: boolean): Promise<ArrayBuffer> => {
  const response = await fetch(url, {
    credentials: fetchCredentials(withCredentials),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch USDZ (${response.status}${
        response.statusText ? ` ${response.statusText}` : ''})`);
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error('USDZ file is empty');
  }
  return buffer;
};
