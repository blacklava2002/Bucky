// "Flip a coin", answered on the phone side without any agent: Heads or Tails.

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[,!?.]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

var LEAD = '(?:(?:ok|okay|hey|please|can you|could you|would you|will you|go ahead and|lets|let us)\\s+)*';
var ASKS = [
  '(?:flip|toss) (?:a|the|me a) coin(?: for me)?',
  'coin (?:flip|toss)',
  '(?:do|give me) a coin (?:flip|toss)',
  'heads or tails',
  'call it heads or tails',
];
var ASK = new RegExp('^' + LEAD + '(?:' + ASKS.join('|') + ')(?: please)?$');

// The whole thing said has to be the coin ask: "flip a coin" or "heads or tails", with an
// "ok" or "please" around it. Anything longer goes on to the rest, so an agent still gets it.
function ask(text) {
  return ASK.test(normalize(text)) ? { what: 'coin' } : null;
}

// A fair flip. Takes the bit from crypto.getRandomValues when the phone has it.
function flip(random) {
  if (random) return random() < 0.5 ? 'Heads' : 'Tails';
  var c = typeof crypto !== 'undefined' ? crypto : null;
  if (c && c.getRandomValues) {
    var b = new Uint8Array(1);
    c.getRandomValues(b);
    return (b[0] & 1) ? 'Heads' : 'Tails';
  }
  return Math.random() < 0.5 ? 'Heads' : 'Tails';
}

module.exports = { ask: ask, flip: flip };
