// The user's units and clock from the Pebble app's Preferences plugin
// (preferences/units). Read once at start and refreshed now and then; until it answers,
// It falls back to 12-hour time and the units the weather provider already uses.

var sources = require('./sources');

var PREFERENCES = '00000000-0000-0000-0001-000000000009';
var REFRESH_MS = 30 * 60 * 1000;

var current = { clock: '', temperature: '', distance: '', wind_speed: '', pressure: '', locale: '' };
var readAt = 0;

function text(property) {
  return property && property.shortText && property.shortText.text ? String(property.shortText.text) : '';
}

function apply(instance) {
  var p = (instance && instance.properties) || {};
  Object.keys(current).forEach(function (key) {
    if (text(p[key])) current[key] = text(p[key]);
  });
}

// Refreshes in the background; callers use get() and never wait on it.
function refresh(force) {
  if (!force && readAt && Date.now() - readAt < REFRESH_MS) return;
  readAt = Date.now();
  sources.read({ category: 'preferences', item: 'units', plugin: PREFERENCES }, function (err, instance) {
    if (!err) apply(instance);
  }, 10000);
}

function get() { return current; }

// "6:42 AM" or "06:42", by the user's clock preference.
function time(date) {
  var h = date.getHours();
  var m = ('0' + date.getMinutes()).slice(-2);
  if (current.clock === '24h') return ('0' + h).slice(-2) + ':' + m;
  return ((h % 12) || 12) + ':' + m + (h < 12 ? ' AM' : ' PM');
}

// A Celsius number in the user's unit, for when a provider gives no text of its own.
function temperature(celsius) {
  if (typeof celsius !== 'number') return '';
  return current.temperature === '°F' ? Math.round(celsius * 9 / 5 + 32) + '°' : Math.round(celsius) + '°';
}

module.exports = { refresh: refresh, get: get, time: time, temperature: temperature, apply: apply, PREFERENCES: PREFERENCES };
