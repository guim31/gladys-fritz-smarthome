// -----------------------------------------------------------------------------
// The hub through the full SDK wiring (src/app.js) on the SDK's fake Gladys
// and a simulated FRITZ!Box: connection, discovery, states, the container's
// own timer, commands, scene events, failures, quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS } from '../src/messages.js';
import { captureLogs } from './helpers/logs.js';
import { PASSWORD } from './helpers/fakeBox.js';
import {
  CONFIG,
  create,
  createAll,
  createWorld,
  discovered,
  events,
  featureId,
  flush,
  state,
} from './helpers/world.js';

const PLUG = '11657 0000101';
const DECT302 = '11657 0000103';
const DECT301 = '11657 0000104';
const COMET = '11657 0000105';
const BLIND = '11657 0000109-1';
const BULB = '11657 0000110-1';

async function worldWithAll(t, options = {}) {
  const world = await createWorld(options);
  t.after(() => world.app.stop());
  await createAll(world);
  return world;
}

const setValue = (world, name, key, value) => {
  const device = discovered(world, name);
  return world.fake.setValue(
    device,
    device.features.find((f) => f.external_id.endsWith(`:${key}`)),
    value,
  );
};

const lastCommand = (world) => world.box.commands.at(-1);

test('at start: connected, every device proposed, nothing published before creation', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(world.fake.discoveredDevices.length, 12);
  const plug = discovered(world, 'Steckdose');
  assert.equal(plug.should_poll, false);
  assert.equal(plug.model, 'FRITZ!DECT 200');
  assert.deepEqual(plug.params, [
    { name: 'AIN', value: PLUG },
    { name: 'FIRMWARE', value: '04.25' },
  ]);
  assert.match(plug.external_id, /:dect:116570000101$/);
  assert.equal(plug.features[0].name, 'Alimentation', 'French names by default');
  assert.deepEqual(world.fake.states, []);
  assert.deepEqual(
    world.box.commands.map((c) => c.switchcmd),
    ['getdevicelistinfos'],
  );
});

test('creating a device publishes all its states at once and refreshes the widget', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const thermostat = await create(world, discovered(world, 'Wohnzimmer'));
  assert.equal(state(world, thermostat, 'target'), 23.5);
  assert.equal(state(world, thermostat, 'mode'), 1);
  assert.equal(state(world, thermostat, 'window'), 1, 'closed');
  assert.equal(state(world, thermostat, 'boost'), 1);
  assert.equal(state(world, thermostat, 'temperature'), 26.5);
  assert.equal(state(world, thermostat, 'battery'), 90);
  assert.equal(world.fake.states.length, 6, 'only the created device');
  assert.ok(world.fake.widgetRefreshes.includes('smart_home'));
});

test('only changes are published, at the configured pace of the container timer, without onPoll', async (t) => {
  const world = await worldWithAll(t, { timers: true });
  const plug = discovered(world, 'Steckdose');
  const before = world.fake.states.length;
  const reads = () => world.box.commands.filter((c) => c.switchcmd === 'getdevicelistinfos').length;
  const readsBefore = reads();
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  // Timers armed before the mock keep running: arm the cycle again under it.
  world.hub.schedule();
  world.box.edit(PLUG, (block) => block.replace('<power>1000</power>', '<power>42500</power>'));
  t.mock.timers.tick(30000);
  await world.hub.running;
  assert.equal(reads(), readsBefore + 1, 'one read per period');
  assert.equal(world.fake.states.length, before + 1);
  assert.equal(state(world, plug, 'power'), 42.5);
  t.mock.timers.tick(30000);
  await world.hub.running;
  assert.equal(world.fake.states.length, before + 1, 'nothing moved');
});

test('onPoll is a fallback: skipped when the timer read the box recently', async (t) => {
  const world = await worldWithAll(t);
  const plug = discovered(world, 'Steckdose');
  const reads = () => world.box.commands.filter((c) => c.switchcmd === 'getdevicelistinfos').length;
  const before = reads();
  await world.fake.poll(plug);
  assert.equal(reads(), before);
  world.clock.advance(20000);
  await world.fake.poll(plug);
  assert.equal(reads(), before + 1);
});

