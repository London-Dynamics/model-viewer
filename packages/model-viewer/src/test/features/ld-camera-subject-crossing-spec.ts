import {expect} from 'chai';
import {Box3, Vector3} from 'three';

import {CameraAnimationOptions, CameraPose, classifySubjectCrossing, sampleCameraTransition,} from '../../features/ld-camera.js';

/**
 * Mitsubishi Triton stand-in. Exterior eye looks at the cab; interior eye sits
 * inside the box and looks out along a target ~11 m away.
 */
const SUBJECT =
    new Box3(new Vector3(-3.36, 0, -1.05), new Vector3(3.87, 1.9, 1.05));

function tritonEnter(): {start: CameraPose; end: CameraPose} {
  return {
    start: {
      position: new Vector3(-8.91, 1.42, -6.28),
      target: new Vector3(0.087, 0.969, 0.001),
      fov: 30,
    },
    end: {
      position: new Vector3(0.189, 1.438, 0.080),
      target: new Vector3(-10.775, 0.822, 0.189),
      fov: 70,
    },
  };
}

function viewDirection(pose: CameraPose): Vector3 {
  return pose.target.clone().sub(pose.position).normalize();
}

function distanceToSegment(point: Vector3, a: Vector3, b: Vector3): number {
  const ab = b.clone().sub(a);
  const denom = ab.lengthSq();
  const u = denom < 1e-12 ?
      0 :
      Math.min(1, Math.max(0, point.clone().sub(a).dot(ab) / denom));
  return point.distanceTo(a.clone().addScaledVector(ab, u));
}

function samples(
    start: CameraPose,
    end: CameraPose,
    subject: Box3|null,
    options: CameraAnimationOptions,
    count = 40): {t: number; pose: CameraPose}[] {
  const out: {t: number; pose: CameraPose}[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    out.push({
      t,
      pose: sampleCameraTransition(start, end, subject, options, t),
    });
  }
  return out;
}

function viewChange(frames: {t: number; pose: CameraPose}[], split: number):
    {early: number; late: number} {
  let early = 0;
  let late = 0;
  for (let i = 1; i < frames.length; i++) {
    const delta = viewDirection(frames[i - 1].pose)
                      .angleTo(viewDirection(frames[i].pose));
    if (frames[i].t > split) {
      late += delta;
    } else {
      early += delta;
    }
  }
  return {early, late};
}

const ENTER_OPTIONS: CameraAnimationOptions = {
  transitionStyle: 'direct',
  avoidSubject: true,
  avoidMargin: 0.25,
};

