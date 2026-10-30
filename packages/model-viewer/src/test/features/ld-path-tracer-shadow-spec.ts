/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
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

import {expect} from 'chai';
import {BackSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry} from 'three';
import {WebGLPathTracer} from 'three-gpu-pathtracer';

import {$scene} from '../../model-viewer-base.js';
import {ModelViewerElement} from '../../model-viewer.js';
import {Shadow} from '../../three-components/Shadow.js';
import {waitForEvent} from '../../utilities.js';
import {assetPath, rafPasses} from '../helpers.js';

const ASTRONAUT = assetPath('models/Astronaut.glb');

type PathTracerHost = ModelViewerElement&{
  isPathTracerReady: boolean;
};

const waitFrames = async (count: number) => {
  for (let i = 0; i < count; i++) {
    await rafPasses();
  }
};

const waitUntil = async (predicate: () => boolean, message: string) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > 40000) {
      throw new Error(message);
    }
    await rafPasses();
  }
};

const syntheticFloor = (shadow: Shadow): Mesh|null => {
  let floor: Mesh|null = null;
  shadow.traverse((object) => {
    if (!shadow.isExcludedFromPathTracer(object) || !(object as Mesh).isMesh) {
      return;
    }
    const material = (object as Mesh).material;
    if (!Array.isArray(material) &&
        (material as MeshBasicMaterial).side === BackSide) {
      floor = object as Mesh;
    }
  });
  return floor;
};

const roomFloorOverlay = (shadow: Shadow): Mesh|null => {
  let overlay: Mesh|null = null;
  shadow.traverse((object) => {
    if (object.userData?.isRoomFloorShadowOverlay === true &&
        (object as Mesh).isMesh) {
      overlay = object as Mesh;
    }
  });
  return overlay;
};