test('a plug is switched with setswitchon/setswitchoff, the state follows at once', async (t) => {
  const world = await worldWithAll(t);
  const plug = discovered(world, 'Steckdose');
  assert.deepEqual(await setValue(world, 'Steckdose', 'switch', 0), { success: true });
  assert.deepEqual(lastCommand(world), { switchcmd: 'setswitchoff', ain: PLUG });
  assert.equal(state(world, plug, 'switch'), 0);
  await setValue(world, 'Steckdose', 'switch', 1);
  assert.deepEqual(lastCommand(world), { switchcmd: 'setswitchon', ain: PLUG });
  assert.equal(state(world, plug, 'switch'), 1);
});

test('a plug locked in the box refuses, with a message in the configured language', async (t) => {
  const world = await worldWithAll(t);
  world.box.setTag(PLUG, 'lock', 1);
  await world.hub.cycle();
  const ack = await setValue(world, 'Steckdose', 'switch', 0);
  assert.equal(ack.success, false);
  assert.match(ack.error, /verrouillé/);
  assert.notEqual(lastCommand(world).switchcmd, 'setswitchoff');
});

test('a lamp: on/off, brightness and colour', async (t) => {
  const world = await worldWithAll(t);
  const bulb = discovered(world, 'FRITZ!DECT 500 Büro');
  await setValue(world, 'FRITZ!DECT 500 Büro', 'light', 0);
  assert.deepEqual(lastCommand(world), { switchcmd: 'setsimpleonoff', ain: BULB, onoff: '0' });
  await setValue(world, 'FRITZ!DECT 500 Büro', 'brightness', 60);
  assert.deepEqual(lastCommand(world), {
    switchcmd: 'setlevelpercentage',
    ain: BULB,
    level: '60',
  });
  assert.equal(state(world, bulb, 'brightness'), 60);
  await setValue(world, 'FRITZ!DECT 500 Büro', 'color', 0x00ff00);
  assert.deepEqual(lastCommand(world), {
    switchcmd: 'setunmappedcolor',
    ain: BULB,
    hue: '120',
    saturation: '255',
    duration: '0',
  });
  await world.hub.cycle();
  assert.equal(state(world, bulb, 'color'), 0x00ff00, 'read back from the box');
});

test('a blind: position (100 = open) and open / stop / close', async (t) => {
  const world = await worldWithAll(t);
  const blind = discovered(world, 'Rollladen');
  await setValue(world, 'Rollladen', 'position', 70);
  assert.deepEqual(lastCommand(world), {
    switchcmd: 'setlevelpercentage',
    ain: BLIND,
    level: '30',
  });
  assert.equal(state(world, blind, 'position'), 70);
  for (const [value, target] of [
    [1, 'open'],
    [0, 'stop'],
    [-1, 'close'],
  ]) {
    await setValue(world, 'Rollladen', 'shutter', value);
    assert.deepEqual(lastCommand(world), { switchcmd: 'setblind', ain: BLIND, target });
  }
  world.clock.advance(3000);
  await world.hub.cycle();
  assert.equal(state(world, blind, 'position'), 0, 'closed');
});

test('thermostat target: half degrees, bounded to 8-28 °C', async (t) => {
  const world = await worldWithAll(t);
  const thermostat = discovered(world, 'Wohnzimmer Couch');
  await setValue(world, 'Wohnzimmer Couch', 'target', 20.4);
  assert.deepEqual(lastCommand(world), { switchcmd: 'sethkrtsoll', ain: DECT301, param: '41' });
  assert.equal(state(world, thermostat, 'target'), 20.5);
  await setValue(world, 'Wohnzimmer Couch', 'target', 35);
  assert.equal(lastCommand(world).param, '56', '28 °C at most');
  await setValue(world, 'Wohnzimmer Couch', 'target', 2);
  assert.equal(lastCommand(world).param, '16', '8 °C at least, never "off" through the target');
  assert.equal(state(world, thermostat, 'target'), 8);
});

test('thermostat mode: off closes the valve, heating returns to the programme, never "on" (254)', async (t) => {
  const world = await worldWithAll(t);
  const thermostat = discovered(world, 'Wohnzimmer');
  await setValue(world, 'Wohnzimmer', 'mode', 0);
  assert.deepEqual(lastCommand(world), { switchcmd: 'sethkrtsoll', ain: DECT302, param: '253' });
  assert.equal(state(world, thermostat, 'mode'), 0);
  await world.hub.cycle();
  assert.equal(state(world, thermostat, 'mode'), 0, 'read back');
  // Next switch to 22 °C (comfort): an eco period, back to eco (18 °C).
  await setValue(world, 'Wohnzimmer', 'mode', 1);
  assert.deepEqual(lastCommand(world), { switchcmd: 'sethkrtsoll', ain: DECT302, param: '36' });
  assert.equal(state(world, thermostat, 'mode'), 1);
  // Already heating: nothing sent.
  const count = world.box.commands.length;
  await setValue(world, 'Wohnzimmer', 'mode', 1);
  assert.equal(world.box.commands.length, count);
  assert.ok(!world.box.commands.some((c) => c.param === '254'));
});

