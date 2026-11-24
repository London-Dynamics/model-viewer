import { expect } from 'chai';

import {
  DEFAULT_VIEWPORT_GIZMO_LABELS,
  resolveViewportGizmoLabels,
} from '../../features/ld-controls/viewport-gizmo.js';
import { ModelViewerElement } from '../../model-viewer.js';
import { timePasses, waitForEvent } from '../../utilities.js';
import { assetPath } from '../helpers.js';

suite('LD viewport gizmo labels', () => {
  suite('resolveViewportGizmoLabels', () => {
    test('returns the default labels when none are given', () => {
      expect(resolveViewportGizmoLabels()).to.deep.equal({
        right: 'RIGHT',
        top: 'TOP',
        front: 'FRONT',
        left: 'LEFT',
        bottom: 'BOTTOM',
        back: 'BACK',
      });
      expect(DEFAULT_VIEWPORT_GIZMO_LABELS.top).to.equal('TOP');
    });

    test('uses custom labels and falls back to defaults when empty', () => {
      const labels = resolveViewportGizmoLabels({top: 'Banana', right: ''});

      expect(labels.top).to.equal('Banana');
      expect(labels.right).to.equal('RIGHT');
      expect(labels.front).to.equal('FRONT');
    });
  });

  suite('model-viewer element', () => {
    let element: ModelViewerElement;

    setup(async () => {
      element = new ModelViewerElement();
      element.cameraControls = true;
      element.interactionPrompt = 'none';
      element.src = assetPath('models/cube.gltf');
      document.body.insertBefore(element, document.body.firstChild);
      await waitForEvent(element, 'poster-dismissed');
      await timePasses();
    });

    teardown(() => {
      if (element.parentNode != null) {
        element.parentNode.removeChild(element);
      }
    });

    test('label attributes set the label properties', async () => {
      element.setAttribute('viewport-gizmo-label-top', 'Banana');
      await element.updateComplete;

      expect(element.viewportGizmoLabelTop).to.equal('Banana');
      expect(element.viewportGizmoLabelRight).to.equal('RIGHT');
    });

    test('a label change rebuilds the gizmo with the new label', async () => {
      element.showViewportGizmo = true;
      await element.updateComplete;
      const before = (element as any).viewportGizmoHandle;
      expect(before).to.not.be.null;

      element.viewportGizmoLabelTop = 'Banana';
      await element.updateComplete;
      const after = (element as any).viewportGizmoHandle;

      expect(after).to.not.be.null;
      expect(after).to.not.equal(before);
      expect(before.canvas.parentElement).to.be.null;
      expect(after.gizmo.options.y.label).to.equal('Banana');
    });
  });
});
