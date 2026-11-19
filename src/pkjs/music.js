// "what's playing?", answered from the Pebble app's built-in Music plugin (music/track).
// Play, pause and skip are plugin actions in actions.js; this is the one that reads back.

var brand = require('./brand');

var sources = require('./sources');

var MUSIC = '00000000-0000-0000-0001-000000000003';

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[,!?.]/g, ' ').replace(/\s+/g, ' ').trim();
}

var ASK = new RegExp('^(?:(?:ok|okay|hey|' + brand.wake + ')\\s+)*(?:whats|what is|what song is|which song is|what track is|who is|whos|who sings|who sang|name (?:this|that) (?:song|tune))\\b');
var ABOUT = /\b(?:playing|this song|that song|this track|that track|the song|this tune|the music|sings this|sang this|singing)\b/;

// Returns { what: 'track' } or null.
function ask(text) {
  var t = normalize(text);
  var songIs = new RegExp('^(?:(?:ok|okay|hey|' + brand.wake + ')\\s+)*(?:what|which) (?:song|track|tune) (?:is (?:this|that|playing|on)|am i (?:listening|hearing))\\b').test(t);
  if (!songIs && (!ASK.test(t) || !ABOUT.test(t))) return null;
  if (/\b(?:movie|movies|theater|theatre|cinema|tv|tonight|game|weekend)\b/.test(t)) return null;
  return { what: 'track' };
}

function text(property) {
  var p = property && (property.shortText || property.longText);
  var t = p && p.text ? String(p.text) : '';
  return t === '?' ? '' : t;
}

function describe(instance) {
  var p = (instance && instance.properties) || {};
  var title = text(p.title);
  if (!title) return null;
  var artist = text(p.artist);
  var album = text(p.album);
  var playing = p.playing && p.playing.boolean ? p.playing.boolean.value : null;
  var body = [];
  if (artist) body.push('By ' + artist + (album ? ', from ' + album : '') + '.');
  else if (album) body.push('From ' + album + '.');
  if (playing === false) body.push('Paused.');
  body.push('Say "next song", "go back a song" or "pause".');
  return { headline: title, body: body.join(' ') };
}

function read(done) {
  sources.read({ category: 'music', item: 'track', properties: ['title', 'artist', 'album', 'playing'], plugin: MUSIC }, done, 10000);
}

module.exports = { ask: ask, describe: describe, read: read, MUSIC: MUSIC };
