/**
 * Bundle three-mesh-bvh's generateMeshBVH worker into a classic script with
 * no bare imports. The same file is written beside the tsc output (so
 * `new URL('path-tracer-bvh.worker.js', import.meta.url)` resolves in tests
 * and from lib/) and into dist/ (beside the rollup bundles).
 */
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {nodeResolve} from '@rollup/plugin-node-resolve';
import {rollup} from 'rollup';

const packageRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '../..');
const input = path.join(
    repoRoot, 'node_modules/three-mesh-bvh/src/workers/generateMeshBVH.worker.js');
const outputs = [
  path.join(
      packageRoot,
      'lib/three-components/postprocessing/ld-path-tracer/path-tracer-bvh.worker.js'),
  path.join(packageRoot, 'dist/path-tracer-bvh.worker.js'),
];

const bundle = await rollup({
  input,
  plugins: [nodeResolve({dedupe: ['three']})],
  onwarn(warning, warn) {
    if (warning.code === 'CIRCULAR_DEPENDENCY') {
      return;
    }
    warn(warning);
  },
});

const {output} = await bundle.generate({
  format: 'iife',
  inlineDynamicImports: true,
});
await bundle.close();

const code = output.map((chunk) => chunk.code).join('\n');
await Promise.all(outputs.map(async (file) => {
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, code);
  console.log(
      `path-tracer BVH worker ${(code.length / 1024).toFixed(0)}KB -> ${file}`);
}));
