// "launch Workout", "open Weather", "start the stopwatch". Reads the watch's app list
// from the Pebble app's built-in Watch State plugin (watch/app) and opens the best match with
// its launch_app action. Opening another app closes this app, as any app launch does.

var brand = require('./brand');

var sources = require('./sources');

var WATCH_STATE = '00000000-0000-0000-0001-000000000007';
var SELF = brand.uuid;  // this app, from package.json

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[,!?.]/g, ' ').replace(/\s+/g, ' ').trim();
}

// "launch workout" -> { name: 'workout', strict: true }. Other verbs (open, start, ...) only count when X is an
// app (strict false), so "open the garage door" still goes to the agent.
var LEAD = new RegExp('^(?:(?:ok|okay|hey|' + brand.wake + '|please|can you|could you)\\s+)*');
function ask(text) {
  var t = normalize(text).replace(LEAD, '');
  var m = /^(launch|open|run|switch to|go to|show me|start|begin)\s+(.+)$/.exec(t);
  if (!m) return null;
  var name = m[2].replace(/\s+(?:please|for me|now)$/g, '')
    .replace(/^(?:up\s+)?(?:the|my|a|an)\s+/, '')
    .replace(/\s+(?:app|application|watchapp|watch app|watchface|watch face|face)$/, '')
    .trim();
  if (!name) return null;
  var verb = m[1];
  var strict = verb === 'launch';
  // Clock words belong to timers and alarms, whatever the verb.
  if (/\b(?:timer|alarm|countdown)s?\b/.test(name) && !/\bapp\b/.test(t)) return null;
  // "open the garage door", "show me the weather": long phrases are for others.
  if (name.split(' ').length > 4) return null;
  return { name: name, strict: strict };
}

function words(t) {
  return normalize(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// The app the name means, or null. Exact name first, then the start of a name, then a word in it.
function pick(apps, name) {
  var want = words(name);
  if (!want) return null;
  var squeeze = want.replace(/ /g, '');
  var best = null;
  var bestScore = 0;
  (apps || []).forEach(function (app) {
    if (!app || !app.name || app.uuid === SELF) return;
    var have = words(app.name);
    var score = 0;
    if (have === want || have.replace(/ /g, '') === squeeze) score = 100;
    else if (have.indexOf(want + ' ') === 0 || have.replace(/ /g, '').indexOf(squeeze) === 0) score = 60;
    else if ((' ' + have + ' ').indexOf(' ' + want + ' ') >= 0) score = 40;
    else if (want.length >= 4 && have.indexOf(want) >= 0) score = 20;
    if (!score) return;
    if (app.type === 'watchapp') score += 5;
    score -= Math.min(have.length, 30) / 100;  // the shorter name wins a tie
    if (score > bestScore) { best = app; bestScore = score; }
  });
  return best;
}

function text(property) {
  return property && property.shortText && property.shortText.text ? String(property.shortText.text) : '';
}

// Every launchable app on the watch: [{ uuid, name, type }]. done(err, apps).
function list(done) {
  sources.read({ category: 'watch', item: 'app', properties: ['name', 'type'], plugin: WATCH_STATE, all: true }, function (err, instances) {
    if (err) return done(err);
    done(null, (instances || []).map(function (instance) {
      var p = instance.properties || {};
      return { uuid: instance.instanceId, name: text(p.name), type: text(p.type) };
    }));
  }, 10000);
}

module.exports = { ask: ask, pick: pick, list: list, WATCH_STATE: WATCH_STATE, SELF: SELF };
