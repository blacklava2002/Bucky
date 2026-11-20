const test = require('node:test');
const assert = require('node:assert');
const pins = require('../src/pkjs/pins');

const LIST = '1\t1763481600\t600\tpasta\n2\t1763535600\t0\t\n';

test('parses the watch list', () => {
  assert.deepEqual(pins.parse(LIST), [
    { kind: 1, when: 1763481600, duration: 600, label: 'pasta' },
    { kind: 2, when: 1763535600, duration: 0, label: '' },
  ]);
  assert.deepEqual(pins.parse(''), []);
  assert.deepEqual(pins.parse('9\t5\t0\tx\n1\tnope\t0\t'), []);
});

test('timer pin', () => {
  const pin = pins.pinFor({ kind: 1, when: 1763481600, duration: 600, label: 'pasta' });
  assert.equal(pin.id, 'bucky-timer-1763481600');
  assert.equal(pin.time, '2025-11-18T16:00:00.000Z');
  assert.equal(pin.layout.type, 'genericPin');
  assert.equal(pin.layout.title, 'Pasta timer');
  assert.equal(pin.layout.subtitle, '10 min timer');
  assert.equal(pin.layout.tinyIcon, 'system://images/ALARM_CLOCK');
  assert.deepEqual(pin.actions, [{ title: 'Open Bucky', type: 'openWatchApp', launchCode: 2 }]);
});

test('alarm pin without a label', () => {
  const pin = pins.pinFor({ kind: 2, when: 1763535600, duration: 0, label: '' });
  assert.equal(pin.id, 'bucky-alarm-1763535600');
  assert.equal(pin.layout.title, 'Alarm');
  assert.equal(pin.layout.tinyIcon, 'system://images/ALARM_CLOCK');
});

test('plan takes down pins that are gone', () => {
  const plan = pins.plan(LIST, ['bucky-timer-1763481600', 'bucky-alarm-1', 'bucky-timer-2']);
  assert.deepEqual(plan.remove, ['bucky-alarm-1', 'bucky-timer-2']);
  assert.equal(plan.pins.length, 2);
  assert.deepEqual(plan.ids, ['bucky-timer-1763481600', 'bucky-alarm-1763535600']);
  assert.deepEqual(pins.plan('', ['a']).remove, ['a']);
});

test('named alarms read as "<name> alarm"', () => {
  const pin = pins.pinFor({ kind: 2, when: 1763535600, duration: 0, label: 'airport' });
  assert.equal(pin.layout.title, 'Airport alarm');
});

test('reminder pin shows its words and opens the reminders list', () => {
  assert.deepEqual(pins.parse('3\t1763535600\t0\tcall Mom about Sunday dinner\n'), [
    { kind: 3, when: 1763535600, duration: 0, label: 'call Mom about Sunday dinner' },
  ]);
  const pin = pins.pinFor({ kind: 3, when: 1763535600, duration: 0, label: 'call Mom about Sunday dinner' });
  assert.equal(pin.id, 'bucky-reminder-1763535600');
  assert.equal(pin.layout.title, 'Call Mom about Sunday dinner');
  assert.equal(pin.layout.subtitle, 'Reminder');
  assert.equal(pin.layout.tinyIcon, 'system://images/NOTIFICATION_REMINDER');
  assert.deepEqual(pin.actions, [{ title: 'Open Bucky', type: 'openWatchApp', launchCode: 4 }]);
});
