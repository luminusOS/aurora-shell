import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnnotationModel, parseHexColor, transformPoint } from '~/capture/annotationModel.ts';

test('annotation model commits useful strokes and ignores degenerate drags', () => {
  const model = new AnnotationModel();
  model.setTool('freehand');

  assert.equal(model.begin({ x: 10, y: 10 }), true);
  model.update({ x: 11, y: 10 });
  assert.equal(model.finish(), false);
  assert.equal(model.hasAnnotations, false);

  model.begin({ x: 10, y: 10 });
  model.update({ x: 20, y: 25 });
  assert.equal(model.finish(), true);
  assert.equal(model.annotations.length, 1);
  assert.deepEqual(model.annotations[0]?.points.at(-1), { x: 20, y: 25 });
});

test('annotation model supports text, stamps, undo, and clear', () => {
  const model = new AnnotationModel();
  assert.equal(model.addText({ x: 2, y: 3 }, '  hello  '), true);
  assert.equal(model.annotations[0]?.text, 'hello');

  model.setTool('stamp');
  model.begin({ x: 10, y: 20 });
  model.begin({ x: 30, y: 40 });
  assert.equal(model.annotations[2]?.counter, 2);
  assert.equal(model.undo(), true);
  model.begin({ x: 50, y: 60 });
  assert.equal(model.annotations[2]?.counter, 2);

  assert.equal(model.clear(), true);
  assert.equal(model.hasAnnotations, false);
  model.begin({ x: 1, y: 1 });
  assert.equal(model.annotations[0]?.counter, 1);
});

test('annotation model commits filled rectangles used by the Gradia-style editor', () => {
  const model = new AnnotationModel();
  model.setTool('solid-rectangle');
  model.begin({ x: 4, y: 8 });
  model.update({ x: 40, y: 32 });
  assert.equal(model.finish(), true);
  assert.equal(model.annotations[0]?.tool, 'solid-rectangle');
});

test('annotation settings and capture transforms are bounded and deterministic', () => {
  const model = new AnnotationModel();
  model.setColor('#3584E4');
  model.setWidth(100);
  assert.equal(model.color, '#3584e4');
  assert.equal(model.width, 24);
  assert.deepEqual(parseHexColor('#ff0000'), [1, 0, 0]);
  assert.equal(parseHexColor('red'), null);
  assert.deepEqual(transformPoint({ x: 110, y: 70 }, { originX: 100, originY: 50, scale: 2 }), {
    x: 20,
    y: 40,
  });
});

test('pointer tool ignores empty space', () => {
  const model = new AnnotationModel();
  model.setTool('pointer');
  assert.equal(model.begin({ x: 10, y: 10 }), false);
  assert.equal(model.hasAnnotations, false);
});

test('pointer tool moves every supported annotation geometry', () => {
  const cases = [
    { tool: 'freehand', hit: { x: 15, y: 15 } },
    { tool: 'highlighter', hit: { x: 15, y: 15 } },
    { tool: 'arrow', hit: { x: 15, y: 15 } },
    { tool: 'rectangle', hit: { x: 15, y: 15 } },
    { tool: 'solid-rectangle', hit: { x: 15, y: 15 } },
  ] as const;

  for (const { tool, hit } of cases) {
    const model = new AnnotationModel();
    model.setTool(tool);
    model.begin({ x: 10, y: 10 });
    model.update({ x: 20, y: 20 });
    model.finish();
    assertMovedBy(model, hit, { x: 7, y: -3 });
  }

  const text = new AnnotationModel();
  text.addText({ x: 10, y: 10 }, 'Aurora');
  assertMovedBy(text, { x: 20, y: 20 }, { x: 7, y: -3 });

  const stamp = new AnnotationModel();
  stamp.setTool('stamp');
  stamp.begin({ x: 10, y: 10 });
  assertMovedBy(stamp, { x: 10, y: 10 }, { x: 7, y: -3 });
});

test('pointer tool moves the topmost annotation and restores a cancelled drag', () => {
  const model = new AnnotationModel();
  model.setTool('solid-rectangle');
  model.begin({ x: 0, y: 0 });
  model.update({ x: 30, y: 30 });
  model.finish();
  model.begin({ x: 10, y: 10 });
  model.update({ x: 40, y: 40 });
  model.finish();

  const firstBefore = structuredClone(model.annotations[0]!.points);
  const secondBefore = structuredClone(model.annotations[1]!.points);
  model.setTool('pointer');
  assert.equal(model.begin({ x: 20, y: 20 }), true);
  model.update({ x: 25, y: 27 });
  assert.deepEqual(model.annotations[0]!.points, firstBefore);
  assert.deepEqual(model.annotations[1]!.points, offsetPoints(secondBefore, 5, 7));

  model.setTool('rectangle');
  assert.deepEqual(model.annotations[1]!.points, secondBefore);
});

function assertMovedBy(
  model: AnnotationModel,
  hit: { x: number; y: number },
  offset: { x: number; y: number },
): void {
  const before = structuredClone(model.annotations[0]!.points);
  model.setTool('pointer');
  assert.equal(model.begin(hit), true);
  assert.equal(model.update({ x: hit.x + offset.x, y: hit.y + offset.y }), true);
  assert.equal(model.finish(), true);
  assert.deepEqual(model.annotations[0]!.points, offsetPoints(before, offset.x, offset.y));
}

function offsetPoints(
  points: readonly { x: number; y: number }[],
  offsetX: number,
  offsetY: number,
): { x: number; y: number }[] {
  return points.map((point) => ({ x: point.x + offsetX, y: point.y + offsetY }));
}
