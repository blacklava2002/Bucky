// Builds settings-preview.html: the real settings page with a stand-in for the Pebble app, fed
// by the real phone side after a few made-up requests, so CI can screenshot it in Chrome.
// Usage: node .github/emulator/settings-preview.js > settings-preview.html
const fs = require('fs');
const path = require('path');

const listeners = {};
const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};
const agent = (uuid, name) => ({ uuid, name, sources: [], actions: [{ name: 'send_to_agent' }] });
let museCalls = 0;
global.Pebble = {
  addEventListener: (name, fn) => { listeners[name] = fn; },
  sendAppMessage: (msg, ok) => { ok && ok(); },
  enumeratePlugins: () => [agent('0d33014e-5d56-42ea-9665-3ebf182b4cfb', 'Claude'), agent('b8346592-cd59-4b83-9185-87d94e0734b0', 'Muse')],
  invokeAction: (req) => {
    if (req.args && req.args.message && /bread/.test(req.args.message)) {
      museCalls++;
      return Promise.resolve({ ok: false, code: 'PLUGIN_UNAVAILABLE', message: 'Plugin is not running' });
    }
    return Promise.resolve({ ok: true });
  },
  subscribeToSource: () => ({ unsubscribe() {} }),
  sendConfigMessage: () => {},
  getActiveWatchInfo: () => ({ platform: 'emery' }),
};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const mod = require(path.resolve('src/pkjs/index.js'));
mod.AGENT_RETRY.delaysMs = [5, 5];

const said = ['set an alarm for 7am tomorrow', 'set a reminder for 4:05 to get the kids ready',
  'set a timer for 4:05 to take the kids home', 'what is the weather', 'set a timer for 10 minutes',
  'tell Muse to pick up bread on the way home', 'ask Claude what to make for dinner'];
let id = 1;
function next() {
  if (!said.length) return finish();
  listeners.appmessage({ payload: { TRANSCRIPT: said.shift(), REQ_ID: id++ } });
  setTimeout(next, 60);
}
function ask(data) {
  return new Promise((resolve) => listeners.configmessage({ data, respond: resolve }));
}
async function finish() {
  const state = await ask({ type: 'state' });
  const log = await ask({ type: 'log' });
  const exported = await ask({ type: 'exportLog' });
  const backup = await ask({ type: 'backup' });
  const html = fs.readFileSync('config.html', 'utf8');
  const stub = `<script>
var STATE = ${JSON.stringify(state)}, LOG = ${JSON.stringify(log)}, handlers = {};
var REPLIES = { log: LOG, exportLog: ${JSON.stringify(exported)}, backup: ${JSON.stringify(backup)} };
window.Pebble = {
  addEventListener: function (n, f) { handlers[n] = f; },
  sendMessage: function (to, m) { return Promise.resolve(REPLIES[m.type] || STATE); }
};
window.addEventListener('load', function () {
  handlers.ready && handlers.ready({ target: 'pkjs' });
  setTimeout(function () {
    var d = document.querySelectorAll('.log details')[1]; if (d) d.open = true;
    document.getElementById('exportCsv').click();
    document.getElementById('backup').click();
  }, 200);
});
</script>`;
  process.stdout.write(html.replace('<script>', stub + '\n<script>'));
}
listeners.ready && listeners.ready();
setTimeout(next, 20);
