import {Object3D} from 'three';

export type LdBuilderGenerator = 'createSpace'|'createRoom';

/** Where the loaded room's feature data came from. */
export type RoomSource =
    |{kind: 'ldBuilder'; ldBuilder: LdBuilderInfo;}
    |{kind: 'detected';};

/** Declaration Builder writes on the room node's glTF extras. */
export interface LdBuilderInfo {
  version: string;
  generator: LdBuilderGenerator;
  perimeterWalls: number;
  innerWalls: number;
  cutaway: boolean;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Returns the declaration, or null when the value is missing or malformed. */
export function parseLdBuilder(value: unknown): LdBuilderInfo|null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const {version, generator, perimeterWalls, innerWalls, cutaway} = record;
  if (typeof version !== 'string' || version.length === 0) return null;
  if (generator !== 'createSpace' && generator !== 'createRoom') return null;
  if (!isCount(perimeterWalls) || !isCount(innerWalls)) return null;
  if (typeof cutaway !== 'boolean') return null;
  return {version, generator, perimeterWalls, innerWalls, cutaway};
}

/**
 * Reads `userData.ldBuilder` from the loaded base model. The loader marks
 * `gltf.scene` as the base model, and Builder stamps the room child.
 */
export function readLdBuilder(baseModel: Object3D|null): LdBuilderInfo|null {
  if (!baseModel) return null;
  let found: LdBuilderInfo|null = null;
  baseModel.traverse((child) => {
    if (found) return;
    const parsed = parseLdBuilder(child.userData?.ldBuilder);
    if (parsed) found = parsed;
  });
  return found;
}

/**
 * Builder declaration when the room carries one. `detected` is reserved for
 * metadata calculated from a model that has no declaration. Null when neither
 * applies. This does not inspect mesh names.
 */
export function readRoomSource(baseModel: Object3D|null): RoomSource|null {
  const ldBuilder = readLdBuilder(baseModel);
  return ldBuilder ? {kind: 'ldBuilder', ldBuilder} : null;
}
