/*
 * Copyright 2026 London Dynamics. All Rights Reserved.
 * Minify non-minified Rollup outputs into the published *.min.js artifacts.
 */

import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {minify} from 'terser';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const targets = [
  {name: 'model-viewer.js', module: true},
  {name: 'model-viewer-module.js', module: true},
  {name: 'model-viewer-umd.js', module: false},
  {name: 'model-viewer-module-umd.js', module: false},
];

async function minifyFile({name, module}) {
  const inputPath = join(distDir, name);
  const outName = name.replace(/\.js$/, '.min.js');
  const outPath = join(distDir, outName);
  const mapPath = `${outPath}.map`;

  const code = await readFile(inputPath, 'utf8');
  const result = await minify(code, {
    module,
    sourceMap: {
      filename: outName,
      url: `${outName}.map`,
    },
  });

  if (!result.code) {
    throw new Error(`terser produced empty output for ${name}`);
  }

  await writeFile(outPath, result.code);
  if (result.map) {
    await writeFile(
        mapPath, typeof result.map === 'string' ? result.map : JSON.stringify(result.map));
  }

  console.log(`minified ${name} → ${outName}`);
}

await Promise.all(targets.map(minifyFile));
