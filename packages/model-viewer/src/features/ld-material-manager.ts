import ModelViewerElementBase from '../model-viewer-base.js'; // $needsRender, // $onModelLoad, //$scene,

import { Constructor } from '../utilities.js';

export declare interface LDMaterialManagerInterface {
  setMaterial(
    materialName: string,
    properties: any,
    resetBeforeApply?: boolean
  ): void;
}

export const LDMaterialManagerMixin = <
  T extends Constructor<ModelViewerElementBase>
>(
  ModelViewerElement: T
): Constructor<LDMaterialManagerInterface> & T => {
  class LDMaterialManagerModelViewerElement extends ModelViewerElement {
    private materialBackups = new Map<string, any>();

    private getMaterialByName(materialName: string) {
      const model = (this as any).model;
      if (!model) {
        console.warn('Model is not loaded yet.');
        return null;
      }
      const materials = model.materials;
      if (!materials) {
        console.warn('No materials found in the model.');
        return null;
      }
      return materials.find((material: any) => material.name === materialName);
    }

    private backupMaterial(material: any, materialName: string) {
      if (this.materialBackups.has(materialName)) {
        return; // Already backed up
      }

      const safeGet = (getter: () => any, fallback: any = 0) => {
        try {
          return getter();
        } catch {
          return fallback;
        }
      };

      const backup = {
        // Core material properties
        emissiveFactor: [...material.emissiveFactor],

        // Alpha/transparency properties
        alphaCutoff: material.getAlphaCutoff(),
        alphaMode: material.getAlphaMode(),
        doubleSided: material.getDoubleSided(),

        // PBR properties (flattened from pbrMetallicRoughness)
        baseColorFactor: [...material.pbrMetallicRoughness.baseColorFactor],
        metallicFactor: material.pbrMetallicRoughness.metallicFactor,
        roughnessFactor: material.pbrMetallicRoughness.roughnessFactor,

        // PBR Next properties
        emissiveStrength: safeGet(() => material.emissiveStrength),
        clearcoatFactor: safeGet(() => material.clearcoatFactor),
        clearcoatRoughnessFactor: safeGet(
          () => material.clearcoatRoughnessFactor
        ),
        clearcoatNormalScale: safeGet(() => material.clearcoatNormalScale),
        ior: safeGet(() => material.ior, 1.5),

        // Sheen properties - handle potential undefined sheenColorFactor
        sheenColorFactor: safeGet(() => {
          if (
            material.sheenColorFactor &&
            Array.isArray(material.sheenColorFactor)
          ) {
            return [...material.sheenColorFactor];
          } else if (material.sheenColorFactor) {
            return material.sheenColorFactor;
          }
          return [0, 0, 0];
        }, [0, 0, 0]),
        sheenRoughnessFactor: safeGet(() => material.sheenRoughnessFactor),

        // Transmission properties
        transmissionFactor: safeGet(() => material.transmissionFactor),

        // Volume properties
        thicknessFactor: safeGet(() => material.thicknessFactor),
        attenuationDistance: safeGet(
          () => material.attenuationDistance,
          Infinity
        ),
        attenuationColor: safeGet(() => {
          if (
            material.attenuationColor &&
            Array.isArray(material.attenuationColor)
          ) {
            return [...material.attenuationColor];
          } else if (material.attenuationColor) {
            return material.attenuationColor;
          }
          return [1, 1, 1];
        }, [1, 1, 1]),

        // Specular properties
        specularFactor: safeGet(() => material.specularFactor, 1),
        specularColorFactor: safeGet(() => {
          if (
            material.specularColorFactor &&
            Array.isArray(material.specularColorFactor)
          ) {
            return [...material.specularColorFactor];
          } else if (material.specularColorFactor) {
            return material.specularColorFactor;
          }
          return [1, 1, 1];
        }, [1, 1, 1]),

        // Iridescence properties
        iridescenceFactor: safeGet(() => material.iridescenceFactor),
        iridescenceIor: safeGet(() => material.iridescenceIor, 1.3),
        iridescenceThicknessMinimum: safeGet(
          () => material.iridescenceThicknessMinimum,
          100
        ),
        iridescenceThicknessMaximum: safeGet(
          () => material.iridescenceThicknessMaximum,
          400
        ),

        // Anisotropy properties
        anisotropyStrength: safeGet(() => material.anisotropyStrength),
        anisotropyRotation: safeGet(() => material.anisotropyRotation),
      };

      this.materialBackups.set(materialName, backup);
    }

    private restoreMaterial(material: any, materialName: string) {
      const backup = this.materialBackups.get(materialName);
      if (!backup) {
        console.warn(`No backup found for material ${materialName}`);
        return;
      }

      const safeRestore = (setter: () => void) => {
        try {
          setter();
        } catch (error) {
          // Silently ignore restoration errors for unsupported properties
        }
      };

      // Restore all backed up properties with safety checks
      safeRestore(() => material.setEmissiveFactor(backup.emissiveFactor));
      safeRestore(() => material.setAlphaCutoff(backup.alphaCutoff));
      safeRestore(() => material.setAlphaMode(backup.alphaMode));
      safeRestore(() => material.setDoubleSided(backup.doubleSided));

      // PBR properties
      safeRestore(() =>
        material.pbrMetallicRoughness.setBaseColorFactor(backup.baseColorFactor)
      );
      safeRestore(() =>
        material.pbrMetallicRoughness.setMetallicFactor(backup.metallicFactor)
      );
      safeRestore(() =>
        material.pbrMetallicRoughness.setRoughnessFactor(backup.roughnessFactor)
      );

      // PBR Next properties - check method existence and backup validity
      safeRestore(() => {
        if (
          material.setEmissiveStrength &&
          backup.emissiveStrength !== undefined
        ) {
          material.setEmissiveStrength(backup.emissiveStrength);
        }
      });
      safeRestore(() => {
        if (
          material.setClearcoatFactor &&
          backup.clearcoatFactor !== undefined
        ) {
          material.setClearcoatFactor(backup.clearcoatFactor);
        }
      });
      safeRestore(() => {
        if (
          material.setClearcoatRoughnessFactor &&
          backup.clearcoatRoughnessFactor !== undefined
        ) {
          material.setClearcoatRoughnessFactor(backup.clearcoatRoughnessFactor);
        }
      });
      safeRestore(() => {
        if (
          material.setClearcoatNormalScale &&
          backup.clearcoatNormalScale !== undefined
        ) {
          material.setClearcoatNormalScale(backup.clearcoatNormalScale);
        }
      });
      safeRestore(() => {
        if (material.setIor && backup.ior !== undefined) {
          material.setIor(backup.ior);
        }
      });

      // Sheen properties - check method existence and backup validity
      safeRestore(() => {
        if (
          material.setSheenColorFactor &&
          backup.sheenColorFactor !== undefined
        ) {
          material.setSheenColorFactor(backup.sheenColorFactor);
        }
      });
      safeRestore(() => {
        if (
          material.setSheenRoughnessFactor &&
          backup.sheenRoughnessFactor !== undefined
        ) {
          material.setSheenRoughnessFactor(backup.sheenRoughnessFactor);
        }
      });

      // Transmission properties
      safeRestore(() => {
        if (
          material.setTransmissionFactor &&
          backup.transmissionFactor !== undefined
        ) {
          material.setTransmissionFactor(backup.transmissionFactor);
        }
      });

      // Volume properties
      safeRestore(() => {
        if (
          material.setThicknessFactor &&
          backup.thicknessFactor !== undefined
        ) {
          material.setThicknessFactor(backup.thicknessFactor);
        }
      });
      safeRestore(() => {
        if (
          material.setAttenuationDistance &&
          backup.attenuationDistance !== undefined
        ) {
          material.setAttenuationDistance(backup.attenuationDistance);
        }
      });
      safeRestore(() => {
        if (
          material.setAttenuationColor &&
          backup.attenuationColor !== undefined
        ) {
          material.setAttenuationColor(backup.attenuationColor);
        }
      });

      // Specular properties
      safeRestore(() => {
        if (material.setSpecularFactor && backup.specularFactor !== undefined) {
          material.setSpecularFactor(backup.specularFactor);
        }
      });
      safeRestore(() => {
        if (
          material.setSpecularColorFactor &&
          backup.specularColorFactor !== undefined
        ) {
          material.setSpecularColorFactor(backup.specularColorFactor);
        }
      });

      // Iridescence properties
      safeRestore(() => {
        if (
          material.setIridescenceFactor &&
          backup.iridescenceFactor !== undefined
        ) {
          material.setIridescenceFactor(backup.iridescenceFactor);
        }
      });
      safeRestore(() => {
        if (material.setIridescenceIor && backup.iridescenceIor !== undefined) {
          material.setIridescenceIor(backup.iridescenceIor);
        }
      });
      safeRestore(() => {
        if (
          material.setIridescenceThicknessMinimum &&
          backup.iridescenceThicknessMinimum !== undefined
        ) {
          material.setIridescenceThicknessMinimum(
            backup.iridescenceThicknessMinimum
          );
        }
      });
      safeRestore(() => {
        if (
          material.setIridescenceThicknessMaximum &&
          backup.iridescenceThicknessMaximum !== undefined
        ) {
          material.setIridescenceThicknessMaximum(
            backup.iridescenceThicknessMaximum
          );
        }
      });

      // Anisotropy properties
      safeRestore(() => {
        if (
          material.setAnisotropyStrength &&
          backup.anisotropyStrength !== undefined
        ) {
          material.setAnisotropyStrength(backup.anisotropyStrength);
        }
      });
      safeRestore(() => {
        if (
          material.setAnisotropyRotation &&
          backup.anisotropyRotation !== undefined
        ) {
          material.setAnisotropyRotation(backup.anisotropyRotation);
        }
      });
    }

    private applyMaterialProperties(material: any, properties: any) {
      // Iterate through all provided properties and apply them
      for (const [key, value] of Object.entries(properties)) {
        try {
          switch (key) {
            // Core material properties
            case 'emissiveFactor':
              material.setEmissiveFactor(value);
              break;
            case 'alphaCutoff':
              material.setAlphaCutoff(value);
              break;
            case 'alphaMode':
              material.setAlphaMode(value);
              break;
            case 'doubleSided':
              material.setDoubleSided(value);
              break;

            // PBR properties (flattened from pbrMetallicRoughness)
            case 'baseColorFactor':
              material.pbrMetallicRoughness.setBaseColorFactor(value);
              break;
            case 'metallicFactor':
              material.pbrMetallicRoughness.setMetallicFactor(value);
              break;
            case 'roughnessFactor':
              material.pbrMetallicRoughness.setRoughnessFactor(value);
              break;

            // PBR Next properties
            case 'emissiveStrength':
              if (material.setEmissiveStrength)
                material.setEmissiveStrength(value);
              break;
            case 'clearcoatFactor':
              if (material.setClearcoatFactor)
                material.setClearcoatFactor(value);
              break;
            case 'clearcoatRoughnessFactor':
              if (material.setClearcoatRoughnessFactor)
                material.setClearcoatRoughnessFactor(value);
              break;
            case 'clearcoatNormalScale':
              if (material.setClearcoatNormalScale)
                material.setClearcoatNormalScale(value);
              break;
            case 'ior':
              if (material.setIor) material.setIor(value);
              break;

            // Sheen properties
            case 'sheenColorFactor':
              if (material.setSheenColorFactor)
                material.setSheenColorFactor(value);
              break;
            case 'sheenRoughnessFactor':
              if (material.setSheenRoughnessFactor)
                material.setSheenRoughnessFactor(value);
              break;

            // Transmission properties
            case 'transmissionFactor':
              if (material.setTransmissionFactor)
                material.setTransmissionFactor(value);
              break;

            // Volume properties
            case 'thicknessFactor':
              if (material.setThicknessFactor)
                material.setThicknessFactor(value);
              break;
            case 'attenuationDistance':
              if (material.setAttenuationDistance)
                material.setAttenuationDistance(value);
              break;
            case 'attenuationColor':
              if (material.setAttenuationColor)
                material.setAttenuationColor(value);
              break;

            // Specular properties
            case 'specularFactor':
              if (material.setSpecularFactor) material.setSpecularFactor(value);
              break;
            case 'specularColorFactor':
              if (material.setSpecularColorFactor)
                material.setSpecularColorFactor(value);
              break;

            // Iridescence properties
            case 'iridescenceFactor':
              if (material.setIridescenceFactor)
                material.setIridescenceFactor(value);
              break;
            case 'iridescenceIor':
              if (material.setIridescenceIor) material.setIridescenceIor(value);
              break;
            case 'iridescenceThicknessMinimum':
              if (material.setIridescenceThicknessMinimum)
                material.setIridescenceThicknessMinimum(value);
              break;
            case 'iridescenceThicknessMaximum':
              if (material.setIridescenceThicknessMaximum)
                material.setIridescenceThicknessMaximum(value);
              break;

            // Anisotropy properties
            case 'anisotropyStrength':
              if (material.setAnisotropyStrength)
                material.setAnisotropyStrength(value);
              break;
            case 'anisotropyRotation':
              if (material.setAnisotropyRotation)
                material.setAnisotropyRotation(value);
              break;

            default:
              console.warn(`Unknown material property: ${key}`);
          }
        } catch (error) {
          console.error(`Error setting material property ${key}:`, error);
        }
      }
    }

    setMaterial(
      materialName: string,
      properties: any,
      resetBeforeApply?: boolean
    ) {
      const material = this.getMaterialByName(materialName);
      if (!material) {
        console.warn(`Material ${materialName} not found.`);
        return;
      }

      // Backup the material on first use
      this.backupMaterial(material, materialName);

      // If resetBeforeApply is true, restore from backup first
      if (resetBeforeApply) {
        this.restoreMaterial(material, materialName);
      }

      // Apply the new properties
      this.applyMaterialProperties(material, properties);
    }
  }

  return LDMaterialManagerModelViewerElement;
};
