/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  consumeQuantizedRotationDelta,
  normalizeSignedAngleDelta,
} from '../../features/ld-modular/rotation-control-disc.js';

suite('ld-modular rotation control disc', () => {
  test('normalizes signed angle deltas to shortest arc', () => {
    const nearWrap = normalizeSignedAngleDelta(Math.PI * 1.5);
    expect(nearWrap).to.be.closeTo(-Math.PI * 0.5, 1e-6);
  });

  test('consumes quantized deltas for step mode', () => {
    const result = consumeQuantizedRotationDelta(23, 10);
    expect(result.consumedDelta).to.equal(20);
    expect(result.remaining).to.equal(3);
  });

  test('passes through continuous mode when step is zero', () => {
    const result = consumeQuantizedRotationDelta(-7.25, 0);
    expect(result.consumedDelta).to.equal(-7.25);
    expect(result.remaining).to.equal(0);
  });
});
