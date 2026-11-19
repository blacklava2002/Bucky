// Questions about the phone itself, answered from the Pebble app's built-in Phone
// plugin (the phone/phone_state source). It reports the battery level and the network, not
// whether the phone is charging.

var brand = require('./brand');

var sources = require('./sources');

var PHONE_STATE = '00000000-0000-0000-0001-000000000001';

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[,!?.]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

var NOT_A_QUESTION = /^(?:add|remind|note|send|text|email|message|tell|ask|set|put|write|create|schedule|cancel|delete|call)\b/;

// "whats my battery level", "what is my phones battery percentage", "how charged is my phone",
// "is my phone charged". The watch's own battery isn't asked about here: there's no reading of it.
function ask(text) {
  var t = normalize(text);
  if (!t || NOT_A_QUESTION.test(t)) return null;
  if (/\bwatch(?:es|s)?\b/.test(t)) return null;
  if (/\bbattery\b/.test(t) && /\b(?:level|percent|percentage|life|left|at|charge|charged|status|how much|whats|what is|how)\b/.test(t)) {
    return { what: 'battery' };
  }
  if (new RegExp('^(?:(?:ok|okay|hey|' + brand.wake + ')\\s+)*(?:my\\s+)?phones?\\s+battery\\b').test(t)) return { what: 'battery' };
  if (/\bhow (?:much )?charged\b|\bis (?:my|the) phone (?:fully )?charged\b|\bphone (?:charge|charge level)\b/.test(t)) {
    return { what: 'battery' };
  }
  return null;
}

// Turns the phone_state instance into { headline, body }, or null when it has no level.
function describe(instance) {
  var p = (instance && instance.properties) || {};
  var level = p.battery_level && p.battery_level.numericValue && p.battery_level.numericValue.value;
  if (typeof level !== 'number') return null;
  var pct = Math.round(level);
  var headline = 'Phone at ' + pct + '%';
  var lines = [];
  if (pct >= 100) lines.push('Fully charged.');
  else if (pct <= 15) lines.push('Running low.');
  var wifi = p.wifi && p.wifi.boolean && p.wifi.boolean.value;
  var mobile = p.mobile_data && p.mobile_data.boolean && p.mobile_data.boolean.value;
  var cell = p.cell && p.cell.shortText && p.cell.shortText.text;
  if (wifi) lines.push('On Wi-Fi.');
  else if (mobile) lines.push('On mobile data' + (cell ? ' (' + cell + ')' : '') + '.');
  return { headline: headline, body: lines.join(' ') };
}

function read(done) {
  sources.read({ category: 'phone', item: 'phone_state', plugin: PHONE_STATE,
    properties: ['battery_level', 'wifi', 'mobile_data', 'cell'] }, done, 10000);
}

module.exports = { ask: ask, describe: describe, read: read, PHONE_STATE: PHONE_STATE };
