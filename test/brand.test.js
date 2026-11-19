const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const brand = require('../src/pkjs/brand');
const pkg = require('../package.json');

test('brand.js and package.json agree on the app', () => {
  assert.equal(brand.uuid, pkg.pebble.uuid);
  assert.equal(brand.name, pkg.pebble.displayName);
});

test('brand.h names the same app', () => {
  const h = fs.readFileSync(path.join(__dirname, '../src/c/brand.h'), 'utf8');
  assert.match(h, new RegExp('#define BRAND_NAME "' + brand.name + '"'));
});
