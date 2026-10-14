// -----------------------------------------------------------------------------
// The "Set a radiator thermostat" scene action on the simulated box.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutesOf } from '../src/scenes.js';
import { createWorld, discovered } from './helpers/world.js';

const DECT301 = '11657 0000104';

async function run(t, fields) {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const device = discovered(world, fields.device ?? 'Wohnzimmer Couch')?.external_id;
  const ack = await world.fake.sceneAction('set_thermostat_mode', { ...fields, device });
  return { world, ack, last: world.box.commands.at(-1) };
}

test('comfort and eco use the temperatures set in the FRITZ!Box', async (t) => {
  const comfort = await run(t, { mode: 'comfort' });
  assert.equal(comfort.ack.success, true);
  assert.deepEqual(comfort.last, { switchcmd: 'sethkrtsoll', ain: DECT301, param: '43' });
  const eco = await run(t, { mode: 'eco' });
  assert.deepEqual(eco.last, { switchcmd: 'sethkrtsoll', ain: DECT301, param: '35' });
});

test('boost and "window open" end by themselves: 30 and 15 minutes by default, 24 hours at most', async (t) => {
  const boost = await run(t, { mode: 'boost' });
  const now = Math.floor(boost.world.clock.now() / 1000);
  assert.deepEqual(boost.last, {
    switchcmd: 'sethkrboost',
    ain: DECT301,
    endtimestamp: String(now + 30 * 60),
  });
  const window = await run(t, { mode: 'window_open', duration_minutes: '45' });
  assert.equal(window.last.switchcmd, 'sethkrwindowopen');
  assert.equal(window.last.endtimestamp, String(now + 45 * 60));
  const long = await run(t, { mode: 'boost', duration_minutes: 5000 });
  assert.equal(long.last.endtimestamp, String(now + 1440 * 60));
  await long.world.hub.cycle();
  assert.equal(long.world.box.tag(DECT301, 'boostactive'), '1');
});

test('end_boost ends both modes', async (t) => {
  const { world, ack } = await run(t, { mode: 'end_boost' });
  assert.equal(ack.success, true);
  assert.deepEqual(
    world.box.commands.slice(-2).map((c) => [c.switchcmd, c.endtimestamp]),
    [
      ['sethkrboost', '0'],
      ['sethkrwindowopen', '0'],
    ],
  );
});

test('refused: not a thermostat, unknown mode, device out of reach', async (t) => {
  const plug = await run(t, { mode: 'comfort', device: 'Steckdose' });
  assert.equal(plug.ack.success, false);
  assert.match(plug.ack.error, /tête thermostatique/);
  const unknown = await run(t, { mode: 'on' });
  assert.equal(unknown.ack.success, false);
  const absent = await run(t, { mode: 'comfort', device: 'Kitchen' });
  assert.equal(absent.ack.success, false);
  assert.match(absent.ack.error, /hors de portée/);
});

test('minutes: numbers or texts, comma accepted, bounded', () => {
  assert.equal(minutesOf('12'), 12);
  assert.equal(minutesOf('7,6'), 8);
  assert.equal(minutesOf(''), 0);
  assert.equal(minutesOf(-3), 0);
  assert.equal(minutesOf(99999), 1440);
});
