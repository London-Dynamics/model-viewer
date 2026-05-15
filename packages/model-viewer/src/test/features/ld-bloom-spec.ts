import {expect} from 'chai';
import {
  BoxGeometry,
  Color,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Texture
} from 'three';

import {ModelViewerElement} from '../../model-viewer.js';
import {$scene} from '../../model-viewer-base.js';
import {timePasses} from '../../utilities.js';

// The bloom composer mutates materials only for the duration of the bloom
// render pass and restores them immediately afterwards, so most behavior is
// tested by poking at its private state rather than by expecting persistent
// material changes.
type BloomComposerInternals = {
  targets: Array<{mesh?: string, material?: string, enabled?: boolean}>;
  activeMsaa: number;
  hasDarkenedState: boolean;
  savedBackground: Color|Texture|null;
  darkenNonTargeted(): void;
  restoreNonTargeted(): void;
  dispose(): void;
};

const getComposer = (element: ModelViewerElement): BloomComposerInternals =>
    element[$scene].effectRenderer as unknown as BloomComposerInternals;

const addCubeMesh = (element: ModelViewerElement, name: string):
    {mesh: Mesh, material: MeshStandardMaterial} => {
      const material = new MeshStandardMaterial({color: '#202020'});
      material.name = `${name}-mat`;
      const mesh = new Mesh(new BoxGeometry(), material);
      mesh.name = name;
      element[$scene].add(mesh);
      return {mesh, material};
    };

