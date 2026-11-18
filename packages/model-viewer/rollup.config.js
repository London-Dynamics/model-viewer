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

/**
 * Code-splitting leaves a tiny entry facade plus the real bundle in a
 * sibling chunk, and names the USD parser chunk after USDLoader. Rename
 * those to stable files the package publishes:
 *   <entry>            public exports
 *   <entry>-lib.js     model-viewer and three (loaded with the entry)
 *   <entry>-usdz.js    USD parsers (loaded on first conversion)
 */
const finalizeChunks = () => ({
  name: 'finalize-model-viewer-chunks',
  generateBundle(_options, bundle) {
    const chunks = Object.values(bundle).filter((file) => file.type === 'chunk');
    const renames = [];
    for (const chunk of chunks) {
      let next = chunk.fileName;
      if (next.includes('USDLoader')) {
        next = next.replace(/USDLoader\.js$/, 'usdz.js');
      } else if (/-model-viewer(?:-module)?\.js$/.test(next)) {
        next = next.replace(/-model-viewer(?:-module)?\.js$/, '-lib.js');
      }
      if (next !== chunk.fileName) {
        renames.push([chunk.fileName, next]);
      }
    }
    if (renames.length === 0) {
      return;
    }
    for (const chunk of chunks) {
      for (const [from, to] of renames) {
        chunk.code = chunk.code.replaceAll(`./${from}`, `./${to}`);
        chunk.code = chunk.code.replaceAll(
            `sourceMappingURL=${from}.map`,
            `sourceMappingURL=${to}.map`);
      }
    }
    for (const [from, to] of renames) {
      const chunk = bundle[from];
      chunk.fileName = to;
      delete bundle[from];
      bundle[to] = chunk;
      const map = bundle[`${from}.map`];
      if (map) {
        map.fileName = `${to}.map`;
        delete bundle[`${from}.map`];
        bundle[`${to}.map`] = map;
      }
    }
  },
});

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

      const entryFileNames = file.split('/').pop();
      const chunkPrefix = entryFileNames.replace(/\.js$/, '');
      // UMD cannot emit a lazy chunk. The ESM bundles keep USDLoader out of
      // the entry and load it from model-viewer[-module]-usdz.js on demand.
      const codeSplit = format !== 'umd';

      return {
        input: './lib/model-viewer.js',
        output: {
          dir: './dist',
          format,
          sourcemap: true,
          name: 'ModelViewerElement',
          entryFileNames,
          chunkFileNames: `${chunkPrefix}-[name].js`,
          inlineDynamicImports: !codeSplit,
          globals
        },
        external,
        watch: {include: watchFiles},
        plugins: [...plugins, finalizeChunks()],
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
