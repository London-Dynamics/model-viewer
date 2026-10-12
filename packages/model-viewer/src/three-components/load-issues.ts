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

/**
 * Known issue codes. Hosts should treat unknown codes as generic failures:
 * new codes are added over time without a breaking change.
 */
export type ModelLoadIssueCode =
    |'empty-response'|'http-error'|'invalid-glb-header'|'truncated-file'|
    'missing-decoder'|'unsupported-extension'|'no-scene'|'parse-error'|
    'no-room-surfaces'|(string&{});

export type ModelLoadIssueSeverity = 'error'|'warning';

export interface ModelLoadIssue {
  code: ModelLoadIssueCode;
  severity: ModelLoadIssueSeverity;
  message: string;
  details?: Record<string, unknown>;
}

export class ModelLoadError extends Error {
  readonly issues: ModelLoadIssue[];
  readonly originalError?: unknown;

  constructor(issues: ModelLoadIssue[], originalError?: unknown) {
    super(
        issues.filter((issue) => issue.severity === 'error')
            .map((issue) => issue.message)
            .join('; ') ||
        'Model failed to load');
    this.name = 'ModelLoadError';
    this.issues = issues;
    this.originalError = originalError;
  }
}

export const hasLoadErrors = (issues: ModelLoadIssue[]) =>
    issues.some((issue) => issue.severity === 'error');

export interface LoadCheckInput {
  data: ArrayBuffer|string;
  /** Whether a meshopt decoder has been configured on the loader. */
  hasMeshoptDecoder: boolean;
}

export type LoadCheck = (input: LoadCheckInput) => ModelLoadIssue[];

const GLB_MAGIC = 0x46546c67;  // 'glTF'
const GLB_HEADER_LENGTH = 12;
const GLB_CHUNK_TYPE_JSON = 0x4e4f534a;

const SUPPORTED_EXTENSIONS = new Set([
  'KHR_binary_glTF',
  'KHR_draco_mesh_compression',
  'KHR_lights_punctual',
  'KHR_materials_clearcoat',
  'KHR_materials_dispersion',
  'KHR_materials_ior',
  'KHR_materials_sheen',
  'KHR_materials_specular',
  'KHR_materials_transmission',
  'KHR_materials_iridescence',
  'KHR_materials_anisotropy',
  'KHR_materials_unlit',
  'KHR_materials_volume',
  'KHR_texture_basisu',
  'KHR_texture_transform',
  'KHR_mesh_quantization',
  'KHR_materials_emissive_strength',
  'KHR_materials_variants',
  'EXT_materials_bump',
  'EXT_texture_webp',
  'EXT_texture_avif',
  'EXT_meshopt_compression',
  'EXT_mesh_gpu_instancing',
]);

const MESHOPT_EXTENSIONS = new Set(['EXT_meshopt_compression']);

const byteLengthOf = (data: ArrayBuffer|string) =>
    typeof data === 'string' ? data.length : data.byteLength;

/** JSON glTF starts with `{` (after optional whitespace or BOM). */
const looksLikeJson = (data: ArrayBuffer|string) => {
  if (typeof data === 'string') {
    return data.trimStart().startsWith('{');
  }
  const bytes = new Uint8Array(data, 0, Math.min(data.byteLength, 64));
  for (const byte of bytes) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d ||
        byte === 0xef || byte === 0xbb || byte === 0xbf) {
      continue;
    }
    return byte === 0x7b;
  }
  return false;
};

const readGltfJson = (data: ArrayBuffer|string): any|undefined => {
  try {
    if (typeof data === 'string') {
      return JSON.parse(data);
    }
    if (looksLikeJson(data)) {
      return JSON.parse(new TextDecoder().decode(data));
    }
    if (data.byteLength < GLB_HEADER_LENGTH + 8) {
      return undefined;
    }
    const view = new DataView(data);
    if (view.getUint32(0, true) !== GLB_MAGIC) {
      return undefined;
    }
    const chunkLength = view.getUint32(GLB_HEADER_LENGTH, true);
    const chunkType = view.getUint32(GLB_HEADER_LENGTH + 4, true);
    const start = GLB_HEADER_LENGTH + 8;
    if (chunkType !== GLB_CHUNK_TYPE_JSON ||
        start + chunkLength > data.byteLength) {
      return undefined;
    }
    return JSON.parse(
        new TextDecoder().decode(new Uint8Array(data, start, chunkLength)));
  } catch {
    return undefined;
  }
};

export const checkEmptyResponse: LoadCheck = ({data}) =>
    byteLengthOf(data) === 0 ? [{
      code: 'empty-response',
      severity: 'error',
      message: 'The model file is empty (0 bytes).',
      details: {byteLength: 0},
    }] :
                               [];

