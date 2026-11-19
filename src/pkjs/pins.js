// Timeline pins for the watch's timers and alarms.
// The watch sends its whole list as text after every change; this turns it into
// pins and works out which old pins to take down. Pins go in through the Pebble
// app's local timeline (Pebble.insertTimelinePin), so no token or server is needed.

var brand = require('./brand');

// The reminder icon made timers read as reminders; there is no timer icon, so both
// use the alarm clock.
var ICON = {
  1: 'system://images/ALARM_CLOCK',  // timer
  2: 'system://images/ALARM_CLOCK'   // alarm
};
// Launch codes: open the app on the menu (1, older pins), the timers list or the alarms list.
var OPEN_LIST = 1;
var OPEN_TIMERS = 2;
var OPEN_ALARMS = 3;

function duration(seconds) {
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = seconds % 60;
  if (h && m) return h + 'h ' + m + 'm';
  if (h) return h + ' hr';
  if (m && s) return m + 'm ' + s + 's';
  if (m) return m + ' min';
  return s + ' sec';
}

// "1\t1700000000\t600\tpasta\n2\t1700040000\t0\t" -> [{kind, when, duration, label}]
function parse(text) {
  var items = [];
  String(text || '').split('\n').forEach(function (line) {
    if (!line) return;
    var f = line.split('\t');
    var kind = parseInt(f[0], 10);
    var when = parseInt(f[1], 10);
    if ((kind !== 1 && kind !== 2) || !(when > 0)) return;
    items.push({ kind: kind, when: when, duration: parseInt(f[2], 10) || 0, label: f.slice(3).join(' ').trim() });
  });
  return items;
}

function pinId(item) {
  return brand.id + '-' + (item.kind === 1 ? 'timer' : 'alarm') + '-' + item.when;
}

function capital(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function pinFor(item) {
  var timer = item.kind === 1;
  var noun = timer ? 'timer' : 'alarm';
  // "Tea timer", "Airport alarm".
  var title = item.label
    ? capital(item.label) + (new RegExp(noun + '$', 'i').test(item.label) ? '' : ' ' + noun)
    : capital(noun);
  var subtitle = timer
    ? (item.duration ? duration(item.duration) + ' timer' : 'Timer')
    : brand.name;
  return {
    id: pinId(item),
    time: new Date(item.when * 1000).toISOString(),
    layout: {
      type: 'genericPin',
      title: title,
      subtitle: subtitle,
      tinyIcon: ICON[item.kind]
    },
    actions: [{ title: 'Open ' + brand.name, type: 'openWatchApp', launchCode: timer ? OPEN_TIMERS : OPEN_ALARMS }]
  };
}

// Pins to insert, and ids from `previous` that are gone and should be deleted.
function plan(text, previous) {
  var pins = parse(text).map(pinFor);
  var keep = {};
  pins.forEach(function (p) { keep[p.id] = true; });
  var remove = (previous || []).filter(function (id) { return !keep[id]; });
  return { pins: pins, remove: remove, ids: Object.keys(keep) };
}

module.exports = { parse: parse, pinFor: pinFor, plan: plan, duration: duration, OPEN_LIST: OPEN_LIST, OPEN_TIMERS: OPEN_TIMERS, OPEN_ALARMS: OPEN_ALARMS };
