
// CI screenshots only: the emulator has no plugin host, so fake one weather reading.
// Appended to a throwaway copy of index.js; never part of a release build.
if (!Pebble.subscribeToSource) {
  Pebble.subscribeToSource = function (request) {
    var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    var series = function (values, shape) {
      var s = { start: midnight.getTime() / 1000, stepSec: 86400 };
      s[shape || 'shortText'] = { values: values };
      return { series: s };
    };
    setTimeout(function () {
      request.onData({ instances: [{ properties: {
        name: { shortText: { text: 'Browns Mills' } },
        temperature: { shortText: { text: '52°F' } },
        feels_like: { shortText: { text: '48°F' } },
        condition: { shortText: { text: 'Partly cloudy' } },
        precipitation: { numericValue: { value: 10 } },
        daily_high: series(['55°F', '61°F', '48°F']),
        daily_low: series(['38°F', '45°F', '35°F']),
        daily_condition: series(['Partly cloudy', 'Rain', 'Cloudy'])
      } }] });
    }, 300);
    return { unsubscribe: function () {} };
  };
}
