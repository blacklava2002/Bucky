// Weather asks, answered from the weather source the Pebble app provides.
//
// The Pebble app lets you pick a weather provider (Settings → Weather): its built-in one, MET
// Norway, or any plugin that serves `weather/location`. Subscribing with no plugin gets that
// choice; this app's settings can name one instead. The pure parts (ask, describe) run under node.

var brand = require('./brand');

var sources = require('./sources');
var prefs = require('./prefs');

var DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
var SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
var DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

var PROPERTIES = ['name', 'temperature', 'feels_like', 'high', 'low', 'condition', 'condition_code',
  'precipitation', 'daily_high', 'daily_low', 'daily_condition', 'daily_condition_code',
  'daily_precipitation', 'wind_speed', 'sunrise', 'sunset', 'daily_sunrise', 'daily_sunset'];

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[,!?.]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Asks that start like an errand or a message are for the agent, even if they mention rain.
var NOT_A_QUESTION = /^(?:add|remind|note|send|text|email|message|tell|ask|set|put|write|create|schedule|cancel|delete|call)\b/;
var QUESTION = new RegExp('^(?:(?:ok|okay|hey|' + brand.wake + '|so|and)\\s+)*(?:what|whats|how|hows|will|would|is|isnt|does|do|should|shall|am|any|gonna|need|do i need|tell me|give me)\\b');
var ALWAYS = /\b(?:weather|forecast)\b/;
var TOPIC = /\b(?:umbrella|rain|raining|rainy|snow|snowing|snowy|jacket|coat|sweater|temperature|temp|hot|cold|warm|chilly|freezing|sunny|cloudy|degrees)\b/;
var ITS = new RegExp('^(?:(?:ok|okay|hey|' + brand.wake + ')\\s+)*(?:is it|it is|its|will it)\\b');

// Returns null, or { day: 'now' | 0..6 days ahead | 'week', topic: 'rain' | 'snow' | 'sunrise' | 'sunset' | '' }.
function ask(text, now) {
  var t = normalize(text);
  if (!t || NOT_A_QUESTION.test(t)) return null;
  var sun = /\bsun\s?rise\b|\bsun (?:come|comes|coming) up\b|\bsun up\b/.test(t) ? 'sunrise'
    : /\bsun\s?set\b|\bsun (?:go|goes|going) down\b|\bsundown\b/.test(t) ? 'sunset' : '';
  var weathery = sun || ALWAYS.test(t) || (TOPIC.test(t) && (QUESTION.test(t) || ITS.test(t)));
  if (!weathery) return null;
  var topic = sun || (/\b(?:umbrella|rain|raining|rainy|wet)\b/.test(t) ? 'rain'
    : /\b(?:snow|snowing|snowy)\b/.test(t) ? 'snow' : '');
  var day = 'now';
  var weekday = -1;
  for (var i = 0; i < 7; i++) {
    if (new RegExp('\\b' + DAYS[i] + '\\b').test(t)) weekday = i;
  }
  if (/\b(?:this|the|next) week\b|\bweek ahead\b|\bweekly\b|\b(?:5|five|7|seven|10|ten) day\b/.test(t)) day = 'week';
  else if (/\b(?:this|the) weekend\b|\bweekend\b/.test(t)) day = ((6 - now.getDay()) + 7) % 7;
  else if (/\btomorrow\b/.test(t)) day = 1;
  else if (/\bday after tomorrow\b/.test(t)) day = 2;
  else if (weekday >= 0) day = (weekday - now.getDay() + 7) % 7 + (/\bnext\b/.test(t) && weekday === now.getDay() ? 7 : 0);
  else if (/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/.test(t)) day = 0;
  if (/\bday after tomorrow\b/.test(t)) day = 2;
  if (day === 'now' && topic) day = 0;  // "will it rain?" is about the rest of today
  return { day: day, topic: topic };
}

function text(property, shape) {
  var payload = property && property[shape || 'shortText'];
  return payload && payload.text ? String(payload.text) : '';
}

function number(property) {
  var payload = property && property.numericValue;
  return payload && typeof payload.value === 'number' ? payload.value : null;
}

// The value of a daily series for the day `daysAhead` from now (local midnight to midnight).
function dayValue(property, shape, daysAhead, now) {
  var series = property && property.series;
  if (!series || series.start === undefined || !series.stepSec) return null;
  var values = series[shape] && series[shape].values;
  if (!values) return null;
  var day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, 12, 0, 0);
  var index = Math.floor((day.getTime() / 1000 - series.start) / series.stepSec);
  if (index < 0 || index >= values.length) return null;
  var value = values[index];
  return value === null || value === undefined ? null : value;
}

// "72°F" -> "72°": the unit is the user's own, so it only adds width on the watch.
function deg(t) {
  return String(t || '').replace(/°\s*[FC]$/i, '°');
}