test('thermostat in summer mode, on holiday or locked: commands refused', async (t) => {
  const world = await worldWithAll(t);
  for (const [tag, pattern] of [
    ['summeractive', /mode été/],
    ['holidayactive', /vacances/],
    ['lock', /verrouillé/],
  ]) {
    world.box.setTag(DECT301, tag, 1);
    await world.hub.cycle();
    const ack = await setValue(world, 'Wohnzimmer Couch', 'target', 21);
    assert.equal(ack.success, false, tag);
    assert.match(ack.error, pattern);
    world.box.setTag(DECT301, tag, 0);
  }
  assert.ok(!world.box.commands.some((c) => c.switchcmd === 'sethkrtsoll'));
});

test('a device out of reach refuses commands; its loss and return are logged once', async (t) => {
  const world = await worldWithAll(t);
  const logs = captureLogs(t);
  world.box.setTag(PLUG, 'present', 0);
  await world.hub.cycle();
  await world.hub.cycle();
  const ack = await setValue(world, 'Steckdose', 'switch', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /hors de portée/);
  world.box.setTag(PLUG, 'present', 1);
  await world.hub.cycle();
  assert.deepEqual(logs, [
    '[INFO] [fritz-smarthome] Steckdose is out of reach of the box',
    '[INFO] [fritz-smarthome] Steckdose is back in reach of the box',
  ]);
});

test('button presses fire the trigger, with the button and the press; the first read is a baseline', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(
    events(world, 'button_pressed'),
    [],
    'presses before the start are not replayed',
  );
  const dect440 = discovered(world, 'Taster Wohnzimmer');
  const dect400 = discovered(world, 'Taster Flur');
  world.box.press('11657 0000111-3', 1704628100);
  world.box.press('11657 0000112-9', 1704628105);
  await world.hub.cycle();
  await flush();
  assert.deepEqual(events(world, 'button_pressed'), [
    {
      device: dect440.external_id,
      device_name: 'Taster Wohnzimmer',
      button: 'bottom_right',
      press: 'short',
    },
    { device: dect400.external_id, device_name: 'Taster Flur', button: 'main', press: 'long' },
  ]);
  await world.hub.cycle();
  await flush();
  assert.equal(events(world, 'button_pressed').length, 2, 'once per press');
});

test('a thermostat entering "window open" fires the trigger with the minutes left', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const end = Math.floor(world.clock.now() / 1000) + 15 * 60;
  world.box.setTag(DECT301, 'windowopenactiv', 1);
  world.box.setTag(DECT301, 'windowopenactiveendtime', end);
  await world.hub.cycle();
  await flush();
  assert.deepEqual(events(world, 'window_open_detected'), [
    {
      device: discovered(world, 'Wohnzimmer Couch').external_id,
      device_name: 'Wohnzimmer Couch',
      minutes: 15,
    },
  ]);
  const thermostat = await create(world, discovered(world, 'Wohnzimmer Couch'));
  assert.equal(state(world, thermostat, 'window'), 0, 'open is 0 for Gladys');
});

test('a battery turning low fires the trigger once', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.deepEqual(events(world, 'battery_low'), [], 'already low at start: no event');
  world.box.setTag(DECT302, 'batterylow', 1);
  world.box.setTag(DECT302, 'battery', 15);
  await world.hub.cycle();
  await world.hub.cycle();
  await flush();
  assert.deepEqual(events(world, 'battery_low'), [
    {
      device: discovered(world, 'Wohnzimmer').external_id,
      device_name: 'Wohnzimmer',
      battery: 15,
    },
  ]);
  assert.equal(discovered(world, 'Badezimmer').model, 'Comet DECT');
  void COMET;
});

test('a new device paired in the box is proposed at the next read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.box.xml = world.box.xml.replace(
    '<group identifier="65:3A:18-900"',
    '<device identifier="11657 0000199" id="40" functionbitmask="2944" fwversion="04.25" manufacturer="AVM" productname="FRITZ!DECT 210"><present>1</present><name>Garten</name><switch><state>0</state><lock>0</lock></switch><powermeter><power>0</power><energy>12</energy></powermeter><temperature><celsius>110</celsius></temperature></device><group identifier="65:3A:18-900"',
  );
  await world.hub.cycle();
  assert.ok(discovered(world, 'Garten'));
  assert.equal(world.fake.discoveredDevices.length, 13);
});

