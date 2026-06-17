import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const examplePath = resolve(
    __dirname, '../examples/ld_ao_bloom_env/index.html');
const html = await readFile(examplePath, 'utf8');

const ASSETS_DOMAIN = 'https://assets.v2.londondynamics.com';

for (const id of [
  'ao-bloom-model-url',
  'ao-bloom-environment-url',
  'ao-bloom-skybox-url',
  'ao-bloom-environment-model-url',
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} input should exist`);
}

for (const id of [
  'ao-bloom-reset-model-url',
  'ao-bloom-reset-environment-url',
  'ao-bloom-reset-skybox-url',
  'ao-bloom-reset-environment-model-url',
]) {
  assert.match(html, new RegExp(`id="${id}"`), `${id} button should exist`);
}

assert.match(
    html,
    /class="ld-environment-controls"/,
    'LD+AO+Bloom URL controls should be rendered at the bottom of the stage');
assert.match(
    html,
    /class="ld-environment-url-grid"/,
    'LD+AO+Bloom URL fields should be grouped in a two-row grid');
assert.match(
    html,
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    'LD+AO+Bloom URL controls should use two columns, creating two rows for four fields');
assert.match(
    html,
    new RegExp(`const ASSETS_DOMAIN = ['"]${ASSETS_DOMAIN}['"]`),
    'LD+AO+Bloom example should define the shared examples asset domain');
assert.match(
    html,
    /const normalizeAssetUrl = \(value\) => \{/,
    'LD+AO+Bloom example should normalize URL control values');
assert.match(
    html,
    /trimmed\.startsWith\(['"]http['"]\)/,
    'absolute HTTP URLs should pass through unchanged');
assert.match(
    html,
    /trimmed\.startsWith\(['"]\/['"]\)[\s\S]*`\$\{ASSETS_DOMAIN\}\$\{trimmed\}`/,
    'leading slash asset paths should be prefixed with the examples asset domain');
assert.match(
    html,
    /applyUrlAttribute\([\s\S]*['"]skybox-image['"],[\s\S]*skyboxUrlInput\.value,[\s\S]*allowEmpty:\s*true[\s\S]*\)/,
    'empty skybox URL should be allowed');
assert.match(
    html,
    /modelViewer\.removeAttribute\(attribute\)/,
    'empty optional URL controls should remove their model-viewer attributes');
assert.match(
    html,
    /id="ao-bloom-apply-urls"/,
    'LD+AO+Bloom example should expose an apply URLs button');
assert.match(
    html,
    /Update scene/,
    'LD+AO+Bloom apply button should be labelled Update scene');
assert.match(
    html,
    /const URL_STORAGE_KEY = ['"]ld-ao-bloom-env-url-controls['"]/,
    'LD+AO+Bloom example should use a stable localStorage key for URL controls');
assert.match(
    html,
    /localStorage\.getItem\(URL_STORAGE_KEY\)/,
    'LD+AO+Bloom example should restore saved URL controls on load');
assert.match(
    html,
    /localStorage\.setItem\(\s*URL_STORAGE_KEY,\s*JSON\.stringify/,
    'LD+AO+Bloom example should save URL controls when updating the scene');
assert.match(
    html,
    /loadSavedUrlControls\(\);[\s\S]*applyUrlControls\(\);/,
    'LD+AO+Bloom example should apply saved URL controls during initialization');
