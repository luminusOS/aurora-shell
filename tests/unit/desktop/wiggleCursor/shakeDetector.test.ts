import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KEEP_SHAKE, ShakeDetector } from '../../../../src/desktop/wiggleCursor/shakeDetector.ts';

function shake(detector: ShakeDetector, vertical = false, start = 0, steps = 1): boolean {
  let detected = false;
  for (let stroke = 0; stroke < 8; stroke++) {
    for (let step = 0; step < steps; step++) {
      const fraction = (step + 1) / steps;
      const position = stroke % 2 === 0 ? 100 * fraction : 100 * (1 - fraction);
      const time = start + stroke * 65 + fraction * 65;
      detected =
        detector.update(vertical ? 0 : position, vertical ? position : 0, time) || detected;
    }
  }
  return detected;
}

describe('ShakeDetector while keeping the cursor enlarged', () => {
  const zigzag = (detector: ShakeDetector, strokes: number, length = 90, step = 70) => {
    const results: boolean[] = [];
    for (let i = 0; i <= strokes; i++) results.push(detector.update((i % 2) * length, 0, i * step));
    return results;
  };

  it('needs only two strokes', () => {
    assert.deepEqual(zigzag(new ShakeDetector(KEEP_SHAKE), 2), [false, false, true]);
  });

  it('keeps reporting every further stroke instead of starting over', () => {
    assert.deepEqual(zigzag(new ShakeDetector(KEEP_SHAKE), 6), [
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it('keeps reporting while a stroke is still being drawn', () => {
    const detector = new ShakeDetector(KEEP_SHAKE);
    zigzag(detector, 2);

    assert.ok(detector.update(20, 0, 250));
  });

  it('stops once the pointer sweeps away in one direction', () => {
    const detector = new ShakeDetector(KEEP_SHAKE);
    zigzag(detector, 4);

    let stillShaking = false;
    for (let i = 1; i <= 8; i++) stillShaking = detector.update(i * 60, 0, 300 + i * 30);

    assert.equal(stillShaking, false);
  });

  it('stops after a long pause, as the history ages out', () => {
    const detector = new ShakeDetector(KEEP_SHAKE);
    zigzag(detector, 4);

    assert.equal(detector.update(500, 0, 2000), false);
    assert.equal(detector.update(540, 0, 2070), false);
  });

  it('does not count a single move or a small overshoot as shaking', () => {
    const detector = new ShakeDetector(KEEP_SHAKE);
    const results = [
      detector.update(0, 0, 0),
      detector.update(300, 0, 100),
      detector.update(280, 0, 180),
    ];

    assert.deepEqual(results, [false, false, false]);
  });

  it('ignores a tiny wiggle under 30 pixels', () => {
    const detector = new ShakeDetector(KEEP_SHAKE);

    assert.deepEqual(zigzag(detector, 6, 20, 60), [
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('starts over after a reset', () => {
    const detector = new ShakeDetector(KEEP_SHAKE);
    zigzag(detector, 4);
    detector.reset();

    assert.deepEqual(zigzag(detector, 2, 90, 70).map(Boolean), [false, false, true]);
  });
});

describe('ShakeDetector', () => {
  it('detects deliberate horizontal and vertical shakes', () => {
    assert.ok(shake(new ShakeDetector()));
    assert.ok(shake(new ShakeDetector(), true));
  });

  it('accepts high-frequency motion without changing the gesture', () => {
    for (const samplesPerStroke of [1, 10, 40, 65, 100])
      assert.ok(
        shake(new ShakeDetector(), false, 0, samplesPerStroke),
        `${samplesPerStroke} samples`,
      );
  });

  it('detects a brisk shake of only four short strokes', () => {
    const detector = new ShakeDetector();
    let detected = false;
    for (let i = 0; i < 5; i++) detected = detector.update((i % 2) * 90, 0, i * 70) || detected;
    assert.ok(detected);
  });

  it('detects a compact shake of four 40 pixel strokes', () => {
    const detector = new ShakeDetector();
    let detected = false;
    for (let i = 0; i < 5; i++) detected = detector.update((i % 2) * 40, 0, i * 60) || detected;
    assert.ok(detected);
  });

  it('rejects overshoot-and-correct navigation toward a target', () => {
    const detector = new ShakeDetector();
    let detected = false;
    for (const [x, time] of [
      [0, 0],
      [400, 120],
      [340, 200],
      [380, 280],
      [360, 360],
    ] as const)
      detected = detector.update(x, 0, time) || detected;
    assert.equal(detected, false);
  });

  it('rejects a single back-and-forth', () => {
    const detector = new ShakeDetector();
    let detected = false;
    for (const [x, time] of [
      [0, 0],
      [200, 100],
      [0, 200],
    ] as const)
      detected = detector.update(x, 0, time) || detected;
    assert.equal(detected, false);
  });

  it('rejects slow scrubbing whose strokes leave the detection window', () => {
    const detector = new ShakeDetector();
    let detected = false;
    for (let i = 0; i < 12; i++) detected = detector.update((i % 2) * 90, 0, i * 300) || detected;
    assert.equal(detected, false);
  });

  it('rejects only three strokes, however wide', () => {
    const detector = new ShakeDetector();
    let detected = false;
    for (let i = 0; i < 4; i++) detected = detector.update((i % 2) * 90, 0, i * 70) || detected;
    assert.equal(detected, false);
  });

  it('starts over after a detection, so one shake fires once', () => {
    const detector = new ShakeDetector();
    const fired: boolean[] = [];
    for (let i = 0; i < 8; i++) fired.push(detector.update((i % 2) * 90, 0, i * 70));
    assert.deepEqual(fired, [false, false, false, false, true, false, false, false]);
  });

  it('accepts a deliberate shake at a relaxed 150 ms per stroke', () => {
    const detector = new ShakeDetector();
    let detected = false;
    for (let i = 0; i < 5; i++) detected = detector.update((i % 2) * 90, 0, i * 150) || detected;
    assert.ok(detected);
  });

  it('judges the path against its bounding box: drifting zigzag at the 3.0 ratio', () => {
    const zigzag = (drift: number) => {
      const detector = new ShakeDetector();
      let detected = false;
      for (let i = 0; i < 5; i++)
        detected = detector.update((i % 2) * 100, i * drift, i * 70) || detected;
      return detected;
    };

    assert.equal(zigzag(25), false);
    assert.equal(zigzag(15), true);
  });

  it('rejects a tiny wiggle whose box is under 30 pixels, even with many strokes', () => {
    const detector = new ShakeDetector();
    let detected = false;
    for (let i = 0; i < 9; i++) detected = detector.update((i % 2) * 25, 0, i * 60) || detected;
    assert.equal(detected, false);
  });

  it('detects a compact four-stroke shake at any sampling rate', () => {
    for (const samplesPerStroke of [1, 5, 65]) {
      const detector = new ShakeDetector();
      let detected = detector.update(0, 0, 0);
      for (let stroke = 0; stroke < 4; stroke++) {
        for (let step = 1; step <= samplesPerStroke; step++) {
          const fraction = step / samplesPerStroke;
          const x = stroke % 2 === 0 ? 35 * fraction : 35 * (1 - fraction);
          detected = detector.update(x, 0, stroke * 65 + fraction * 65) || detected;
        }
      }
      assert.ok(detected, `${samplesPerStroke} samples per stroke`);
    }
  });

  it('detects a minimal shake right after crossing the screen', () => {
    const detector = new ShakeDetector();
    for (let i = 0; i <= 17; i++) assert.equal(detector.update(i * 30, 350, i * 10), false);

    let detected = false;
    for (let i = 0; i < 5; i++)
      detected = detector.update(400 + (i % 2) * 100, 350, 200 + i * 60) || detected;

    assert.ok(detected);
  });

  it('does not treat one back-and-forth after a long sweep as a shake', () => {
    const detector = new ShakeDetector();
    for (let i = 0; i <= 17; i++) detector.update(i * 30, 350, i * 10);

    let detected = false;
    for (let i = 0; i < 3; i++)
      detected = detector.update(400 + (i % 2) * 100, 350, 200 + i * 60) || detected;

    assert.equal(detected, false);
  });

  it('detects a shake immediately after an ordinary long sweep', () => {
    const detector = new ShakeDetector();
    for (let i = 0; i < 18; i++) assert.equal(detector.update(i * 30, 350, i * 10), false);
    let detected = false;
    for (let i = 0; i < 9; i++)
      detected = detector.update(400 + (i % 2) * 100, 350, 200 + i * 60) || detected;
    assert.ok(detected);
  });

  it('ignores perpendicular pixel noise on a high-frequency shake', () => {
    const detector = new ShakeDetector();
    let detected = false;
    for (let i = 0; i < 800; i++) {
      const stroke = Math.floor(i / 100);
      const x = stroke % 2 === 0 ? i % 100 : 100 - (i % 100);
      detected = detector.update(x, i % 2, i * 0.65) || detected;
    }
    assert.ok(detected);
  });

  it('rejects straight sweeps, stationary samples, and tiny jitter', () => {
    for (const motion of [(i: number) => i * 20, () => 10, (i: number) => i % 3]) {
      const detector = new ShakeDetector();
      for (let i = 0; i < 100; i++) assert.equal(detector.update(motion(i), 0, i * 10), false);
    }
  });

  it('rejects slow reversals outside the detection window', () => {
    const detector = new ShakeDetector();
    for (let i = 0; i < 20; i++) assert.equal(detector.update((i % 2) * 100, 0, i * 400), false);
  });

  it('discards monitor warps and backwards timestamps', () => {
    const detector = new ShakeDetector();
    for (let i = 0; i < 20; i++) assert.equal(detector.update((i % 2) * 2000, 0, i * 20), false);
    detector.reset();
    for (let i = 20; i > 0; i--) assert.equal(detector.update((i % 2) * 100, 0, i * 20), false);
  });

  it('resets between independent gestures', () => {
    const detector = new ShakeDetector();
    assert.ok(shake(detector));
    detector.reset();
    assert.equal(detector.update(0, 0, 900), false);
    assert.ok(shake(detector, false, 1000));
  });

  it('handles sustained jitter without accumulating a false shake', () => {
    const detector = new ShakeDetector();
    for (let i = 0; i < 10000; i++) assert.equal(detector.update(i % 4, i % 3, i), false);
    assert.ok(shake(detector, false, 11000));
  });
});
