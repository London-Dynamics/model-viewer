import { MathUtils, Object3D } from 'three';
import ModelViewerElementBase, { $scene, $tick } from '../model-viewer-base';
import { Constructor } from '../utilities';

export type AnimationSettings = {
  name: string;
  amplitude?: number; // meters
  frequency?: number; // hertz
  phase?: number; // radians
  randomPhase?: boolean;
  pitchAmplitude?: number; // degrees
  pitchFrequency?: number; // hertz
  pitchPhase?: number; // radians
  rollAmplitude?: number; // degrees
  rollFrequency?: number; // hertz
  rollPhase?: number; // radians
  yawAmplitude?: number; // degrees
  yawFrequency?: number; // hertz
  yawPhase?: number; // radians
  enabled?: boolean;
  object?: Object3D;
};

export type BobAnimationSettings = AnimationSettings & {
  name: 'bob';
  amplitude: number; // meters
  frequency: number; // hertz
  phase: number; // radians
  randomPhase: boolean;
  pitchAmplitude: number; // radians
  pitchFrequency: number; // hertz
  rollAmplitude: number; // radians
  rollFrequency: number; // hertz
};

export declare interface LDAnimationInterface {
  setAnimationSettings(objectId: string, settings: AnimationSettings): void;
  unsetAnimationSettings(objectId: string): void;
  getAnimationSettings(objectId: string): AnimationSettings | null;
}

export const LDAnimationMixin = <T extends Constructor<ModelViewerElementBase>>(
  ModelViewerElement: T
): Constructor<LDAnimationInterface> & T => {
  class LDAnimationModelViewerElement extends ModelViewerElement {
    private animationSettingsMap: Map<string, AnimationSettings> = new Map();

    private _getAnimatedObjectById(objectId: string): Object3D | null {
      if (this.animationSettingsMap.has('object')) {
        return this.animationSettingsMap.get('object')!.object || null;
      }
      let foundObject: Object3D | null = null;

      try {
        this[$scene].traverse((object) => {
          if (
            (objectId == 'src' && object?.userData?.filename) ||
            object.name === objectId
          ) {
            foundObject = object;
            throw new Error('StopTraversal');
          }
        });
      } catch (e) {
        if ((e as Error).message !== 'StopTraversal') {
          throw e;
        }
      }
      return foundObject;
    }

    setAnimationSettings(objectId: string, settings: AnimationSettings): void {
      if (settings.name == 'bob') {
        const defaultSettings: BobAnimationSettings = {
          name: 'bob',
          amplitude: 0.1,
          frequency: 0.5,
          phase: 0,
          randomPhase: false,
          pitchAmplitude: 2,
          pitchFrequency: 0.25,
          rollAmplitude: 1.5,
          rollFrequency: 0.2,
          enabled: true,
        };
        settings = { ...defaultSettings, ...settings };

        settings.pitchAmplitude = MathUtils.degToRad(
          settings.pitchAmplitude || 0
        );
        settings.rollAmplitude = MathUtils.degToRad(
          settings.rollAmplitude || 0
        );

        if (settings.randomPhase) {
          settings.phase = settings.phase || 0;
          settings.phase += Math.random() * Math.PI * 2;
        }

        this.animationSettingsMap.set(objectId, settings);
      } else {
        console.warn(`Animation name ${settings.name} is not supported.`);
        return;
      }
    }

    unsetAnimationSettings(objectId: string): void {
      this.animationSettingsMap.delete(objectId);
    }

    getAnimationSettings(objectId: string): AnimationSettings | null {
      return this.animationSettingsMap.get(objectId) || null;
    }

    [$tick](_time: number, delta: number) {
      // @ts-ignore - dynamic symbol access
      super[$tick](_time, delta);

      const time = _time / 1000; // convert to seconds

      this.animationSettingsMap.forEach((settings, objectId) => {
        if (!settings.enabled) {
          return;
        }

        const obj = this._getAnimatedObjectById(objectId);
        if (!obj) {
          return;
        }

        if (settings.name == 'bob') {
          const bobSettings = settings as BobAnimationSettings;

          const y =
            Math.sin(
              time * bobSettings.frequency * 2 * Math.PI + bobSettings.phase
            ) * bobSettings.amplitude;

          // Pitch (X axis)
          const pitch =
            Math.sin(
              time * bobSettings.pitchFrequency * 2 * Math.PI +
                bobSettings.phase
            ) * bobSettings.pitchAmplitude;

          // Roll (Z axis)
          const roll =
            Math.sin(
              time * bobSettings.rollFrequency * 2 * Math.PI + bobSettings.phase
            ) * bobSettings.rollAmplitude;

          obj.position.y = y;
          obj.rotation.x = pitch;
          obj.rotation.z = roll;
        }
      });
    }
  }
  // @ts-ignore
  return LDAnimationModelViewerElement;
};
