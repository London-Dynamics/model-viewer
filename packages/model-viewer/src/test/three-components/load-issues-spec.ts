/* @license
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

import {expect} from 'chai';

import {classifyLoadError, collectLoadIssues, ModelLoadError, toModelLoadError} from '../../three-components/load-issues.js';

const glbHeader = (version: number, declaredLength: number, byteLength = 12) => {
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, version, true);
  view.setUint32(8, declaredLength, true);
  return buffer;
};

const codes = (issues: {code: string}[]) => issues.map((issue) => issue.code);

suite('load-issues', () => {
  suite('collectLoadIssues', () => {
    test('reports an empty buffer', () => {
      expect(codes(collectLoadIssues(
                 {data: new ArrayBuffer(0), hasMeshoptDecoder: false})))
          .to.deep.equal(['empty-response']);
    });

    test('reports a bad magic number', () => {
      const data = new TextEncoder().encode('not a glb at all').buffer;
      expect(codes(collectLoadIssues({data, hasMeshoptDecoder: false})))
          .to.deep.equal(['invalid-glb-header']);
    });

    test('reports several issues at once', () => {
      const data = glbHeader(1, 1000);
      expect(codes(collectLoadIssues({data, hasMeshoptDecoder: false})))
          .to.deep.equal(['invalid-glb-header', 'truncated-file']);
    });

    test('accepts a valid GLB header', () => {
      const data = glbHeader(2, 12);
      expect(collectLoadIssues({data, hasMeshoptDecoder: false})).to.be.empty;
    });

    test('reports required extensions that cannot be decoded', () => {
      const data = JSON.stringify({
        asset: {version: '2.0'},
        extensionsRequired: ['EXT_meshopt_compression', 'VENDOR_unknown'],
      });
      expect(codes(collectLoadIssues({data, hasMeshoptDecoder: false})))
          .to.deep.equal(['missing-decoder', 'unsupported-extension']);
      expect(codes(collectLoadIssues({data, hasMeshoptDecoder: true})))
          .to.deep.equal(['unsupported-extension']);
    });
  });

  suite('classifyLoadError', () => {
    test('maps HTTP errors', () => {
      const error = Object.assign(new Error('fetch failed'), {
        response: {status: 404, url: 'https://example.com/a.glb'},
      });
      const [issue] = classifyLoadError(error);
      expect(issue.code).to.equal('http-error');
      expect(issue.details?.status).to.equal(404);
    });

    test('maps a missing scene', () => {
      expect(codes(classifyLoadError(new Error('Model does not have a scene'))))
          .to.deep.equal(['no-scene']);
    });

    test('falls back to parse-error for unknown errors', () => {
      const issues = classifyLoadError(new RangeError('boom'));
      expect(codes(issues)).to.deep.equal(['parse-error']);
      expect(issues[0].message).to.equal('boom');
    });

    test('keeps issues from an existing ModelLoadError', () => {
      const original = new ModelLoadError([
        {code: 'empty-response', severity: 'error', message: 'empty'},
      ]);
      expect(toModelLoadError(original)).to.equal(original);
    });
  });
});
