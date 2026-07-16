import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AnnotationModel,
  parseHexColor,
  transformPoint,
} from '../../src/capture/annotationModel.ts';

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

test('pointer tool does not start an annotation stroke', () => {
  const model = new AnnotationModel();
  model.setTool('pointer');
  assert.equal(model.begin({ x: 10, y: 10 }), false);
  assert.equal(model.hasAnnotations, false);
});
