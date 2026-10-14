// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// inputs: the device list of test/fixtures/aha (plugs, thermostats of three
// generations, one out of reach, HAN-FUN detectors, a blind, a colour lamp,
// FRITZ!DECT 400 and 440 buttons, a repeater, groups), in every feature-name
// language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LANGUAGES } from '../src/config.js';
import { CONFIG, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

function checkDevice(device, where) {
  // should_poll: true if and only if poll_frequency is provided, in ms.
  if (device.poll_frequency === undefined) {
    assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
  } else {
    assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
    assert.ok(
      table.poll_frequencies_ms.includes(device.poll_frequency),
      `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
    );
  }
  assert.ok(device.features.length > 0, `${where}: no feature`);
  const externalIds = new Set();
  const names = new Set();
  for (const feature of device.features) {
    const at = `${where} / ${feature.name}`;
    const pair = table.pairs[`${feature.category}/${feature.type}`];
    assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
    assert.ok(pair.label_en && pair.label_fr && pair.icon, `${at}: couple without label or icon`);
    assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
    assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
    assert.ok(
      Number.isFinite(feature.min) && Number.isFinite(feature.max),
      `${at}: finite min/max`,
    );
    assert.ok(feature.min <= feature.max, `${at}: min > max`);
    assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
    assert.equal(typeof feature.has_feedback, 'boolean', `${at}: has_feedback must be a boolean`);
    if (feature.unit !== undefined) {
      assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
    }
    assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
    externalIds.add(feature.external_id);
    assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
    names.add(feature.name);
  }
}

for (const language of LANGUAGES) {
  test(`every discovered device follows the Gladys rules (${language} names)`, async (t) => {
    const devices = [];
    for (const login of ['pbkdf2', 'md5']) {
      const world = await createWorld({ config: { ...CONFIG, language }, box: { login } });
      t.after(() => world.app.stop());
      devices.push(...world.fake.discoveredDevices.map((device) => ({ device, label: login })));
    }
    assert.equal(
      devices.length,
      24,
      'twelve devices per box, the groups and HAN-FUN parents left out',
    );
    const deviceIds = new Set();
    for (const { device, label } of devices) {
      const where = `${label}: ${device.name}`;
      checkDevice(device, where);
      deviceIds.add(`${label}|${device.external_id}`);
    }
    assert.equal(deviceIds.size, devices.length, 'unique device external ids');
  });
}
