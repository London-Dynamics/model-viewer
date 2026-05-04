import {expect} from '@esm-bundle/chai';
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial
} from 'three';

import {ModelViewerElement} from '../../model-viewer.js';
import {$scene} from '../../model-viewer-base.js';
import {timePasses} from '../../utilities.js';

suite('LD Bloom', () => {
  let element: ModelViewerElement;

  setup(() => {
    element = new ModelViewerElement();
    document.body.appendChild(element);
  });

  teardown(() => {
    element.remove();
  });

  test('applies bloom material settings to matching material names', async () => {
    const material = new MeshStandardMaterial({color: '#202020'});
    material.name = 'PuzzleGlow';
    const mesh = new Mesh(new BoxGeometry(), material);
    mesh.name = 'PuzzlePiece';
    element[$scene].add(mesh);

    element.setBloomTargets(
        [{material: 'PuzzleGlow', color: '#00ffcc', intensity: 4}]);
    element.bloom = true;
    await timePasses();

    expect(material.emissive.getHexString()).to.equal('00ffcc');
    expect(material.emissiveIntensity).to.equal(4);
    expect(material.toneMapped).to.equal(false);
  });

  test('applies bloom material settings to matching mesh names', async () => {
    const material = new MeshBasicMaterial({color: '#202020'});
    material.name = 'PlainMaterial';
    const mesh = new Mesh(new BoxGeometry(), material);
    mesh.name = 'GlowMesh';
    element[$scene].add(mesh);

    element.setBloomTargets(
        [{mesh: 'GlowMesh', color: '#ff6600', intensity: 2}]);
    element.bloom = true;
    await timePasses();

    expect(material.color.getHexString()).to.equal('ff6600');
    expect(material.toneMapped).to.equal(false);
  });

  test('restores material settings when bloom is disabled', async () => {
    const material = new MeshStandardMaterial({color: '#123456'});
    material.name = 'RestoredMaterial';
    material.emissive.set('#111111');
    material.emissiveIntensity = 0.5;
    const mesh = new Mesh(new BoxGeometry(), material);
    element[$scene].add(mesh);

    element.setBloomTargets(
        [{material: 'RestoredMaterial', color: '#ffffff', intensity: 8}]);
    element.bloom = true;
    await timePasses();
    element.bloom = false;
    await timePasses();

    expect(material.color.getHexString()).to.equal('123456');
    expect(material.emissive.getHexString()).to.equal('111111');
    expect(material.emissiveIntensity).to.equal(0.5);
    expect(element[$scene].effectRenderer).to.equal(null);
  });

  test('can disable an individual bloom target', async () => {
    const material = new MeshStandardMaterial();
    material.name = 'SwitchableMaterial';
    const mesh = new Mesh(new BoxGeometry(), material);
    element[$scene].add(mesh);

    element.setBloomTargets(
        [{material: 'SwitchableMaterial', color: '#ffffff', intensity: 3}]);
    element.bloom = true;
    await timePasses();
    element.setBloomTargetEnabled('material', 'SwitchableMaterial', false);
    await timePasses();

    expect(material.emissive.getHexString()).to.equal('000000');
    expect(element.getBloomTargets()[0].enabled).to.equal(false);
  });

  test('parses bloom-targets JSON attribute', async () => {
    const material = new MeshStandardMaterial();
    material.name = 'JsonMaterial';
    const mesh = new Mesh(new BoxGeometry(), material);
    element[$scene].add(mesh);

    element.setAttribute(
        'bloom-targets',
        JSON.stringify(
            [{material: 'JsonMaterial', color: '#3366ff', intensity: 5}]));
    element.bloom = true;
    await timePasses();

    expect(material.emissive.getHexString()).to.equal('3366ff');
    expect(element.getBloomTargets()[0].material).to.equal('JsonMaterial');
  });

  test('smart quality lowers MSAA while the camera is moving', async () => {
    const material = new MeshStandardMaterial();
    material.name = 'SmartMaterial';
    const mesh = new Mesh(new BoxGeometry(), material);
    element[$scene].add(mesh);

    element.bloomQuality = 'smart';
    element.bloomMsaa = 8;
    element.setBloomTargets([{material: 'SmartMaterial'}]);
    element.bloom = true;
    await timePasses();
    element.dispatchEvent(new CustomEvent('camera-change'));
    await timePasses();

    const bloomRenderer =
        element[$scene].effectRenderer as unknown as {activeMsaa: number};
    expect(bloomRenderer.activeMsaa).to.equal(0);
  });
});