function sentence(t) {
  t = String(t || '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

function dayWord(daysAhead, now) {
  if (daysAhead === 0) return 'Today';
  if (daysAhead === 1) return 'Tomorrow';
  return DAY_NAMES[new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead).getDay()];
}

function chanceLine(chance) {
  return chance === null ? '' : Math.round(chance) + '% chance of rain.';
}

// Yes / maybe / no for rain or snow, from the chance and the condition.
function verdict(topic, chance, code) {
  code = String(code || '');
  if (topic === 'snow') {
    if (/snow/.test(code)) return 'Yes, snow is likely';
    if (chance !== null && chance >= 40) return 'Some chance, but not snow';
    return 'No snow expected';
  }
  if (chance !== null) {
    if (chance >= 50) return 'Yes, bring an umbrella';
    if (chance >= 25) return 'Maybe, ' + Math.round(chance) + '% chance';
    return 'Probably not';
  }
  if (/rain/.test(code)) return 'Yes, bring an umbrella';
  return 'Probably not';
}

// Turns one location's properties into { headline, body } for the reply screen.
function describe(location, question, now) {
  var p = (location && location.properties) || {};
  var place = text(p.name);
  var where = place ? 'In ' + place + '.' : '';
  var lines = [];
  var headline;

  if (question.topic === 'sunrise' || question.topic === 'sunset') {
    var day0 = question.day === 'now' || question.day === 'week' ? 0 : question.day;
    var at = dayValue(p['daily_' + question.topic], 'timestamp', day0, now);
    if (at === null && day0 === 0) at = p[question.topic] && p[question.topic].timestamp ? p[question.topic].timestamp.value : null;
    var word = question.topic === 'sunrise' ? 'Sunrise' : 'Sunset';
    if (typeof at !== 'number') return { headline: 'No ' + word.toLowerCase() + ' time', body: 'Your weather provider doesn\'t give one for that day.' };
    headline = word + ' ' + prefs.time(new Date(at * 1000));
    lines.push(dayWord(day0, now) + (place ? ' in ' + place : '') + '.');
    return { headline: headline, body: lines.join(' ') };
  }

  if (question.day === 'week') {
    for (var d = 0; d < 7; d++) {
      var hi = dayValue(p.daily_high, 'shortText', d, now);
      var lo = dayValue(p.daily_low, 'shortText', d, now);
      if (hi === null && lo === null) continue;
      var cond = dayValue(p.daily_condition, 'shortText', d, now);
      var rain = dayValue(p.daily_precipitation, 'numericValue', d, now);
      var day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d).getDay();
      lines.push(SHORT_DAYS[day] + ' ' + deg(hi || '-') + '/' + deg(lo || '-') +
        (cond ? ' ' + cond : '') + (rain !== null && rain >= 20 ? ' ' + Math.round(rain) + '%' : ''));
    }
    if (!lines.length) return null;
    return { headline: place ? 'Week in ' + place : 'The week ahead', body: lines.join('\n') };
  }

  if (question.day === 'now') {
    var temp = text(p.temperature) || prefs.temperature(number(p.temperature));
    var condition = text(p.condition);
    if (!temp && !condition) return null;
    headline = [deg(temp), condition].filter(Boolean).join(', ');
    var feels = text(p.feels_like);
    if (feels && feels !== temp) lines.push('Feels like ' + deg(feels) + '.');
    var high = text(p.high) || dayValue(p.daily_high, 'shortText', 0, now);
    var low = text(p.low) || dayValue(p.daily_low, 'shortText', 0, now);
    if (high || low) lines.push([high ? 'High ' + deg(high) : '', low ? 'low ' + deg(low) : ''].filter(Boolean).join(', ') + '.');
    var nowChance = number(p.precipitation);
    if (nowChance === null) nowChance = dayValue(p.daily_precipitation, 'numericValue', 0, now);
    if (chanceLine(nowChance)) lines.push(chanceLine(nowChance));
    var wind = text(p.wind_speed);
    if (wind && !/^0\b/.test(wind)) lines.push('Wind ' + wind + '.');
    if (where) lines.push(where);
    return { headline: sentence(headline), body: lines.join(' ') };
  }

  var dayHigh = dayValue(p.daily_high, 'shortText', question.day, now);
  var dayLow = dayValue(p.daily_low, 'shortText', question.day, now);
  var dayCond = dayValue(p.daily_condition, 'shortText', question.day, now);
  var dayCode = dayValue(p.daily_condition_code, 'longText', question.day, now);
  var chance = dayValue(p.daily_precipitation, 'numericValue', question.day, now);
  if (question.day === 0) {
    dayHigh = dayHigh || text(p.high);
    dayLow = dayLow || text(p.low);
    dayCond = dayCond || text(p.condition);
    dayCode = dayCode || text(p.condition_code, 'longText');
    if (chance === null) chance = number(p.precipitation);
  }
  if (dayHigh === null && dayLow === null && !dayCond) {
    return { headline: 'No forecast that far', body: 'Your weather provider only goes a few days ahead.' };
  }
  var when = dayWord(question.day, now);
  var summary = [dayCond ? sentence(dayCond) : '', dayHigh ? 'high ' + deg(dayHigh) : '', dayLow ? 'low ' + deg(dayLow) : '']
    .filter(Boolean).join(', ');
  if (question.topic) {
    headline = verdict(question.topic, chance, dayCode);
    lines.push(when + ': ' + summary + '.');
  } else {
    headline = when + ': ' + [deg(dayHigh), dayCond].filter(Boolean).join(', ');
    lines.push(sentence(summary) + '.');
  }
  if (chanceLine(chance)) lines.push(chanceLine(chance));
  if (where) lines.push(where);
  return { headline: headline, body: lines.join(' ') };
}

// Plugins installed that serve weather, for the settings page.
function providers(plugins) {
  return (plugins || []).filter(function (plugin) {
    return (plugin.sources || []).some(function (source) {
      return source.category === 'weather' && (source.items || []).indexOf('location') >= 0;
    });
  }).map(function (plugin) { return { uuid: plugin.uuid, name: plugin.name || 'Weather' }; });
}

// One reading of the weather source. Calls done(err, location).
function read(pluginUuid, done) {
  sources.read({ category: 'weather', item: 'location', properties: PROPERTIES, plugin: pluginUuid }, function (err, location) {
    if (err && err.code === 'NO_DATA') err = { code: 'NO_LOCATION' };
    done(err, location);
  });
}

module.exports = { ask: ask, describe: describe, providers: providers, read: read, PROPERTIES: PROPERTIES };