test('an expired session is renewed without the user noticing', async (t) => {
  const world = await worldWithAll(t);
  world.box.expireSessions();
  await world.hub.cycle();
  assert.equal(world.box.logins, 2);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a refused password: told in the configuration, no new login for 15 minutes', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, password: 'wrong' } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.deepEqual(world.fake.connectionStatus.message.fr, STATUS.fr.auth);
  await world.hub.cycle();
  await world.hub.cycle();
  assert.equal(world.box.failedLogins, 1, 'the box would block the next attempts');
  world.clock.advance(15 * 60 * 1000);
  await world.hub.cycle();
  assert.equal(world.box.failedLogins, 2);
  await world.fake.configUpdated({ ...CONFIG });
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('blocked logins wait for the delay of the box', async (t) => {
  const world = await createWorld({ connect: false });
  t.after(() => world.app.stop());
  world.box.blockTime = 64;
  await world.gladys.connect();
  await world.app.ready;
  assert.match(world.fake.connectionStatus.message.en, /64 s/);
  world.box.blockTime = 0;
  await world.hub.cycle();
  assert.equal(world.fake.connectionStatus.connected, false, 'still waiting');
  world.clock.advance(64000);
  await world.hub.cycle();
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a user without the "Smart Home" right is told which right is missing', async (t) => {
  const world = await createWorld({ box: { smartHome: false } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.de, /Smart Home/);
});

test('missing credentials: asked for, nothing sent to the box', async (t) => {
  const world = await createWorld({ config: { host: '192.0.2.1' } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus.message.en, STATUS.en.credentials);
  assert.deepEqual(world.box.paths, []);
});

test('without an address: the box is found by the SSDP search of the core', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, host: '' } });
  t.after(() => world.app.stop());
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(world.hub.client.host, '192.0.2.1');
  assert.equal(world.fake.scans.length, 1);
  // The address found is kept for the next sessions.
  world.box.expireSessions();
  world.hub.client = null;
  await world.hub.cycle();
  assert.equal(world.fake.scans.length, 1);
});

test('a silent box: one warning, one line when it is back, and the status follows', async (t) => {
  const world = await worldWithAll(t);
  const logs = captureLogs(t);
  world.box.reachable = false;
  await world.hub.cycle();
  await world.hub.cycle();
  assert.match(world.fake.connectionStatus.message.en, /does not answer at 192.0.2.1/);
  world.box.reachable = true;
  await world.hub.cycle();
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(logs.length, 2, logs.join('\n'));
  assert.match(logs[0], /\[WARN\].*Reading the FRITZ!Box failed/);
  assert.match(logs[1], /\[INFO\].*works again/);
  assert.ok(!logs.join('\n').includes(PASSWORD));
});

test('a normal read cycle writes nothing at the info level', async (t) => {
  const world = await worldWithAll(t);
  const logs = captureLogs(t);
  world.box.edit(PLUG, (block) => block.replace('<power>1000</power>', '<power>2000</power>'));
  world.box.press('11657 0000111-1', 1704629000);
  await world.hub.cycle();
  await world.hub.cycle();
  await flush();
  assert.deepEqual(logs, []);
});

test('a reconnection to Gladys publishes everything again', async (t) => {
  const world = await worldWithAll(t);
  const before = world.fake.states.length;
  await world.gladys.disconnect();
  await world.gladys.connect();
  await world.hub.running;
  assert.ok(world.fake.states.length >= before + 20);
});

test('the language of the feature names follows the configuration', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, language: 'de' } });
  t.after(() => world.app.stop());
  const thermostat = discovered(world, 'Wohnzimmer');
  assert.deepEqual(
    thermostat.features.map((f) => f.name),
    [
      'Solltemperatur',
      'Heizen',
      'Fenster (Fenster-offen-Modus)',
      'Boost',
      'Temperatur',
      'Batterie',
    ],
  );
  await world.fake.configUpdated({ ...CONFIG, language: 'es' });
  assert.equal(discovered(world, 'Wohnzimmer').features[0].name, 'Temperatura objetivo');
  assert.equal(
    featureId(thermostat, 'target'),
    featureId(discovered(world, 'Wohnzimmer'), 'target'),
  );
});

