/* eslint camelcase: ["error", { properties: "never", allow: ["^script_"] }] */

import { waitForActorState, waitForCondition } from './testUtils.js';

class FakeEmitter {
  #nextId = 1;
  #handlers = new Map();

  constructor(onConnect = null) {
    this.onConnect = onConnect;
  }

  connect(_signal, callback) {
    if (this.onConnect) this.onConnect();
    const id = this.#nextId++;
    this.#handlers.set(id, callback);
    return id;
  }

  disconnect(id) {
    if (!this.#handlers.delete(id)) throw new Error(`Unknown fake signal handler ${id}`);
  }

  emit() {
    for (const callback of [...this.#handlers.values()]) callback();
  }

  get connectionCount() {
    return this.#handlers.size;
  }
}

class FakeScheduler {
  callback = null;
  removed = [];

  add(_timeoutMs, callback) {
    this.callback = callback;
    return 42;
  }

  remove(sourceId) {
    this.removed.push(sourceId);
    this.callback = null;
  }

  fire() {
    const callback = this.callback;
    this.callback = null;
    callback();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export var METRICS = {};

export async function run() {
  let evaluations = 0;
  const alreadySatisfied = await waitForCondition({
    evaluate: () => {
      evaluations++;
      return 'ready';
    },
    signals: [],
    description: 'already-satisfied condition',
  });
  assert(alreadySatisfied === 'ready', 'The initial condition value was not returned');
  assert(evaluations === 1, 'An already-satisfied condition was evaluated more than once');

  const eventEmitter = new FakeEmitter();
  const successScheduler = new FakeScheduler();
  let eventReady = false;
  const eventWait = waitForCondition({
    evaluate: () => eventReady,
    signals: [[eventEmitter, 'changed']],
    description: 'event-driven condition',
    scheduler: successScheduler,
  });
  eventReady = true;
  eventEmitter.emit();
  await eventWait;
  assert(eventEmitter.connectionCount === 0, 'Signal handler remained connected after success');
  assert(
    successScheduler.removed.join(',') === '42',
    'The success path did not remove its watchdog source exactly once',
  );

  let gapReady = false;
  const gapEmitter = new FakeEmitter(() => {
    gapReady = true;
  });
  let gapEvaluations = 0;
  await waitForCondition({
    evaluate: () => {
      gapEvaluations++;
      return gapReady;
    },
    signals: [[gapEmitter, 'changed']],
    description: 'condition changed during signal connection',
  });
  assert(gapEvaluations === 2, 'The post-connection missed-event check did not run');
  assert(gapEmitter.connectionCount === 0, 'Missed-event handler was not disconnected');

  const timeoutEmitter = new FakeEmitter();
  const timeoutScheduler = new FakeScheduler();
  let timeoutError;
  const timeoutWait = waitForCondition({
    evaluate: () => false,
    signals: [[timeoutEmitter, 'changed']],
    description: 'named watchdog condition',
    timeoutMs: 10,
    scheduler: timeoutScheduler,
  });
  timeoutScheduler.fire();
  try {
    await timeoutWait;
  } catch (error) {
    timeoutError = error;
  }
  assert(timeoutError instanceof Error, 'The watchdog did not reject');
  assert(
    timeoutError.message.includes('named watchdog condition'),
    'The watchdog error omitted the condition description',
  );
  assert(timeoutEmitter.connectionCount === 0, 'Signal handler remained connected after timeout');

  const actor = new FakeEmitter();
  const actorScheduler = new FakeScheduler();
  actor.ready = false;
  const actorWait = waitForActorState(actor, (candidate) => candidate.ready, {
    properties: ['mapped'],
    description: 'fake actor state',
    scheduler: actorScheduler,
  });
  actor.ready = true;
  actor.emit();
  await actorWait;
  assert(actor.connectionCount === 0, 'Actor state handlers remained connected after success');
}
