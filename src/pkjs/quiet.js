// Quiet Time while the app listens. A notification that pops up mid-sentence ends the
// watch's dictation, so when this is on in settings the app turns the watch's manual Quiet Time
// on, with its notifications hidden, just before it listens, and afterwards puts both settings
// back exactly as they were. Uses the Pebble app's built-in Watch Settings plugin.
//
// What it changed is kept in storage until it's put back, so a crash or a lost "done" from the
// watch still gets undone: on the next start, or after SAFETY_MS at the latest.

var WATCH_SETTINGS = '00000000-0000-0000-0001-000000000006';
var MANUAL = 'dndManuallyEnabled';     // Quiet Time - Manual (a switch)
var SHOW = 'dndShowNotifications';     // Quiet Time - Show Notifications: Show or Hide
var HIDE = 'Hide';
var KEY = 'quietRestore';
var READ_MS = 1500;
var SET_MS = 2500;
var SAFETY_MS = 90 * 1000;
// A put-back the watch didn't confirm is tried again, this often and this many times.
var RETRY_MS = 30 * 1000;
var RETRIES = 5;

// env: read(request, done, ms), invoke(args) -> Promise, load(key), save(key, value),
// setTimeout, clearTimeout, log.
function create(env) {
  var starting = false;
  var restoring = null;   // callbacks waiting for a restore to finish
  var waiters = [];
  var stopAfterStart = false;
  var stopWaiters = [];
  var safety = null;

  function record() {
    var r = env.load(KEY);
    return r && typeof r === 'object' && (r.manual !== undefined || r.show !== undefined) ? r : null;
  }

  // Runs each change, then done(allOk) once all have answered or SET_MS has passed.
  function apply(changes, done) {
    var left = changes.length;
    var finished = false;
    var timer = null;
    var allOk = true;
    function one(ok) {
      if (!ok) allOk = false;
      if (finished || --left > 0) return;
      finished = true;
      if (timer) env.clearTimeout(timer);
      done(allOk);
    }
    if (!left) { done(true); return; }
    timer = env.setTimeout(function () { left = 1; one(false); }, SET_MS);
    changes.forEach(function (args) {
      var call;
      try {
        call = env.invoke({ plugin: WATCH_SETTINGS, action: args.action, args: args.args });
      } catch (e) {
        env.log('quiet: ' + args.args.instanceId + ' failed: ' + e);
        one(false);
        return;
      }
      Promise.resolve(call).then(function (res) {
        var ok = !!(res && res.ok);
        if (!ok) env.log('quiet: ' + args.args.instanceId + ' refused: ' + JSON.stringify(res));
        one(ok);
      }, function (err) {
        env.log('quiet: ' + args.args.instanceId + ' failed: ' + ((err && err.message) || err));
        one(false);
      });
    });
  }

  function find(instances, id) {
    for (var i = 0; i < (instances || []).length; i++) {
      if (instances[i] && instances[i].instanceId === id) return instances[i];
    }
    return null;
  }

  function value(instance) {
    return (instance && instance.properties && instance.properties.value) || {};
  }

  function armSafety() {
    if (safety) env.clearTimeout(safety);
    safety = env.setTimeout(function () { safety = null; stop(); }, SAFETY_MS);
  }

  function finishStart() {
    starting = false;
    var list = waiters;
    waiters = [];
    list.forEach(function (fn) { fn(); });
    if (stopAfterStart) {
      stopAfterStart = false;
      var after = stopWaiters;
      stopWaiters = [];
      stop(function () { after.forEach(function (fn) { fn(); }); });
    }
  }

  // Turns Quiet Time on and its notifications off; done() when the watch should start listening.
  function start(done) {
    stopAfterStart = false;
    if (restoring) { restoring.push(function () { start(done); }); return; }
    waiters.push(done);
    if (starting) return;
    if (record()) { armSafety(); finishStart(); return; }
    starting = true;
    var switches = null;
    var texts = null;
    function readBoth() {
      if (switches === null || texts === null) return;
      var manual = find(switches, MANUAL);
      var show = find(texts, SHOW);
      var restore = {};
      var changes = [];
      var on = value(manual).boolean;
      if (manual && on && on.value === false) {
        restore.manual = false;
        changes.push({ action: 'set_on', args: { instanceId: MANUAL, on: true } });
      }
      var shown = value(show).shortText;
      if (show && shown && shown.text && shown.text !== HIDE) {
        restore.show = String(shown.text);
        changes.push({ action: 'set_value', args: { instanceId: SHOW, value: HIDE } });
      }
      if (!manual && !show) env.log('quiet: the Pebble app shows no Quiet Time settings');
      if (!changes.length) { finishStart(); return; }
      env.save(KEY, restore);
      armSafety();
      apply(changes, finishStart);
    }
    env.read({ plugin: WATCH_SETTINGS, category: 'watch', item: 'switch_setting', all: true }, function (err, list) {
      switches = err ? [] : list || [];
      readBoth();
    }, READ_MS);
    env.read({ plugin: WATCH_SETTINGS, category: 'watch', item: 'text_setting', all: true }, function (err, list) {
      texts = err ? [] : list || [];
      readBoth();
    }, READ_MS);
  }

  // Puts back whatever start() changed. done() is optional. What to put back stays in storage
  // until the watch confirms it, so a lost or refused change is tried again (and on the next
  // start) rather than leaving Quiet Time's notifications hidden for good.
  function stop(done) {
    if (starting) { stopAfterStart = true; if (done) stopWaiters.push(done); return; }
    if (safety) { env.clearTimeout(safety); safety = null; }
    var restore = record();
    if (!restore) { if (done) done(); return; }
    if (restoring) { if (done) restoring.push(done); return; }
    var changes = [];
    if (restore.manual !== undefined) changes.push({ action: 'set_on', args: { instanceId: MANUAL, on: !!restore.manual } });
    if (restore.show !== undefined) changes.push({ action: 'set_value', args: { instanceId: SHOW, value: String(restore.show) } });
    restoring = [];
    if (done) restoring.push(done);
    apply(changes, function (ok) {
      var tries = (restore.tries | 0) + 1;
      if (ok || tries >= RETRIES) {
        if (!ok) env.log('quiet: gave up putting Quiet Time back after ' + tries + ' tries');
        env.save(KEY, null);
      } else {
        restore.tries = tries;
        env.save(KEY, restore);
        safety = env.setTimeout(function () { safety = null; stop(); }, RETRY_MS);
      }
      var list = restoring;
      restoring = null;
      list.forEach(function (fn) { fn(); });
    });
  }

  return { start: start, stop: stop, pending: function () { return !!record(); } };
}

module.exports = { create: create, WATCH_SETTINGS: WATCH_SETTINGS, MANUAL: MANUAL, SHOW: SHOW };