export const checkGlbHeader: LoadCheck = ({data}) => {
  const byteLength = byteLengthOf(data);
  if (byteLength === 0 || typeof data === 'string' || looksLikeJson(data)) {
    return [];
  }
  if (byteLength < GLB_HEADER_LENGTH) {
    return [{
      code: 'invalid-glb-header',
      severity: 'error',
      message: `The file is too small to be a GLB (${byteLength} bytes).`,
      details: {byteLength},
    }];
  }
  const view = new DataView(data);
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    return [{
      code: 'invalid-glb-header',
      severity: 'error',
      message: 'The file is not a GLB or glTF model.',
      details: {byteLength, magic},
    }];
  }
  const issues: ModelLoadIssue[] = [];
  const version = view.getUint32(4, true);
  if (version !== 2) {
    issues.push({
      code: 'invalid-glb-header',
      severity: 'error',
      message: `Unsupported GLB version ${version}; only version 2 is supported.`,
      details: {version},
    });
  }
  const declaredLength = view.getUint32(8, true);
  if (declaredLength > byteLength) {
    issues.push({
      code: 'truncated-file',
      severity: 'error',
      message: `The file is incomplete: expected ${declaredLength} bytes, got ${
          byteLength}.`,
      details: {declaredLength, byteLength},
    });
  }
  return issues;
};

export const checkRequiredExtensions: LoadCheck = ({data, hasMeshoptDecoder}) => {
  const json = readGltfJson(data);
  const required: unknown = json?.extensionsRequired;
  if (!Array.isArray(required)) {
    return [];
  }
  const issues: ModelLoadIssue[] = [];
  for (const extension of required) {
    if (typeof extension !== 'string') continue;
    if (MESHOPT_EXTENSIONS.has(extension) && !hasMeshoptDecoder) {
      issues.push({
        code: 'missing-decoder',
        severity: 'error',
        message: `The model uses ${
            extension} compression but no meshopt decoder is configured.`,
        details: {extension},
      });
    } else if (!SUPPORTED_EXTENSIONS.has(extension)) {
      issues.push({
        code: 'unsupported-extension',
        severity: 'error',
        message: `The model requires an unsupported extension: ${extension}.`,
        details: {extension},
      });
    }
  }
  return issues;
};

/** Checks run on the raw file before parsing. Add new checks here. */
export const preParseChecks: LoadCheck[] = [
  checkEmptyResponse,
  checkGlbHeader,
  checkRequiredExtensions,
];

export const collectLoadIssues =
    (input: LoadCheckInput, checks: LoadCheck[] = preParseChecks):
        ModelLoadIssue[] => checks.flatMap((check) => check(input));

type ErrorClassifier = (error: unknown) => ModelLoadIssue[];

const messageOf = (error: unknown) =>
    error instanceof Error ? error.message : String(error ?? '');

const classifyHttpError: ErrorClassifier = (error) => {
  const response = (error as {response?: Response})?.response;
  if (!response || typeof response.status !== 'number') return [];
  return [{
    code: 'http-error',
    severity: 'error',
    message: `The model could not be downloaded (HTTP ${response.status}).`,
    details: {status: response.status, url: response.url},
  }];
};

const classifyMissingDecoder: ErrorClassifier = (error) => {
  const message = messageOf(error);
  if (/setMeshoptDecoder must be called/.test(message)) {
    return [{
      code: 'missing-decoder',
      severity: 'error',
      message: 'The model uses meshopt compression but no decoder is configured.',
      details: {extension: 'EXT_meshopt_compression'},
    }];
  }
  if (/No DRACOLoader instance provided/.test(message)) {
    return [{
      code: 'missing-decoder',
      severity: 'error',
      message: 'The model uses Draco compression but no decoder is configured.',
      details: {extension: 'KHR_draco_mesh_compression'},
    }];
  }
  return [];
};

const classifyNoScene: ErrorClassifier = (error) =>
    /does not have a scene/.test(messageOf(error)) ? [{
      code: 'no-scene',
      severity: 'error',
      message: 'The model does not contain a scene.',
    }] :
                                                     [];

/** Maps thrown loader errors to issues. Add new classifiers here. */
export const errorClassifiers: ErrorClassifier[] = [
  classifyHttpError,
  classifyMissingDecoder,
  classifyNoScene,
];

/**
 * Turns any load failure into a list of issues. Falls back to a single
 * `parse-error` when no classifier recognises the error.
 */
export const classifyLoadError = (error: unknown): ModelLoadIssue[] => {
  if (error instanceof ModelLoadError) {
    return error.issues;
  }
  const issues = errorClassifiers.flatMap((classify) => classify(error));
  if (issues.length > 0) {
    return issues;
  }
  return [{
    code: 'parse-error',
    severity: 'error',
    message: messageOf(error) || 'The model could not be parsed.',
  }];
};

export const toModelLoadError = (error: unknown): ModelLoadError =>
    error instanceof ModelLoadError ?
    error :
    new ModelLoadError(classifyLoadError(error), error);
