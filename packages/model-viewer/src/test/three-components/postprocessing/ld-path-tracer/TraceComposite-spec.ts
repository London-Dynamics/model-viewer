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

import {expect} from 'chai';
import {BoxGeometry, Mesh, MeshPhysicalMaterial, MeshStandardMaterial} from 'three';

import {isSemiTransparent, parseRoles, parseSamplesMode, parseShadowQuality, parseTraceMode, parseTraceView, roleOf} from '../../../../three-components/postprocessing/ld-path-tracer/progressive/trace-composite.js';

const mesh = (name: string, material: MeshStandardMaterial) => {
  const result = new Mesh(new BoxGeometry(), material);
  result.name = name;
  return result;
};

suite('TraceComposite', () => {
  test('parses modes, views, shadow quality and samples mode', () => {
    expect(parseTraceMode('shadows')).to.equal('shadows');
    expect(parseTraceMode('ground')).to.equal('ground');
    expect(parseTraceMode('nope')).to.equal('full');
    expect(parseTraceView('trace')).to.equal('trace');
    expect(parseTraceView('x')).to.equal('composite');
    expect(parseShadowQuality('fast')).to.equal('fast');
    expect(parseShadowQuality('')).to.equal('normal');
    expect(parseSamplesMode('adaptive')).to.equal('adaptive');
    expect(parseSamplesMode(undefined)).to.equal('fixed');
  });

  test('semi-transparent matches transmission, opacity and blending', () => {
    expect(isSemiTransparent(new MeshPhysicalMaterial({transmission: 1})))
        .to.equal(true);
    expect(isSemiTransparent(new MeshStandardMaterial({opacity: 0.5})))
        .to.equal(true);
    expect(isSemiTransparent(new MeshStandardMaterial({transparent: true})))
        .to.equal(true);
    expect(isSemiTransparent(new MeshStandardMaterial())).to.equal(false);
  });

  test('exclude tokens and material roles resolve per mesh, last wins', () => {
    const glass = mesh('Windscreen', new MeshPhysicalMaterial({name: 'Glass', transmission: 1}));
    const tyre = mesh('Tyre_FL', new MeshStandardMaterial({name: 'Rubber'}));
    const floor = mesh('Floor', new MeshStandardMaterial({name: 'Floor_mat'}));
    const body = mesh('Body', new MeshStandardMaterial({name: 'Paint'}));
    const rules = parseRoles(
        'semi-transparent',
        'mesh:Tyre*: no-receive; material:floor_*: receive-only; Body: trace');
    expect(roleOf(glass, rules)).to.equal('exclude');
    expect(roleOf(tyre, rules)).to.equal('no-receive');
    expect(roleOf(floor, rules)).to.equal('receive-only');
    expect(roleOf(body, rules)).to.equal('trace');
    // A later role overrides the exclude list.
    expect(roleOf(glass, parseRoles('semi-transparent', 'Glass: trace')))
        .to.equal('trace');
    // mesh: and material: prefixes narrow the match.
    expect(roleOf(tyre, parseRoles('material:Tyre*', ''))).to.equal('trace');
    expect(roleOf(tyre, parseRoles('mesh:tyre_*', ''))).to.equal('exclude');
    // no-cast is an alias of receive-only; unknown roles are ignored.
    expect(roleOf(body, parseRoles('', 'Body: no-cast'))).to.equal('receive-only');
    expect(roleOf(body, parseRoles('', 'Body: sparkle'))).to.equal('trace');
  });
});
