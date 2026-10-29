declare module 'three-gpu-pathtracer/src/objects/PhysicalCamera.js' {
  import {PerspectiveCamera} from 'three';

  export class PhysicalCamera extends PerspectiveCamera {
    focusDistance: number;
    fStop: number;
    bokehSize: number;
    apertureBlades: number;
    apertureRotation: number;
    anamorphicRatio: number;
  }
}
