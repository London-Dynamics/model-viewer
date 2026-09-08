import '../../../components/camera_settings/components/zoom.js';

import {expect} from 'chai';

import {ZooomLimits} from '../../../components/camera_settings/components/zoom.js';
import {dispatchConfig, dispatchZoomLimits, getConfig,} from '../../../components/config/reducer.js';
import {dispatchReset} from '../../../reducers.js';
import {reduxStore} from '../../../space_opera_base.js';

suite('zoom limits editor test', () => {
  let zoomLimits: ZooomLimits;

  setup(async () => {
    reduxStore.dispatch(dispatchReset());
    zoomLimits = new ZooomLimits();
    document.body.appendChild(zoomLimits);
    await zoomLimits.updateComplete;
  });

  teardown(() => {
    zoomLimits.remove();
  });

  test('stores complete radius and field-of-view bounds', () => {
    reduxStore.dispatch(dispatchZoomLimits({
      minRadius: 1.25,
      maxRadius: 8.5,
      minFov: 18,
      maxFov: 52,
    }));

    const config = getConfig(reduxStore.getState());
    expect(config.minCameraOrbit).to.equal('auto auto 1.25m');
    expect(config.maxCameraOrbit).to.equal('auto auto 8.5m');
    expect(config.minFov).to.equal('18deg');
    expect(config.maxFov).to.equal('52deg');
  });

  test('hydrates its controls from saved config', async () => {
    reduxStore.dispatch(dispatchZoomLimits({
      minRadius: 1.25,
      maxRadius: 8.5,
      minFov: 18,
      maxFov: 52,
    }));
    await zoomLimits.updateComplete;

    expect(zoomLimits.enabled).to.equal(true);
    expect(zoomLimits.minRadius).to.equal(1.25);
    expect(zoomLimits.maxRadius).to.equal(8.5);
    expect(zoomLimits.minFov).to.equal(18);
    expect(zoomLimits.maxFov).to.equal(52);
  });

  test('clears zoom tokens without discarding yaw and pitch limits', () => {
    reduxStore.dispatch(dispatchConfig({
      minCameraOrbit: '-30deg 20deg 1m',
      maxCameraOrbit: '30deg 120deg 8m',
      minFov: '18deg',
      maxFov: '52deg',
    }));

    reduxStore.dispatch(dispatchZoomLimits());

    const config = getConfig(reduxStore.getState());
    expect(config.minCameraOrbit).to.equal('-30deg 20deg auto');
    expect(config.maxCameraOrbit).to.equal('30deg 120deg auto');
    expect(config.minFov).to.equal(undefined);
    expect(config.maxFov).to.equal(undefined);
  });
});
