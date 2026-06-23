import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplePath = resolve(
    __dirname, '../examples/ld_ambient_occlusion/index.html');

const html = await readFile(examplePath, 'utf8');

const getModelViewerAttributes = (id) => {
  const modelViewerPattern =
      new RegExp(`<model-viewer\\s+[^>]*id="${id}"[^>]*>`, 's');
  const modelViewerMatch = html.match(modelViewerPattern);
  assert.ok(modelViewerMatch, `${id} model-viewer should exist`);

  return Object.fromEntries(
      [...modelViewerMatch[0].matchAll(/([a-z-]+)(?:="([^"]*)")?/g)].map(
          ([, name, value]) => [name, value ?? '']));
};

const getInputAttributes = (id) => {
  const inputPattern = new RegExp(`<input\\s+[^>]*id="${id}"[^>]*>`, 's');
  const inputMatch = html.match(inputPattern);
  assert.ok(inputMatch, `${id} input should exist`);

  return Object.fromEntries(
      [...inputMatch[0].matchAll(/([a-z-]+)(?:="([^"]*)")?/g)].map(
          ([, name, value]) => [name, value ?? '']));
};

assert.equal(
    getInputAttributes('ao-screen-space').checked,
    '',
    'screen-space radius control should default to checked');

assert.equal(
    getModelViewerAttributes('ld-ao-demo')['ao-screen-space-radius'],
    '',
    'screen-space radius should be enabled before controls are changed');