suite('LD Bloom', () => {
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
    document.body.appendChild(element);
  });

  teardown(() => {
    element.remove();
  });

  test('registers an effect composer when bloom is enabled', async () => {
    element.setBloomTargets([{material: 'whatever'}]);
    element.bloom = true;
    await timePasses();

    expect(element[$scene].effectRenderer).to.not.equal(null);
  });

  test('unregisters the effect composer when bloom is disabled', async () => {
    element.setBloomTargets([{material: 'whatever'}]);
    element.bloom = true;
    await timePasses();
    element.bloom = false;
    await timePasses();

    expect(element[$scene].effectRenderer).to.equal(null);
  });

  test('round-trips bloom targets through getBloomTargets()', async () => {
    const targets = [
      {mesh: 'Mesh-1', color: '#ff3366', intensity: 2},
      {mesh: 'Mesh-3', color: '#33ff88', intensity: 2},
      {mesh: 'Mesh-6', color: '#3388ff', intensity: 2},
    ];
    element.setBloomTargets(targets);
    await timePasses();

    expect(element.getBloomTargets()).to.deep.equal(targets);
  });

  test('parses bloom-targets JSON attribute', async () => {
    const targets = [{material: 'JsonMaterial', color: '#3366ff', intensity: 5}];
    element.setAttribute('bloom-targets', JSON.stringify(targets));
    element.bloom = true;
    await timePasses();

    expect(element.getBloomTargets()).to.deep.equal(targets);
  });

  test('setBloomTargetEnabled toggles a target without losing it', async () => {
    element.setBloomTargets(
        [{material: 'SwitchableMaterial', color: '#ffffff', intensity: 3}]);
    element.bloom = true;
    await timePasses();

    element.setBloomTargetEnabled('material', 'SwitchableMaterial', false);
    await timePasses();

    const stored = element.getBloomTargets();
    expect(stored).to.have.length(1);
    expect(stored[0].material).to.equal('SwitchableMaterial');
    expect(stored[0].enabled).to.equal(false);
  });

  test(
      'applies bloom emissive to the right meshes during the bloom pass',
      async () => {
        const {material: m1} = addCubeMesh(element, 'Mesh-1');
        const {material: m2} = addCubeMesh(element, 'Mesh-2');
        const {material: m3} = addCubeMesh(element, 'Mesh-3');
        const {material: m4} = addCubeMesh(element, 'Mesh-4');
        const {material: m5} = addCubeMesh(element, 'Mesh-5');
        const {material: m6} = addCubeMesh(element, 'Mesh-6');

        element.setBloomTargets([
          {mesh: 'Mesh-1', color: '#ff3366', intensity: 2.5},
          {mesh: 'Mesh-3', color: '#33ff88', intensity: 2.5},
          {mesh: 'Mesh-6', color: '#3388ff', intensity: 2.5},
        ]);
        element.bloom = true;
        await timePasses();

        const composer = getComposer(element);
        composer.darkenNonTargeted();

        try {
          // Targeted meshes get their emissive boosted to the requested color.
          expect(m1.emissive.getHexString()).to.equal('ff3366');
          expect(m1.emissiveIntensity).to.equal(2.5);
          expect(m3.emissive.getHexString()).to.equal('33ff88');
          expect(m6.emissive.getHexString()).to.equal('3388ff');

          // Opaque non-target meshes are swapped to a shared opaque-black
          // material so they still draw into the depth buffer and correctly
          // occlude bright targeted meshes that are physically behind them
          // — otherwise the bloom of e.g. a car's rear tail-lights would
          // leak through the front of the body when viewed from the
          // opposite side.
          const blackPattern = /^MeshBasicMaterial/;
          for (const name of ['Mesh-2', 'Mesh-4', 'Mesh-5']) {
            const mesh = element[$scene].getObjectByName(name) as Mesh;
            expect(mesh.visible).to.equal(true);
            expect(blackPattern.test((mesh.material as Material).type))
                .to.equal(true);
          }

          // Targeted meshes stay visible with their original material instance
          // (only emissive properties were mutated in-place).
          expect((element[$scene].getObjectByName('Mesh-1') as Mesh)!.visible)
              .to.equal(true);
          expect(((element[$scene].getObjectByName('Mesh-1') as Mesh)!.material as
                  Material))
              .to.equal(m1);

          // Untouched materials are not mutated — the opaque-black swap is
          // done by replacing mesh.material, not by mutating the original.
          expect(m2.emissive.getHexString()).to.equal('000000');
          expect(m4.emissive.getHexString()).to.equal('000000');
          expect(m5.emissive.getHexString()).to.equal('000000');
        } finally {
          composer.restoreNonTargeted();
        }

        // After restore, every material is back to its pre-bloom state.
        expect(m1.emissive.getHexString()).to.equal('000000');
        expect(m3.emissive.getHexString()).to.equal('000000');
        expect(m6.emissive.getHexString()).to.equal('000000');
      });

  test('boosts MeshBasicMaterial color when targeted by mesh name', async () => {
    const material = new MeshBasicMaterial({color: '#202020'});
    material.name = 'PlainMaterial';
    const mesh = new Mesh(new BoxGeometry(), material);
    mesh.name = 'GlowMesh';
    element[$scene].add(mesh);

    element.setBloomTargets(
        [{mesh: 'GlowMesh', color: '#ff6600', intensity: 2}]);
    element.bloom = true;
    await timePasses();

    const composer = getComposer(element);
    composer.darkenNonTargeted();
    try {
      expect(material.color.getHexString()).to.equal('ff6600');
    } finally {
      composer.restoreNonTargeted();
    }
    expect(material.color.getHexString()).to.equal('202020');
  });

  test('disabling a target excludes it from the bloom pass', async () => {
    const {material: m1} = addCubeMesh(element, 'Mesh-1');
    const {material: m3} = addCubeMesh(element, 'Mesh-3');

    element.setBloomTargets([
      {mesh: 'Mesh-1', color: '#ff0000', intensity: 4},
      {mesh: 'Mesh-3', color: '#00ff00', intensity: 4},
    ]);
    element.bloom = true;
    await timePasses();

    element.setBloomTargetEnabled('mesh', 'Mesh-1', false);
    await timePasses();

    const composer = getComposer(element);
    composer.darkenNonTargeted();
    try {
      // Mesh-1 was disabled, so it gets darkened, not boosted.
      expect(m1.emissive.getHexString()).to.equal('000000');
      // Mesh-3 is still in the bloom pass.
      expect(m3.emissive.getHexString()).to.equal('00ff00');
    } finally {
      composer.restoreNonTargeted();
    }
  });

  test(
      'disabling every named target suppresses bloom entirely ' +
          '(does not fall back to global bloom)',
      async () => {
        const {material: m1} = addCubeMesh(element, 'Mesh-1');
        const {material: m3} = addCubeMesh(element, 'Mesh-3');

        element.setBloomTargets([
          {mesh: 'Mesh-1', color: '#ff0000', intensity: 4},
          {mesh: 'Mesh-3', color: '#00ff00', intensity: 4},
        ]);
        element.bloom = true;
        await timePasses();

        element.setBloomTargetEnabled('mesh', 'Mesh-1', false);
        element.setBloomTargetEnabled('mesh', 'Mesh-3', false);
        await timePasses();

        const composer = getComposer(element);
        // The composer must still see the targets (so it knows the user
        // configured selective bloom) instead of an empty list, otherwise it
        // falls through to "bloom the whole scene".
        expect(composer.targets).to.have.length(2);

        composer.darkenNonTargeted();
        try {
          // Both meshes are treated as non-targets for the bloom pass — their
          // emissive is left at the original (non-emissive) value, and they
          // are material-swapped to opaque black (the cubes are opaque) so
          // nothing contributes to the bloom render. Crucially, the scene
          // background is cleared at the same time, so even with an empty
          // bloom-input there is no fallback to "bloom the whole scene".
          expect(m1.emissive.getHexString()).to.equal('000000');
          expect(m3.emissive.getHexString()).to.equal('000000');
          expect((element[$scene].getObjectByName('Mesh-1') as Mesh)!.material)
              .to.not.equal(m1);
          expect((element[$scene].getObjectByName('Mesh-3') as Mesh)!.material)
              .to.not.equal(m3);
        } finally {
          composer.restoreNonTargeted();
        }
      });

  test(
      'hides — rather than blackens — non-targeted meshes ' +
          '(regression: a transparent non-target in front of a targeted ' +
          'emissive mesh — e.g. a tail-light\'s outer red glass — must not ' +
          'turn opaque-black during the bloom pass and occlude the target)',
      async () => {
        // Targeted emissive "LED" mesh.
        const ledMaterial = new MeshStandardMaterial({color: '#000000'});
        ledMaterial.name = 'TaillightLED';
        const led = new Mesh(new BoxGeometry(), ledMaterial);
        led.name = 'led';
        element[$scene].add(led);

        // Non-targeted, *transparent* glass cover sitting in front of the LED.
        const glassMaterial = new MeshBasicMaterial({color: '#ff0000'});
        glassMaterial.name = 'GlassCover';
        glassMaterial.transparent = true;
        glassMaterial.opacity = 0.5;
        const glass = new Mesh(new BoxGeometry(), glassMaterial);
        glass.name = 'glass';
        element[$scene].add(glass);

        element.setBloomTargets(
            [{material: 'TaillightLED', color: '#ff0000', intensity: 4}]);
        element.bloom = true;
        await timePasses();

        const composer = getComposer(element);
        composer.darkenNonTargeted();
        try {
          // Glass is hidden, so it does not occlude the LED in the bloom
          // pass. (Replacing it with an opaque black material — the previous
          // behaviour — would silently kill the bloom on this kind of model.)
          expect(glass.visible).to.equal(false);
          expect((glass.material as Material)).to.equal(glassMaterial);
          expect(glassMaterial.transparent).to.equal(true);

          // LED is still visible, with its emissive boosted by the bloom.
          expect(led.visible).to.equal(true);
          expect(ledMaterial.emissive.getHexString()).to.equal('ff0000');
        } finally {
          composer.restoreNonTargeted();
        }

        // After restore the glass is visible and untouched.
        expect(glass.visible).to.equal(true);
        expect(glassMaterial.opacity).to.equal(0.5);
      });

  test(
      'occludes — rather than hides — opaque non-targeted meshes ' +
          '(regression: the bloom of a targeted mesh on the *back* of an ' +
          'opaque model — e.g. a car\'s rear tail-light — must not leak ' +
          'through the front of the body when viewed from the opposite ' +
          'side, as if the model were transparent)',
      async () => {
        // Targeted emissive "rear LED" mesh.
        const ledMaterial = new MeshStandardMaterial({color: '#000000'});
        ledMaterial.name = 'RearLED';
        const led = new Mesh(new BoxGeometry(), ledMaterial);
        led.name = 'led';
        element[$scene].add(led);

        // Non-targeted, *opaque* body panel sitting between the LED and the
        // camera (e.g. the rest of the car body when viewed from the front).
        const bodyMaterial = new MeshStandardMaterial({color: '#ffffff'});
        bodyMaterial.name = 'Body';
        const body = new Mesh(new BoxGeometry(), bodyMaterial);
        body.name = 'body';
        element[$scene].add(body);

        element.setBloomTargets(
            [{material: 'RearLED', color: '#ff0000', intensity: 4}]);
        element.bloom = true;
        await timePasses();

        const composer = getComposer(element);
        composer.darkenNonTargeted();
        try {
          // Opaque body is *not* hidden — it stays visible with an opaque
          // black material so it still occludes the LED behind it. Hiding
          // it instead would let the bloom shine through the body and the
          // model would look transparent from the wrong angle.
          expect(body.visible).to.equal(true);
          expect((body.material as Material)).to.not.equal(bodyMaterial);
          expect((body.material as Material).type)
              .to.match(/^MeshBasicMaterial/);

          // Targeted LED is still visible and emissive.
          expect(led.visible).to.equal(true);
          expect(ledMaterial.emissive.getHexString()).to.equal('ff0000');
        } finally {
          composer.restoreNonTargeted();
        }

        // After restore, the body's original material is back.
        expect(body.material).to.equal(bodyMaterial);
        expect(body.visible).to.equal(true);
      });

  test(
      'dispose() does not permanently null the scene background ' +
          '(regression for the "skybox goes black after rebuild" bug)',
      async () => {
        addCubeMesh(element, 'Mesh-1');

        element.setBloomTargets(
            [{mesh: 'Mesh-1', color: '#ff0000', intensity: 1}]);
        element.bloom = true;
        await timePasses();

        const composer = getComposer(element);

        // The implementation only restores backgrounds it actually saved. We
        // run a manual darken/restore (mirroring what render() does) so the
        // composer ends up with savedBackground=null and hasDarkenedState=
        // false — the dangerous state for the previous bug.
        composer.darkenNonTargeted();
        composer.restoreNonTargeted();
        expect(composer.hasDarkenedState).to.equal(false);
        expect(composer.savedBackground).to.equal(null);

        // Set a recognizable background AFTER the darken/restore cycle so the
        // model-viewer's own skybox plumbing (which touches the background
        // during initial updated()) cannot interfere.
        const skybox = new Color('#112233');
        element[$scene].background = skybox;

        // dispose() previously called restoreNonTargeted() unconditionally,
        // which would write the now-null savedBackground onto the live scene
        // and permanently blank the skybox. The fix gates restoreNonTargeted
        // on hasDarkenedState so dispose() outside a render cycle is a no-op
        // for the background.
        composer.dispose();

        expect(element[$scene].background).to.equal(skybox);
      });

  test('smart quality lowers MSAA while the camera is moving', async () => {
    addCubeMesh(element, 'Mesh-1');

    element.bloomQuality = 'smart';
    element.bloomMsaa = 8;
    element.setBloomTargets([{mesh: 'Mesh-1'}]);
    element.bloom = true;
    await timePasses();

    element.dispatchEvent(new CustomEvent('camera-change'));
    await timePasses();

    expect(getComposer(element).activeMsaa).to.equal(0);
  });
});
