/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  consumeQuantizedRotationDelta,
  normalizeSignedAngleDelta,
  resolveRotationDiscTickConfig,
} from '../../features/ld-modular/rotation-control-disc.js';

const deg = (degrees: number) => (degrees * Math.PI) / 180;

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

  test('resolveRotationDiscTickConfig uses defaults when neither step is set', () => {
    const config = resolveRotationDiscTickConfig(0, 0);
    expect(config.majorStepRad).to.be.closeTo(deg(45), 1e-6);
    expect(config.minorStepRad).to.be.closeTo(deg(15), 1e-6);
    expect(config.showMinorTicks).to.equal(true);
  });

  test('resolveRotationDiscTickConfig shows major ticks only when major step is set', () => {
    const config = resolveRotationDiscTickConfig(90, 0);
    expect(config.majorStepRad).to.be.closeTo(deg(90), 1e-6);
    expect(config.showMinorTicks).to.equal(false);
  });

  test('resolveRotationDiscTickConfig uses fine step for minor ticks', () => {
    const config = resolveRotationDiscTickConfig(0, 10);
    expect(config.majorStepRad).to.be.closeTo(deg(45), 1e-6);
    expect(config.minorStepRad).to.be.closeTo(deg(10), 1e-6);
    expect(config.showMinorTicks).to.equal(true);
  });

  test('resolveRotationDiscTickConfig applies both major and fine steps', () => {
    const config = resolveRotationDiscTickConfig(90, 10);
    expect(config.majorStepRad).to.be.closeTo(deg(90), 1e-6);
    expect(config.minorStepRad).to.be.closeTo(deg(10), 1e-6);
    expect(config.showMinorTicks).to.equal(true);
  });
});
