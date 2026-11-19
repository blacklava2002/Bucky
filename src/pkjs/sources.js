// One reading of another plugin's source (weather, the phone's battery, ...).
// Subscribes, takes the first answer, unsubscribes. done(err, instance) gets the first instance,
// or every instance when request.all is set.

function read(request, done, timeoutMs) {
  var finished = false;
  var subscription = null;
  var timer = null;
  function finish(err, instance) {
    if (finished) return;
    finished = true;
    if (timer) clearTimeout(timer);
    setTimeout(function () { if (subscription) subscription.unsubscribe(); }, 0);
    done(err, instance);
  }
  if (typeof Pebble === 'undefined' || !Pebble.subscribeToSource) {
    finish({ code: 'UNSUPPORTED' });
    return;
  }
  timer = setTimeout(function () { finish({ code: 'TIMEOUT' }); }, timeoutMs || 20000);
  var config = {
    category: request.category,
    item: request.item,
    properties: request.properties,
    onData: function (envelope) {
      var instances = (envelope && envelope.instances) || [];
      if (request.all) finish(null, instances);
      else if (instances[0]) finish(null, instances[0]);
      else finish({ code: 'NO_DATA' });
    },
    onError: function (err) { finish(err || { code: 'ERROR' }); },
  };
  if (request.plugin) config.plugin = request.plugin;
  try {
    subscription = Pebble.subscribeToSource(config);
  } catch (e) {
    finish({ code: 'ERROR', message: String((e && e.message) || e) });
  }
}

module.exports = { read: read };