test('test_connection reports the box and the devices; a wrong password is answered, not thrown', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Connected to the FRITZ!Box at 192.0.2.1. 12 smart home device(s), 1 out of reach. Open the Discover tab to add them to Gladys.',
  );
  const wrong = await createWorld({ config: { ...CONFIG, password: 'wrong' } });
  t.after(() => wrong.app.stop());
  const refused = await wrong.fake.action('test_connection', {});
  assert.equal(refused.success, true);
  assert.equal(refused.data.message.fr, STATUS.fr.auth);
});

test('stopping closes the session with the box', async (t) => {
  const world = await createWorld();
  assert.equal(world.box.sessions.size, 1);
  await world.app.stop();
  assert.equal(world.box.sessions.size, 0);
  void t;
});

test('a button back in reach does not replay its last press', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.box.setTag('11657 0000112', 'present', 0);
  world.box.press('11657 0000112-1', '');
  await world.hub.cycle();
  world.box.setTag('11657 0000112', 'present', 1);
  world.box.press('11657 0000112-1', 1609594100);
  await world.hub.cycle();
  await flush();
  assert.deepEqual(events(world, 'button_pressed'), []);
});

test('a device out of reach keeps its features: no "Update" proposed in Discover', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const before = discovered(world, 'Wohnzimmer Couch').features.map((f) => f.external_id);
  world.box.edit(DECT301, (block) =>
    block
      .replace('<present>1</present>', '<present>0</present>')
      .replace(/<windowopenactiv>0<\/windowopenactiv>/, '')
      .replace(/<boostactive>0<\/boostactive>/, '')
      .replace(/<battery>80<\/battery>/g, ''),
  );
  await world.hub.cycle();
  assert.deepEqual(
    discovered(world, 'Wohnzimmer Couch').features.map((f) => f.external_id),
    before,
  );
});

test('a device busy with a command (txbusy) or just commanded does not bounce back', async (t) => {
  const world = await worldWithAll(t);
  const plug = discovered(world, 'Steckdose');
  await setValue(world, 'Steckdose', 'switch', 0);
  // The box answered, the plug has not switched yet.
  world.box.setTag(PLUG, 'state', 1);
  world.box.setTag(PLUG, 'txbusy', 1);
  world.clock.advance(5000);
  await world.hub.cycle();
  assert.equal(state(world, plug, 'switch'), 0);
  world.box.setTag(PLUG, 'state', 0);
  world.box.setTag(PLUG, 'txbusy', 0);
  await world.hub.cycle();
  assert.equal(state(world, plug, 'switch'), 0);
});

test('an arbitrary colour is published as the box will report it', async (t) => {
  const world = await worldWithAll(t);
  const bulb = discovered(world, 'FRITZ!DECT 500 Büro');
  await setValue(world, 'FRITZ!DECT 500 Büro', 'color', 0x804020);
  const published = state(world, bulb, 'color');
  world.clock.advance(5000);
  await world.hub.cycle();
  assert.equal(state(world, bulb, 'color'), published);
  assert.equal(
    world.fake.states
      .filter((s) => s.device_feature_external_id === featureId(bulb, 'color'))
      .at(-1).state,
    published,
  );
});

test('found on the network: a repeater refusing the login does not hide the box', async (t) => {
  const repeater = '192.0.2.34';
  const world = await createWorld({ config: { ...CONFIG, host: '' }, connect: false });
  t.after(() => world.app.stop());
  const request = world.box.request;
  world.hub.request = async (options) =>
    new URL(options.url).hostname === repeater
      ? {
          status: 200,
          headers: {},
          body: '<SessionInfo><SID>0000000000000000</SID><Challenge>44b750c0</Challenge><BlockTime>0</BlockTime></SessionInfo>',
        }
      : request(options);
  // The repeater answers the search first.
  world.fake.scanResults.ssdp = [...world.fake.scanResults.ssdp].reverse();
  await world.gladys.connect();
  await world.app.ready;
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(world.hub.client.host, '192.0.2.1');
});

test('a scan during a read does not log in twice', async (t) => {
  const world = await createWorld({ config: { ...CONFIG, password: 'wrong' } });
  t.after(() => world.app.stop());
  world.hub.authBlockedUntil = 0;
  await Promise.all([world.hub.connectBox(), world.hub.connectBox(), world.fake.scanRequest()]);
  assert.equal(world.box.failedLogins, 2, 'one at start, one for the three callers');
});