suite('LD path tracer soft-shadow receivers', function() {
  this.timeout(60000);

  let element: ModelViewerElement;
  let shadow: Shadow;
  let floor: Mesh;
  let sceneBuilds = 0;
  let excludedVisibleDuringBuild = 0;
  let restoreSetScene: () => void = () => {};

  const originalSetScene = WebGLPathTracer.prototype.setScene;

  const waitForStableBuilds = async () => {
    let stableFrames = 0;
    let last = sceneBuilds;
    const start = performance.now();
    while (stableFrames < 8) {
      if (performance.now() - start > 40000) {
        throw new Error('path tracer scene builds did not settle');
      }
      await rafPasses();
      if (sceneBuilds === last) {
        stableFrames++;
      } else {
        stableFrames = 0;
        last = sceneBuilds;
      }
    }
  };

  setup(async () => {
    sceneBuilds = 0;
    excludedVisibleDuringBuild = 0;
    WebGLPathTracer.prototype.setScene = function(
        this: WebGLPathTracer, scene: any, camera: any, options?: any) {
      if (element != null && scene === element[$scene] && shadow != null) {
        sceneBuilds++;
        scene.traverseVisible((object: Object3D) => {
          if ((object as Mesh).isMesh &&
              shadow.isExcludedFromPathTracer(object)) {
            excludedVisibleDuringBuild++;
          }
        });
      }
      return originalSetScene.call(this, scene, camera, options);
    };
    restoreSetScene = () => {
      WebGLPathTracer.prototype.setScene = originalSetScene;
    };

    element = new ModelViewerElement();
    element.style.width = '96px';
    element.style.height = '96px';
    element.interactionPrompt = 'none';
    element.shadowIntensity = 1;
    element.shadowSoftness = 1;
    element.shadowMode = 'soft-shadow';
    element.pathTracerSamples = 4;
    element.pathTracerSamplesThreshold = 1;
    document.body.insertBefore(element, document.body.firstChild);

    const loaded = waitForEvent(element, 'load');
    element.src = ASTRONAUT;
    await loaded;
    await element.updateComplete;

    const sceneShadow = element[$scene].shadow;
    expect(sceneShadow, 'soft shadow was not created').to.not.equal(null);
    shadow = sceneShadow!;
    const foundFloor = syntheticFloor(shadow);
    expect(foundFloor, 'synthetic shadow floor was not created')
        .to.not.equal(null);
    floor = foundFloor!;
    expect(floor.visible).to.equal(true);
    expect(shadow.isExcludedFromPathTracer(floor)).to.equal(true);

    element.pathTracer = true;
    await waitUntil(
        () => (element as PathTracerHost).isPathTracerReady === true,
        'path tracer did not become ready');
    await waitForStableBuilds();
  });

  teardown(() => {
    restoreSetScene();
    element?.remove();
  });

  test(
      'hides the soft-shadow floor while the tracer builds and restores it',
      () => {
        expect(sceneBuilds).to.be.greaterThan(0);
        expect(excludedVisibleDuringBuild).to.equal(0);
        expect(floor.visible).to.equal(true);
        expect(shadow.getIntensity()).to.be.greaterThan(0);
      });

  test('does not rebuild when the soft-shadow floor moves', async () => {
    const builds = sceneBuilds;
    floor.position.x += 4;
    floor.updateMatrixWorld(true);
    await waitFrames(8);

    expect(sceneBuilds).to.equal(builds);
    expect(excludedVisibleDuringBuild).to.equal(0);
    expect(floor.visible).to.equal(true);
  });

  test(
      'hides room-floor shadow overlays during a build and does not rebuild when they are added',
      async () => {
        const source = new Mesh(
            new PlaneGeometry(2, 2),
            new MeshStandardMaterial({color: 0x886644}));
        const buildsBeforeSource = sceneBuilds;
        element[$scene].add(source);
        await waitUntil(
            () => sceneBuilds > buildsBeforeSource,
            'adding a room floor mesh did not rebuild the path tracer');
        await waitForStableBuilds();

        const buildsBeforeReceivers = sceneBuilds;
        shadow.setRoomFloorReceivers([source]);
        const overlay = roomFloorOverlay(shadow);
        expect(overlay, 'room-floor shadow overlay was not created')
            .to.not.equal(null);
        expect(shadow.isExcludedFromPathTracer(overlay!)).to.equal(true);
        expect(overlay!.visible).to.equal(true);
        expect(floor.visible).to.equal(false);

        await waitFrames(8);
        expect(sceneBuilds).to.equal(buildsBeforeReceivers);

        element.getPathTracerComposer()!.markSceneDirty();
        await waitUntil(
            () => sceneBuilds > buildsBeforeReceivers,
            'path tracer did not rebuild after markSceneDirty');
        await waitForStableBuilds();

        expect(excludedVisibleDuringBuild).to.equal(0);
        expect(overlay!.visible).to.equal(true);
        expect(floor.visible).to.equal(false);

        const restore = shadow.hideFromPathTracer();
        expect(overlay!.visible).to.equal(false);
        expect(floor.visible).to.equal(false);
        restore();
        expect(overlay!.visible).to.equal(true);
        expect(floor.visible).to.equal(false);
        restore();
        expect(overlay!.visible).to.equal(true);

        shadow.clearRoomFloorReceivers();
        source.removeFromParent();
        source.geometry.dispose();
        (source.material as MeshStandardMaterial).dispose();
        expect(floor.visible).to.equal(true);
      });

  test('still rebuilds when a traced mesh moves', async () => {
    const marker =
        new Mesh(new PlaneGeometry(0.2, 0.2), new MeshStandardMaterial());
    const buildsBeforeMarker = sceneBuilds;
    element[$scene].add(marker);
    await waitUntil(
        () => sceneBuilds > buildsBeforeMarker,
        'adding a mesh did not rebuild the path tracer');
    await waitForStableBuilds();

    const builds = sceneBuilds;
    marker.position.x += 2;
    marker.updateMatrixWorld(true);
    await waitUntil(
        () => sceneBuilds > builds, 'moving a traced mesh did not rebuild');
    await waitForStableBuilds();

    expect(excludedVisibleDuringBuild).to.equal(0);
    expect(floor.visible).to.equal(true);

    marker.removeFromParent();
    marker.geometry.dispose();
    (marker.material as MeshStandardMaterial).dispose();
  });
});
