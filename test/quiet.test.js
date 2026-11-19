const test = require('node:test');
const assert = require('node:assert');
const quietMod = require('../src/pkjs/quiet');

function switches(manualOn) {
  return [
    { instanceId: 'clock24h', properties: { value: { boolean: { value: true } } } },
    { instanceId: quietMod.MANUAL, properties: { value: { boolean: { value: manualOn } } } },
  ];
}

function texts(show) {
  return [{ instanceId: quietMod.SHOW, properties: { value: { shortText: { text: show } } } }];
}

function harness(state) {
  const store = {};
  const calls = [];
  const timers = [];
  const env = {
    read(request, done) {
      setImmediate(() => {
        if (state.fail) return done({ code: 'ERROR' });
        done(null, request.item === 'switch_setting' ? switches(state.manual) : texts(state.show));
      });
    },
    invoke(args) {
      calls.push(args);
      if (args.action === 'set_on') state.manual = args.args.on;
      if (args.action === 'set_value') state.show = args.args.value;
      return Promise.resolve({ ok: true });
    },
    load: (k) => (k in store ? store[k] : null),
    save: (k, v) => { store[k] = v; },
    setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimeout: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    log: () => {},
  };
  return { quiet: quietMod.create(env), calls, store, timers };
}

const started = (q) => new Promise((resolve) => q.start(resolve));
const stopped = (q) => new Promise((resolve) => q.stop(resolve));

test('turns Quiet Time on with notifications hidden, then puts both back', async () => {
  const state = { manual: false, show: 'Show' };
  const h = harness(state);
  await started(h.quiet);
  assert.equal(state.manual, true);
  assert.equal(state.show, 'Hide');
  assert.ok(h.quiet.pending());
  await stopped(h.quiet);
  assert.equal(state.manual, false);
  assert.equal(state.show, 'Show');
  assert.ok(!h.quiet.pending());
});

test('leaves alone what was already set', async () => {
  const state = { manual: true, show: 'Hide' };
  const h = harness(state);
  await started(h.quiet);
  assert.equal(h.calls.length, 0);
  await stopped(h.quiet);
  assert.equal(h.calls.length, 0);
  assert.equal(state.manual, true);
});

test('Quiet Time already on but showing notifications: only the popups are hidden and restored', async () => {
  const state = { manual: true, show: 'Show' };
  const h = harness(state);
  await started(h.quiet);
  assert.deepEqual(h.calls.map((c) => c.action), ['set_value']);
  await stopped(h.quiet);
  assert.equal(state.manual, true);
  assert.equal(state.show, 'Show');
});

test('a stop that arrives while starting waits, then restores', async () => {
  const state = { manual: false, show: 'Show' };
  const h = harness(state);
  const start = started(h.quiet);
  const stop = stopped(h.quiet);
  await start;
  await stop;
  assert.equal(state.manual, false);
  assert.equal(state.show, 'Show');
});

test('settings it cannot read are left alone and listening goes ahead', async () => {
  const state = { manual: false, show: 'Show', fail: true };
  const h = harness(state);
  await started(h.quiet);
  assert.equal(h.calls.length, 0);
  assert.ok(!h.quiet.pending());
});

test('the safety timer puts things back if the watch never says it is done', async () => {
  const state = { manual: false, show: 'Show' };
  const h = harness(state);
  await started(h.quiet);
  const safety = h.timers.find((t) => t.ms === 90000);
  assert.ok(safety);
  safety.fn();
  await new Promise((r) => setImmediate(r));
  assert.equal(state.manual, false);
  assert.equal(state.show, 'Show');
});

test('a second listen while still quiet does not overwrite what to restore', async () => {
  const state = { manual: false, show: 'Show' };
  const h = harness(state);
  await started(h.quiet);
  await started(h.quiet);
  await stopped(h.quiet);
  assert.equal(state.manual, false);
  assert.equal(state.show, 'Show');
});
