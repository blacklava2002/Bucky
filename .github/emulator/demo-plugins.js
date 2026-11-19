// CI screenshots only: a fake messaging plugin and an alias, so the "Select sends" screen can be
// shown. Appended to a throwaway copy of index.js after demo-weather.js; never in a release build.
(function () {
  var chat = { uuid: '8197c57a-59c8-493e-9db1-eaab2988d010', name: 'Chat', sources: [], actions: [
    { name: 'send_message', parameters: { type: 'object', properties: { recipient: {}, text: {}, operation_id: {} } } }] };
  var claude = { uuid: '0d33014e-5d56-42ea-9665-3ebf182b4cfb', name: 'Claude', sources: [], actions: [{ name: 'send_to_agent' }] };
  Pebble.enumeratePlugins = function () { return [claude, chat]; };
  Pebble.invokeAction = function (req) {
    var text = req.action === 'send_message' ? 'Sent to ' + req.args.recipient : 'Done';
    return new Promise(function (ok) { setTimeout(function () { ok({ ok: true, text: text }); }, 500); });
  };
  try {
    localStorage.setItem('aliases', JSON.stringify('Sam = Samantha, wife'));
    var list = DEFAULT_PROMPTS.slice(0, 9).concat(["Tell my wife I'm on my way."]);
    localStorage.setItem('prompts', JSON.stringify(list));
  } catch (e) { /* no storage */ }
})();
