// Where notes and reminders go. Any installed plugin with a create_note action can take
// notes (Index, Apple Notes, Google Tasks & Keep, Notion, Obsidian, Roam ...), and any with
// create_reminder can take reminders (Index, Google Tasks, Obsidian, Remember The Milk, TickTick,
// Todoist, Tasks.org ...). Settings pick one of each; Index comes first, then the order found.
//
// Two shapes of create_reminder exist. Index's own takes the words ("message", "date_time_human").
// The store plugins share one contract: "title", "due_iso" with the offset, "timezone",
// and "instanceId" for one of the lists their reminders/list source serves.

var intent = require('./intent');
var sources = require('./sources');

var INDEX_NOTES = '00000000-0000-0000-0002-000000000003';
var INDEX_REMINDERS = '00000000-0000-0000-0002-000000000004';

function actionOf(plugin, name) {
  var acts = (plugin && plugin.actions) || [];
  for (var i = 0; i < acts.length; i++) if (acts[i].name === name) return acts[i];
  return null;
}

function params(action) {
  return Object.keys((action && action.parameters && action.parameters.properties) || {});
}

function list(plugins, action, indexUuid) {
  var found = [];
  (plugins || []).forEach(function (plugin) {
    var a = actionOf(plugin, action);
    if (!a) return;
    var names = params(a);
    found.push({
      uuid: plugin.uuid,
      name: plugin.name || 'Plugin',
      // Index's own words-in tools, or the store plugins' title/due_iso contract.
      words: names.indexOf('message') >= 0 || names.indexOf('date_time_human') >= 0,
      lists: !!actionOf(plugin, 'create_list_item'),
      target: (a.targets && a.targets[0]) || (action === 'create_reminder' ? 'reminders/list' : 'notes/destination')
    });
  });
  found.sort(function (x, y) { return (x.uuid === indexUuid ? 0 : 1) - (y.uuid === indexUuid ? 0 : 1); });
  return found;
}

function notePlugins(plugins) { return list(plugins, 'create_note', INDEX_NOTES); }
function reminderPlugins(plugins) { return list(plugins, 'create_reminder', INDEX_REMINDERS); }

function choose(found, saved) {
  for (var i = 0; i < found.length; i++) if (found[i].uuid === saved) return found[i];
  return found[0] || null;
}

// "tomorrow at 9", "in 20 minutes", "Friday", "tonight" -> a Date, or null if it can't tell.
// A day with no time means 9 in the morning.
function due(when, now) {
  when = String(when || '').toLowerCase().trim();
  if (!when) return null;
  now = now || new Date();
  var m = /^in\s+(\d+|an?|one|two|three|four|five|six|seven)\s+(days?|weeks?)$/.exec(when);
  if (m) {
    var n = /^\d+$/.test(m[1]) ? +m[1] : { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }[m[1]];
    return new Date(now.getTime() + n * (/week/.test(m[2]) ? 7 : 1) * 86400000);
  }
  if (/^in\s/.test(when)) {
    var secs = intent.parseDuration(when);
    if (secs) return new Date(now.getTime() + secs * 1000);
  }
  var tries = [when];
  var parts = { 'this morning': 'at 9am', 'this afternoon': 'at 3pm', 'this evening': 'at 7pm', tonight: 'at 8pm',
    'later today': 'at 6pm', tomorrow: 'tomorrow at 9am', 'tomorrow morning': 'tomorrow at 9am',
    'tomorrow afternoon': 'tomorrow at 3pm', 'tomorrow evening': 'tomorrow at 7pm', 'tomorrow night': 'tomorrow at 8pm' };
  if (parts[when]) tries.unshift(parts[when]);
  // A day with no time ("Friday", "on the 3rd") means 9 in the morning.
  if (/\b(?:tomorrow|next|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|the \d+)/.test(when)) tries.push(when + ' at 9am');
  for (var i = 0; i < tries.length; i++) {
    var r = intent.parse('set an alarm ' + tries[i], now);
    if (r.kind === 'alarm' && r.time * 1000 > now.getTime()) return new Date(r.time * 1000);
  }
  return null;
}

function pad(n) { return (n < 10 ? '0' : '') + n; }

// Local time with its offset: 2026-11-19T09:00:00-05:00.
function iso(date) {
  var off = -date.getTimezoneOffset();
  var sign = off >= 0 ? '+' : '-';
  off = Math.abs(off);
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' +
    pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':00' + sign + pad(Math.floor(off / 60)) + ':' + pad(off % 60);
}

function zone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
}

// The arguments for a reminder ({ message, when, args } from indexkit.reminder), or
// { error } when a store plugin needs a time that couldn't be read.
function reminderArgs(dest, r, now) {
  if (dest.words) return { args: r.args };
  var args = { title: r.message };
  if (r.when) {
    var at = due(r.when, now);
    if (!at) return { error: 'I couldn\'t tell when "' + r.when + '" is.' };
    args.due_iso = iso(at);
    var tz = zone();
    if (tz) args.timezone = tz;
    return { args: args, at: at };
  }
  return { args: args };
}

function noteArgs(dest, text) {
  return { text: text };
}

function key(s) {
  // "Groceries" and "grocery", "To-dos" and "todo" come out the same.
  return String(s || '').toLowerCase().replace(/\blist\b/g, '').replace(/[^a-z0-9]/g, '').replace(/(?:ies|es|s|y)$/, '');
}

// A store plugin's list by name, from its reminders/list source: done(instanceId or null, name).
function findList(dest, wanted, done) {
  var parts = dest.target.split('/');
  sources.read({ category: parts[0], item: parts[1], plugin: dest.uuid, properties: ['name'], all: true }, function (err, instances) {
    if (err || !instances) { done(null); return; }
    var k = key(wanted), best = null;
    instances.forEach(function (inst) {
      var p = inst.properties && inst.properties.name;
      var name = p && p.shortText && p.shortText.text;
      if (!name || best) return;
      var nk = key(name);
      if (nk === k || (k.length >= 3 && (nk.indexOf(k) >= 0 || k.indexOf(nk) >= 0 && nk.length >= 3))) best = { id: inst.instanceId, name: name };
    });
    done(best ? best.id : null, best ? best.name : null);
  }, 4000);
}

module.exports = { notePlugins: notePlugins, reminderPlugins: reminderPlugins, choose: choose, due: due, iso: iso,
  reminderArgs: reminderArgs, noteArgs: noteArgs, findList: findList, INDEX_NOTES: INDEX_NOTES, INDEX_REMINDERS: INDEX_REMINDERS };