suite('subject crossing camera transitions', () => {
  const center = SUBJECT.getCenter(new Vector3());

  test('classifies eyes against the subject bounds', () => {
    const {start, end} = tritonEnter();
    expect(classifySubjectCrossing(start.position, end.position, SUBJECT))
        .to.equal('enter');
    expect(classifySubjectCrossing(end.position, start.position, SUBJECT))
        .to.equal('exit');
    expect(classifySubjectCrossing(end.position, end.position, SUBJECT))
        .to.equal('interior');

    const outsideA = new Vector3(-8, 2, -6);
    const outsideB = new Vector3(8, 2, 6);
    expect(classifySubjectCrossing(outsideA, outsideB, SUBJECT))
        .to.equal('exterior');
    expect(classifySubjectCrossing(outsideA, outsideB, null))
        .to.equal('exterior');
    expect(classifySubjectCrossing(outsideA, outsideB, new Box3()))
        .to.equal('exterior');

    // Margin growth must not reclassify an eye that is still outside the model.
    const justOutside = new Vector3(-3.56, 1, 0);
    expect(SUBJECT.containsPoint(justOutside)).to.equal(false);
    expect(classifySubjectCrossing(outsideA, justOutside, SUBJECT))
        .to.equal('exterior');
  });

  test('exterior direct still detours around a blocking subject', () => {
    const subject = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const start: CameraPose = {
      position: new Vector3(-5, 0, 0),
      target: new Vector3(0, 0, 0),
      fov: 30,
    };
    const end: CameraPose = {
      position: new Vector3(5, 0, 0),
      target: new Vector3(0, 0.2, 0),
      fov: 40,
    };
    expect(classifySubjectCrossing(start.position, end.position, subject))
        .to.equal('exterior');

    const mid = sampleCameraTransition(
        start,
        end,
        subject,
        {transitionStyle: 'direct', avoidSubject: true},
        0.5);
    const straight = start.position.clone().lerp(end.position, 0.5);
    expect(mid.position.distanceTo(straight)).to.be.greaterThan(1);
    expect(subject.containsPoint(mid.position)).to.equal(false);
    expect(mid.fov).to.be.closeTo(35, 1e-6);
    expect(mid.position.distanceTo(start.position)).to.be.greaterThan(1);
  });

  test('exterior staggered keeps spherical channel timing', () => {
    const subject =
        new Box3(new Vector3(-0.4, -0.4, -0.4), new Vector3(0.4, 0.4, 0.4));
    const startTarget = new Vector3(0, 0, 0);
    const endTarget = new Vector3(0.2, 0.1, -0.1);
    const start: CameraPose = {
      position:
          new Vector3().setFromSphericalCoords(4, 1.2, 0.4).add(startTarget),
      target: startTarget.clone(),
      fov: 30,
    };
    const end: CameraPose = {
      position:
          new Vector3().setFromSphericalCoords(8, 1.0, 1.5).add(endTarget),
      target: endTarget.clone(),
      fov: 50,
    };
    expect(classifySubjectCrossing(start.position, end.position, subject))
        .to.equal('exterior');

    const pose = sampleCameraTransition(
        start,
        end,
        subject,
        {transitionStyle: 'staggered', avoidSubject: true},
        0.5);
    const tOrbit = (0.5 - 0.1) / 0.9;
    const tRadius = 0.5 / 0.75;
    const expectedTarget = startTarget.clone().lerp(endTarget, tOrbit);
    const expected = new Vector3()
                         .setFromSphericalCoords(
                             4 + (8 - 4) * tRadius,
                             1.2 + (1.0 - 1.2) * tOrbit,
                             0.4 + (1.5 - 0.4) * tOrbit)
                         .add(expectedTarget);
    expect(pose.position.distanceTo(expected)).to.be.lessThan(1e-4);
    expect(pose.target.distanceTo(expectedTarget)).to.be.lessThan(1e-4);
    expect(pose.fov).to.be.closeTo(30 + 20 * tRadius, 1e-4);

    const straight = start.position.clone().lerp(end.position, 0.5);
    expect(pose.position.distanceTo(straight)).to.be.greaterThan(0.2);
    expect(subject.containsPoint(pose.position)).to.equal(false);
  });

  test('entering the subject flies straight in and turns at the end', () => {
    const {start, end} = tritonEnter();
    const frames = samples(start, end, SUBJECT, ENTER_OPTIONS);

    expect(frames[0].pose.position.distanceTo(start.position))
        .to.be.lessThan(1e-6);
    expect(viewDirection(frames[0].pose).angleTo(viewDirection(start)))
        .to.be.lessThan(1e-4);
    expect(frames[0].pose.target.distanceTo(start.target)).to.be.lessThan(1e-3);
    expect(frames[0].pose.fov).to.be.closeTo(30, 1e-6);

    const last = frames[frames.length - 1].pose;
    expect(last.position.distanceTo(end.position)).to.be.lessThan(1e-6);
    expect(viewDirection(last).angleTo(viewDirection(end)))
        .to.be.lessThan(1e-4);
    expect(last.target.distanceTo(end.target)).to.be.lessThan(1e-3);
    expect(last.fov).to.be.closeTo(70, 1e-6);

    let previous = Number.POSITIVE_INFINITY;
    let firstInside = -1;
    for (const frame of frames) {
      const distance = frame.pose.position.distanceTo(end.position);
      expect(distance).to.be.lessThan(previous - 1e-6);
      previous = distance;
      expect(
          distanceToSegment(frame.pose.position, start.position, end.position))
          .to.be.lessThan(1e-4);
      expect(frame.pose.fov).to.be.closeTo(30 + 40 * frame.t, 1e-6);
      const inside = SUBJECT.containsPoint(frame.pose.position);
      if (inside && firstInside < 0) {
        firstInside = frame.t;
      }
      if (!inside) {
        const toCenter = center.clone().sub(frame.pose.position).normalize();
        const halfFov = (frame.pose.fov! * Math.PI) / 360;
        expect(viewDirection(frame.pose).angleTo(toCenter))
            .to.be.lessThan(halfFov);
        expect(viewDirection(frame.pose).dot(toCenter)).to.be.greaterThan(0);
      }
    }
    expect(firstInside).to.be.at.least(0.7);
    expect(SUBJECT.containsPoint(frames[0].pose.position)).to.equal(false);
    expect(SUBJECT.containsPoint(last.position)).to.equal(true);

    const change = viewChange(frames, 0.7);
    expect(change.late).to.be.greaterThan(change.early * 3);
    expect(change.late).to.be.greaterThan(0.7 * (change.early + change.late));

    // Staggered scheduling must not take over once the destination is inside.
    const staggered = sampleCameraTransition(
        start,
        end,
        SUBJECT,
        {transitionStyle: 'staggered', avoidSubject: true},
        0.5);
    const direct =
        sampleCameraTransition(start, end, SUBJECT, ENTER_OPTIONS, 0.5);
    expect(staggered.position.distanceTo(direct.position)).to.be.lessThan(1e-6);
    expect(viewDirection(staggered).angleTo(viewDirection(direct)))
        .to.be.lessThan(1e-6);
  });

  test('leaving the subject turns first, then pulls straight out', () => {
    const entered = tritonEnter();
    const start = entered.end;
    const end = entered.start;
    const frames = samples(start, end, SUBJECT, {
      transitionStyle: 'staggered',
      avoidSubject: true,
    });
    const travel = start.position.distanceTo(end.position);
    const finalDir = viewDirection(end);

    expect(frames[0].pose.position.distanceTo(start.position))
        .to.be.lessThan(1e-6);
    expect(viewDirection(frames[0].pose).angleTo(viewDirection(start)))
        .to.be.lessThan(1e-4);
    const last = frames[frames.length - 1].pose;
    expect(last.position.distanceTo(end.position)).to.be.lessThan(1e-6);
    expect(viewDirection(last).angleTo(finalDir)).to.be.lessThan(1e-4);
    expect(last.fov).to.be.closeTo(30, 1e-6);

    let previous = travel;
    let turnedBeforePullingOut = false;
    for (const frame of frames) {
      const distance = frame.pose.position.distanceTo(end.position);
      expect(distance).to.be.at.most(previous + 1e-6);
      previous = distance;
      expect(
          distanceToSegment(frame.pose.position, start.position, end.position))
          .to.be.lessThan(1e-4);
      const inside = SUBJECT.containsPoint(frame.pose.position);
      const toFinal = viewDirection(frame.pose).angleTo(finalDir);
      if (toFinal < (5 * Math.PI) / 180 &&
          frame.pose.position.distanceTo(start.position) < travel * 0.15) {
        turnedBeforePullingOut = true;
      }
      if (!inside) {
        expect(toFinal).to.be.lessThan((2 * Math.PI) / 180);
        const toCenter = center.clone().sub(frame.pose.position).normalize();
        const halfFov = (frame.pose.fov! * Math.PI) / 360;
        expect(viewDirection(frame.pose).angleTo(toCenter))
            .to.be.lessThan(halfFov);
      }
    }
    expect(turnedBeforePullingOut).to.equal(true);
    expect(SUBJECT.containsPoint(
               sampleCameraTransition(start, end, SUBJECT, ENTER_OPTIONS, 0.25)
                   .position))
        .to.equal(true);

    const change = viewChange(frames, 0.4);
    expect(change.early).to.be.greaterThan(change.late * 3);

    const direct = samples(start, end, SUBJECT, ENTER_OPTIONS);
    expect(direct[10].pose.position.distanceTo(frames[10].pose.position))
        .to.be.lessThan(1e-6);
  });

  test('moves that stay inside do not detour out of the subject', () => {
    const start: CameraPose = {
      position: new Vector3(0.1, 1.1, 0.0),
      target: new Vector3(-5, 1.0, 0.2),
      fov: 60,
    };
    const end: CameraPose = {
      position: new Vector3(1.2, 1.3, 0.4),
      target: new Vector3(1.2, 1.0, -4),
      fov: 70,
    };
    expect(classifySubjectCrossing(start.position, end.position, SUBJECT))
        .to.equal('interior');
    const mid = sampleCameraTransition(
        start,
        end,
        SUBJECT,
        {transitionStyle: 'direct', avoidSubject: true},
        0.5);
    const straight = start.position.clone().lerp(end.position, 0.5);
    expect(mid.position.distanceTo(straight)).to.be.lessThan(1e-4);
    expect(SUBJECT.containsPoint(mid.position)).to.equal(true);
  });
});
