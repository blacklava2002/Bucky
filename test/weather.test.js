// Weather asks and how answers read.
const test = require('node:test');
const assert = require('node:assert');
const { ask, describe, providers } = require('../src/pkjs/weather.js');

const WED = new Date(2026, 10, 18, 15, 0, 0); // Wednesday afternoon
const midnight = new Date(2026, 10, 18, 0, 0, 0).getTime() / 1000;

test('weather questions and their days', () => {
  assert.deepEqual(ask("What's the current weather?", WED), { day: 'now', topic: '' });
  assert.deepEqual(ask('Will I need an umbrella tomorrow?', WED), { day: 1, topic: 'rain' });
  assert.deepEqual(ask('will it rain', WED), { day: 0, topic: 'rain' });
  assert.deepEqual(ask('weather on friday', WED), { day: 2, topic: '' });
  assert.deepEqual(ask('forecast for the week', WED), { day: 'week', topic: '' });
  assert.deepEqual(ask('is it going to snow on saturday', WED), { day: 3, topic: 'snow' });
  assert.deepEqual(ask('how cold is it', WED), { day: 'now', topic: '' });
  assert.deepEqual(ask('weather the day after tomorrow', WED), { day: 2, topic: '' });
  assert.deepEqual(ask('whats the weather this weekend', WED), { day: 3, topic: '' });
});

test('not weather', () => {
  for (const t of ['remind me to bring an umbrella', 'add rain jacket to the shopping list',
    'set a timer for 5 minutes', 'tell claude about the rain', 'play rain sounds', 'Find my phone.']) {
    assert.equal(ask(t, WED), null, t);
  }
});

const daily = (vals, shape = 'shortText') => ({ series: { start: midnight, stepSec: 86400, [shape]: { values: vals } } });
const LOCATION = { properties: {
  name: { shortText: { text: 'Browns Mills' } },
  temperature: { shortText: { text: '52°F' } },
  feels_like: { shortText: { text: '48°F' } },
  high: { shortText: { text: '55°F' } },
  low: { shortText: { text: '38°F' } },
  condition: { shortText: { text: 'Partly cloudy' } },
  precipitation: { numericValue: { value: 10 }, shortText: { text: '10%' } },
  daily_high: daily(['55°F', '61°F', '48°F', '50°F']),
  daily_low: daily(['38°F', '45°F', '35°F', '30°F']),
  daily_condition: daily(['Partly cloudy', 'Rain', 'Cloudy', 'Light snow']),
  daily_condition_code: daily(['partly_cloudy', 'light_rain', 'cloudy', 'light_snow'], 'longText'),
  daily_precipitation: daily([10, 80, 20, 40], 'numericValue'),
} };

test('now', () => {
  const a = describe(LOCATION, { day: 'now', topic: '' }, WED);
  assert.equal(a.headline, '52°, Partly cloudy');
  assert.equal(a.body, 'Feels like 48°. High 55°, low 38°. 10% chance of rain. In Browns Mills.');
});

test('umbrella tomorrow', () => {
  const a = describe(LOCATION, { day: 1, topic: 'rain' }, WED);
  assert.equal(a.headline, 'Yes, bring an umbrella');
  assert.equal(a.body, 'Tomorrow: Rain, high 61°, low 45°. 80% chance of rain. In Browns Mills.');
});

test('a weekday and snow', () => {
  assert.equal(describe(LOCATION, { day: 2, topic: '' }, WED).headline, 'Friday: 48°, Cloudy');
  assert.equal(describe(LOCATION, { day: 3, topic: 'snow' }, WED).headline, 'Yes, snow is likely');
});

test('the week, and past the forecast', () => {
  const w = describe(LOCATION, { day: 'week', topic: '' }, WED);
  assert.equal(w.headline, 'Week in Browns Mills');
  assert.equal(w.body.split('\n')[1], 'Thu 61°/45° Rain 80%');
  assert.equal(describe(LOCATION, { day: 6, topic: '' }, WED).headline, 'No forecast that far');
});

test('weather providers from the plugin list', () => {
  const list = providers([
    { uuid: 'a', name: 'Weather', sources: [{ category: 'weather', items: ['location'] }] },
    { uuid: 'b', name: 'Claude', sources: [], actions: [{ name: 'send_to_agent' }] },
    { uuid: 'c', name: 'MET Norway Weather', sources: [{ category: 'weather', items: ['location'] }] },
  ]);
  assert.deepEqual(list.map((p) => p.name), ['Weather', 'MET Norway Weather']);
});
