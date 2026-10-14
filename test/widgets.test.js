// -----------------------------------------------------------------------------
// The `smart_home` widget: valid for the core (budget, references), the right
// devices, readable rows.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { MAX_STATUS_ROWS } from '../src/widgets.js';
import { CONFIG, create, createWorld, discovered } from './helpers/world.js';

const get = async (world, settings = {}, language = 'en') => {
  const ack = await world.fake.widgetGet('smart_home', { settings, language });
  assert.equal(ack.success, true, ack.error);
  validateWidgetContent(ack.data.content);
  return ack.data.content;
};

test('every device of the box when none is added: tiles and ten rows, thermostats first', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const content = await get(world);
  const [power, heating, windows, status] = content.components;
  assert.deepEqual(power, { type: 'value', value: '1 W', label: 'Plugs', icon: 'zap' });
  assert.deepEqual(heating, {
    type: 'value',
    value: '3 / 4',
    label: 'Heating',
    icon: 'thermometer',
  });
  assert.deepEqual(windows, { type: 'value', value: 1, label: 'Windows open', icon: 'wind' });
  assert.equal(status.items.length, MAX_STATUS_ROWS);
  assert.deepEqual(
    status.items.slice(0, 5).map((row) => [row.label, row.value]),
    [
      ['Badezimmer', '20.5 °C → 18 °C · battery low'],
      ['Kitchen', 'Out of reach'],
      ['Wohnzimmer', '26.5 °C · Boost'],
      ['Wohnzimmer Couch', '22 °C → 21.5 °C'],
      ['Steckdose', 'On · 1 W'],
    ],
  );
});

test('the added devices, or the chosen ones; French numbers', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, language: 'fr' } });
  t.after(() => world.app.stop());
  await create(world, discovered(world, 'Rollladen'));
  await create(world, discovered(world, 'Fenster'));
  const added = await get(world, {}, 'fr');
  assert.deepEqual(
    added.components.at(-1).items.map((row) => [row.label, row.value]),
    [
      ['Rollladen', 'Ouvert 1 %'],
      ['Fenster', 'Ouvert'],
    ],
  );
  const chosen = await get(
    world,
    { devices: [discovered(world, 'Wohnzimmer Couch').external_id] },
    'fr',
  );
  assert.deepEqual(chosen.components.at(-1).items[0].value, '22 °C → 21,5 °C');
});

test('not connected: a single text', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, password: 'wrong' } });
  t.after(() => world.app.stop());
  const content = await get(world, {}, 'de');
  assert.equal(content.components.length, 1);
  assert.match(content.components[0].text, /Keine Verbindung/);
});

test('no device in the box: a single text', async (t) => {
  const world = await createWorld({
    box: { xml: '<?xml version="1.0"?><devicelist version="1"></devicelist>' },
  });
  t.after(() => world.app.stop());
  const content = await get(world, {}, 'es');
  assert.equal(content.components.length, 1);
  assert.match(content.components[0].text, /Todavía no hay/);
});
