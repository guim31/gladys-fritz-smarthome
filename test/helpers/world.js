// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a simulated FRITZ!Box
// (test/helpers/fakeBox.js), a manual clock, and the integration wired on
// top through registerHandlers. Nothing touches the network.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { PASSWORD, USERNAME, createFakeBox } from './fakeBox.js';

process.env.LOG_LEVEL ??= 'silent';

/** Raw answers of the core to the SSDP scan (anonymized addresses). */
export const SSDP_RESULTS = JSON.parse(
  readFileSync(new URL('../fixtures/aha/ssdp-results.json', import.meta.url), 'utf8'),
);

export const CONFIG = { host: '192.0.2.1', username: USERNAME, password: PASSWORD };

/** A manual clock, in the time of the fixtures (January 2024). */
export function createClock(start = 1_704_628_000_000) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** Lets pending callbacks (fire-and-forget promises) run. */
export const flush = () => new Promise((resolve) => setImmediate(resolve));

/**
 * @param {object} [options]
 * @param {object} [options.config] raw integration config (CONFIG by default)
 * @param {object} [options.box] options of createFakeBox
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {Array|null} [options.ssdp] raw SSDP results, null: no capture declared
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers] true: the hub's own timers run
 */
export async function createWorld({
  config = CONFIG,
  box: boxOptions = {},
  devices = [],
  ssdp = SSDP_RESULTS,
  connect = true,
  timers = false,
} = {}) {
  const box = createFakeBox(boxOptions);
  const gladys = createFakeGladys({
    config,
    devices,
    scanResults: ssdp === null ? {} : { ssdp },
  });
  const clock = createClock();
  const app = registerHandlers(gladys, {
    request: box.request,
    timers,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await app.hub.running;
  }
  return { gladys, fake: gladys.fake, app, hub: app.hub, box, clock };
}

/** The device published under a name, from the last discovery list. */
export const discovered = (world, name) =>
  world.fake.discoveredDevices.find((device) => device.name === name);

/** Create a discovered device in Gladys, as the user would. */
export async function create(world, device) {
  if (!device) {
    throw new Error('No such discovered device');
  }
  await world.fake.deviceCreated(device);
  return device;
}

/** Create every discovered device. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await create(world, device);
  }
}

/** External id of one feature of a device. */
export const featureId = (device, key) =>
  device.features.find((feature) => feature.external_id.endsWith(`:${key}`))?.external_id;

export const feature = (device, key) =>
  device.features.find((entry) => entry.external_id.endsWith(`:${key}`));

/** The last state published for a feature of a device. */
export const state = (world, device, key) => world.fake.lastState(featureId(device, key));

/** Scene events fired with a key. */
export const events = (world, key) =>
  world.fake.sceneEvents.filter((event) => event.key === key).map((event) => event.data);
