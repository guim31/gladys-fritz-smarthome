// -----------------------------------------------------------------------------
// Reading `getdevicelistinfos` (src/aha/devicelist.js) and turning a device
// into Gladys values (src/devices.js), on the fixture of test/fixtures/aha.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FUNCTIONS, parseDeviceList } from '../src/aha/devicelist.js';
import { parseXml } from '../src/aha/xml.js';
import {
  OPENING,
  buttonOf,
  featureSpecs,
  hsToRgb,
  isPublishable,
  rgbToHs,
  valuesOf,
} from '../src/devices.js';
import { fixture } from './helpers/fakeBox.js';

const list = parseDeviceList(fixture('devicelist.xml'));
const byAin = (ain) => list.find((dev) => dev.ain === ain);
const keys = (dev) => featureSpecs(dev).map((spec) => spec.key);

test('every device and group is read, trimmed, with its capabilities', () => {
  assert.equal(list.length, 16);
  assert.equal(list.filter((dev) => dev.group).length, 2);
  const bulb = byAin('11657 0000110-1');
  assert.equal(bulb.name, 'FRITZ!DECT 500 Büro');
  assert.equal(bulb.present, true);
  assert.ok(bulb.has(FUNCTIONS.LIGHTBULB) && bulb.has(FUNCTIONS.COLOR));
  assert.deepEqual(
    list.filter(isPublishable).map((dev) => dev.ain),
    [
      '11657 0000101',
      '11657 0000102',
      '11657 0000103',
      '11657 0000104',
      '11657 0000105',
      '11657 0000106',
      '11657 0000107-1',
      '11657 0000108-1',
      '11657 0000109-1',
      '11657 0000110-1',
      '11657 0000111',
      '11657 0000112',
    ],
    'HAN-FUN parents (bit 0 only) and groups are not published',
  );
});

test('a plug: switch, power in W, energy in kWh, voltage in V, temperature with offset', () => {
  const plug = byAin('11657 0000101');
  assert.deepEqual(keys(plug), ['switch', 'power', 'energy', 'voltage', 'temperature']);
  assert.deepEqual(valuesOf(plug), {
    switch: 1,
    power: 1,
    energy: 0.707,
    voltage: 230,
    temperature: 28.5,
  });
});

test('thermostats: target in °C, mode, window (0 = open), boost, battery', () => {
  const dect302 = byAin('11657 0000103');
  assert.deepEqual(keys(dect302), ['target', 'mode', 'window', 'boost', 'temperature', 'battery']);
  assert.deepEqual(valuesOf(dect302), {
    target: 23.5,
    mode: 1,
    window: OPENING.CLOSED,
    boost: 1,
    temperature: 26.5,
    battery: 90,
  });
  // A Comet DECT of 2017: no window nor boost element, the battery inside <hkr>.
  const comet = byAin('11657 0000105');
  assert.deepEqual(keys(comet), ['target', 'mode', 'temperature', 'battery']);
  assert.equal(comet.batteryLow, true);
  assert.equal(valuesOf(comet).battery, 10);
});

test('thermostat off (253) and fully on (254): a mode, no target', () => {
  const dev = byAin('11657 0000104');
  dev.hkr.target = 253;
  assert.equal(valuesOf(dev).mode, 0);
  assert.equal(valuesOf(dev).target, undefined);
  dev.hkr.target = 254;
  assert.equal(valuesOf(dev).mode, 1);
  assert.equal(valuesOf(dev).target, undefined);
  dev.hkr.target = 43;
  dev.hkr.summer = true;
  assert.equal(valuesOf(dev).mode, 0, 'summer mode: the valve stays closed');
});

test('a device out of reach publishes nothing', () => {
  const kitchen = byAin('11657 0000106');
  assert.equal(kitchen.present, false);
  assert.deepEqual(valuesOf(kitchen), {});
  assert.deepEqual(keys(kitchen), ['target', 'mode', 'temperature']);
});

test('HAN-FUN detectors: a window contact open is 0, an empty smoke state is unknown', () => {
  const contact = byAin('11657 0000107-1');
  assert.equal(featureSpecs(contact)[0].category, 'opening-sensor');
  assert.deepEqual(valuesOf(contact), { alert: OPENING.OPEN });
  const smoke = byAin('11657 0000108-1');
  assert.equal(featureSpecs(smoke)[0].category, 'smoke-sensor');
  assert.deepEqual(valuesOf(smoke), {});
});

test('a blind: position open in percent (the box says how closed it is), no alarm feature', () => {
  const blind = byAin('11657 0000109-1');
  assert.deepEqual(keys(blind), ['position', 'shutter']);
  assert.deepEqual(valuesOf(blind), { position: 1 });
});

test('a colour lamp: on, brightness, colour from hue and saturation', () => {
  const bulb = byAin('11657 0000110-1');
  assert.deepEqual(keys(bulb), ['light', 'brightness', 'color']);
  assert.deepEqual(valuesOf(bulb), { light: 1, brightness: 1, color: hsToRgb(358, 180) });
  bulb.color.mode = 4;
  assert.equal(valuesOf(bulb).color, undefined, 'white mode: no colour');
});

test('colours: RGB and hue/saturation agree', () => {
  assert.equal(hsToRgb(0, 255), 0xff0000);
  assert.equal(hsToRgb(120, 255), 0x00ff00);
  assert.equal(hsToRgb(240, 255), 0x0000ff);
  assert.equal(hsToRgb(0, 0), 0xffffff);
  assert.deepEqual(rgbToHs(0xff0000), { hue: 0, saturation: 255 });
  assert.deepEqual(rgbToHs(0x00ff00), { hue: 120, saturation: 255 });
  assert.deepEqual(rgbToHs(0xffffff), { hue: 0, saturation: 0 });
  const { hue, saturation } = rgbToHs(hsToRgb(358, 180));
  assert.ok(Math.abs(hue - 358) <= 1 && Math.abs(saturation - 180) <= 1);
});

test('buttons: the four of a FRITZ!DECT 440, short and long of a FRITZ!DECT 400', () => {
  const dect440 = byAin('11657 0000111');
  assert.deepEqual(keys(dect440), ['temperature', 'humidity', 'battery']);
  assert.deepEqual(
    dect440.buttons.map((_, index) => buttonOf(dect440, index)),
    [
      { button: 'top_right', press: 'short' },
      { button: 'bottom_right', press: 'short' },
      { button: 'bottom_left', press: 'short' },
      { button: 'top_left', press: 'short' },
    ],
  );
  assert.equal(dect440.buttons[1].lastPressed, null);
  const dect400 = byAin('11657 0000112');
  assert.deepEqual(
    dect400.buttons.map((_, index) => buttonOf(dect400, index)),
    [
      { button: 'main', press: 'short' },
      { button: 'main', press: 'long' },
    ],
  );
  // Names in another language: the position decides.
  const english = { ...dect400, buttons: dect400.buttons.map((b) => ({ ...b, name: 'Hall' })) };
  assert.equal(buttonOf(english, 1).press, 'long');
});

test('the XML reader refuses what is not XML', () => {
  assert.throws(() => parseXml('<html><body>'));
  assert.throws(() => parseXml('<a></b>'));
  assert.throws(() => parseDeviceList('<SessionInfo><SID>0</SID></SessionInfo>'));
  assert.equal(parseXml('<a x="1 &amp; 2"><b>&lt;c&gt;</b></a>').attrs.x, '1 & 2');
});
