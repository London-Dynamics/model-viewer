/* @license
 * Copyright 2026 London Dynamics. All Rights Reserved.
 */

import {expect} from 'chai';
import {
  normalizeSignedAngleDelta,
  resolveRotationDiscTickConfig,
  snapRotationYToStepGrid,
} from '../../features/ld-modular/rotation-control-disc.js';

const deg = (degrees: number) => (degrees * Math.PI) / 180;

suite('ld-modular rotation control disc', () => {
  test('normalizes signed angle deltas to shortest arc', () => {
    const nearWrap = normalizeSignedAngleDelta(Math.PI * 1.5);
    expect(nearWrap).to.be.closeTo(-Math.PI * 0.5, 1e-6);
  });

  test('snapRotationYToStepGrid snaps to absolute step multiples', () => {
    expect(snapRotationYToStepGrid(45, 90)).to.equal(90);
    expect(snapRotationYToStepGrid(45, 45)).to.equal(45);
    expect(snapRotationYToStepGrid(47, 5)).to.equal(45);
    expect(snapRotationYToStepGrid(3, 5)).to.equal(5);
    expect(snapRotationYToStepGrid(90, 90)).to.equal(90);
  });

  test('snapRotationYToStepGrid passes through when step is zero', () => {
    expect(snapRotationYToStepGrid(-7.25, 0)).to.equal(-7.25);
  });

  test('snapRotationYToStepGrid supports major/fine step changes on same cumulative angle', () => {
    const startY = 0;
    const cumulativeDeg = 90;
    const rawTargetY = startY + cumulativeDeg;
    expect(snapRotationYToStepGrid(rawTargetY, 90)).to.equal(90);
    expect(snapRotationYToStepGrid(rawTargetY, 45)).to.equal(45);
    expect(snapRotationYToStepGrid(rawTargetY, 90)).to.equal(90);
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
