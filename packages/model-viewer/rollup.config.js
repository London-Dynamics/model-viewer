/*
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import commonjs from '@rollup/plugin-commonjs';
import {nodeResolve as resolve} from '@rollup/plugin-node-resolve';
import replace from '@rollup/plugin-replace';
import swc from '@rollup/plugin-swc';
import cleanup from 'rollup-plugin-cleanup';
import dts from 'rollup-plugin-dts';

const {NODE_ENV, MV_BUILD} = process.env;

const onwarn = (warning, warn) => {
  // Suppress non-actionable warnings caused by TypeScript boilerplate /
  // established feature mixin cycles:
  if (warning.code === 'THIS_IS_UNDEFINED' ||
      warning.code === 'CIRCULAR_DEPENDENCY') {
    return;
  }
  warn(warning);
};

let commonPlugins = [
  resolve({dedupe: 'three'}),
  replace({'Reflect.decorate': 'undefined', preventAssignment: true})
];

const watchFiles = ['lib/**'];

const createModelViewerOutput =
    (file, format, plugins = commonPlugins, external = []) => {
      const globals = external.reduce((acc, mod) => {
        acc[mod] =
            mod;  // Assuming global variable names are the same as module names
        return acc;
      }, {});

      return {
        input: './lib/model-viewer.js',
        output: {
          file,
          format,
          sourcemap: true,
          name: 'ModelViewerElement',
          globals
        },
        external,
        watch: {include: watchFiles},
        plugins,
        onwarn
      };
    };

const pluginsIE11 = [
  ...commonPlugins,
  commonjs(),
  swc(),
  cleanup({
    // Ideally we'd also clean third_party/three, which saves
    // ~45kb in filesize alone... but takes 2 minutes to build
    include: ['lib/**'],
    comments: 'none',
  }),
];

const builds = {
  esm: createModelViewerOutput('./dist/model-viewer.js', 'esm'),
  'esm-module': createModelViewerOutput(
      './dist/model-viewer-module.js', 'esm', commonPlugins, ['three']),
  umd: createModelViewerOutput('./dist/model-viewer-umd.js', 'umd', pluginsIE11),
  'umd-module': createModelViewerOutput(
      './dist/model-viewer-module-umd.js', 'umd', pluginsIE11, ['three']),
  dts: {
    input: './lib/model-viewer.d.ts',
    output: {
      file: './dist/model-viewer.d.ts',
      format: 'esm',
      name: 'ModelViewerElement',
    },
    plugins: [dts()],
    onwarn,
  },
};

let outputOptions;

if (NODE_ENV === 'development') {
  outputOptions = [builds.esm, builds['esm-module']];
} else if (MV_BUILD) {
  if (!builds[MV_BUILD]) {
    throw new Error(
        `Unknown MV_BUILD="${MV_BUILD}". Expected one of: ${
            Object.keys(builds).join(', ')}`);
  }
  outputOptions = [builds[MV_BUILD]];
} else {
  // Full production (e.g. watch:rollup): all non-minified JS + dts.
  // Minified artifacts are produced by scripts/minify-dist.mjs.
  outputOptions = [
    builds.esm,
    builds['esm-module'],
    builds.umd,
    builds['umd-module'],
    builds.dts,
  ];
}

export default outputOptions;
