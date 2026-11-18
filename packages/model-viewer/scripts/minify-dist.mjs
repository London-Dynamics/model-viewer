/*
 * Copyright 2026 London Dynamics. All Rights Reserved.
 * Minify non-minified Rollup outputs into the published *.min.js artifacts.
 */

import {readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {minify} from 'terser';

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const named = [
  {name: 'model-viewer.js', module: true},
  {name: 'model-viewer-module.js', module: true},
  {name: 'model-viewer-umd.js', module: false},
  {name: 'model-viewer-module-umd.js', module: false},
];

const discovered = (await readdir(distDir))
    .filter((name) => name.endsWith('.js') && !name.endsWith('.min.js') &&
            !name.includes('worker') && !named.some((item) => item.name === name))
    .map((name) => ({
            name,
            module: !name.includes('umd'),
          }));

const targets = [...named, ...discovered];

async function minifyFile({name, module}) {
  const inputPath = join(distDir, name);
  try {
    await readFile(inputPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.log(`skip ${name} (not built)`);
      return;
    }
    throw error;
  }
  const outName = name.replace(/\.js$/, '.min.js');
  const outPath = join(distDir, outName);
  const mapPath = `${outPath}.map`;

  const source = await readFile(inputPath, 'utf8');
  const result = await minify(source, {
    module,
    sourceMap: {
      filename: outName,
      url: `${outName}.map`,
    },
  });

  if (!result.code) {
    throw new Error(`terser produced empty output for ${name}`);
  }

  // Minified siblings import the minified chunks, not the unminified ones.
  const minified = result.code.replace(
      /(\.\/model-viewer[^'"\s]*?)\.js\b/g,
      '$1.min.js');

  await writeFile(outPath, minified);
  if (result.map) {
    await writeFile(
        mapPath, typeof result.map === 'string' ? result.map : JSON.stringify(result.map));
  }

  console.log(`minified ${name} → ${outName}`);
}

await Promise.all(targets.map(minifyFile));
