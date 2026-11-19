const test = require('node:test');
const assert = require('node:assert');
const prefs = require('../src/pkjs/prefs');
const weather = require('../src/pkjs/weather');

const at = new Date(2026, 10, 18, 18, 5);

test('time follows the clock preference', () => {
  prefs.apply({ properties: { clock: { shortText: { text: '12h' } } } });
  assert.equal(prefs.time(at), '6:05 PM');
  prefs.apply({ properties: { clock: { shortText: { text: '24h' } } } });
  assert.equal(prefs.time(at), '18:05');
  prefs.apply({ properties: { clock: { shortText: { text: '12h' } }, temperature: { shortText: { text: '°F' } } } });
  assert.equal(prefs.temperature(20), '68°');
});

test('sunrise and sunset', () => {
  const now = new Date(2026, 10, 18, 9, 0);
  assert.deepEqual(weather.ask('when is sunset', now), { day: 0, topic: 'sunset' });
  assert.deepEqual(weather.ask('what time does the sun come up tomorrow', now), { day: 1, topic: 'sunrise' });
  const midnight = new Date(2026, 10, 18).getTime() / 1000;
  const loc = { properties: {
    name: { shortText: { text: 'Browns Mills' } },
    daily_sunset: { series: { start: midnight, stepSec: 86400, timestamp: { values: [midnight + 16 * 3600 + 35 * 60, midnight + 86400 + 16 * 3600 + 34 * 60] } } },
  } };
  prefs.apply({ properties: { clock: { shortText: { text: '12h' } } } });
  assert.deepEqual(weather.describe(loc, { day: 0, topic: 'sunset' }, now), { headline: 'Sunset 4:35 PM', body: 'Today in Browns Mills.' });
  assert.equal(weather.describe(loc, { day: 1, topic: 'sunset' }, now).headline, 'Sunset 4:34 PM');
  assert.equal(weather.describe(loc, { day: 0, topic: 'sunrise' }, now).headline, 'No sunrise time');
});
