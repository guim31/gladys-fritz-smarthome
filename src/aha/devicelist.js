// -----------------------------------------------------------------------------
// Reading `getdevicelistinfos`: one plain object per device of the box, in
// the units Gladys shows (W, kWh, V, °C), with null for what the box leaves
// empty (a device out of reach answers `<present>0</present>` and empty
// values).
//
// The capabilities come from `functionbitmask` (AVM "AHA-HTTP-Interface",
// pyfritzhome's FritzhomeDeviceFeatures). A HAN-FUN device (a Rollotron, a
// FRITZ!DECT 500) is listed twice: the device itself (bit 0 only, nothing to
// show) and its unit `<AIN>-1`, which carries the functions.
// Groups (`<group>`) are read too, but the integration does not publish them
// (src/devices.js).
// -----------------------------------------------------------------------------

import { child, childrenNamed, intOf, parseXml, textOf } from './xml.js';

export const FUNCTIONS = {
  HANFUN_DEVICE: 1 << 0,
  LIGHTBULB: 1 << 2,
  ALARM: 1 << 4,
  BUTTON: 1 << 5,
  THERMOSTAT: 1 << 6,
  POWER_METER: 1 << 7,
  TEMPERATURE: 1 << 8,
  SWITCH: 1 << 9,
  DECT_REPEATER: 1 << 10,
  MICROPHONE: 1 << 11,
  HANFUN_UNIT: 1 << 13,
  SWITCHABLE: 1 << 15,
  LEVEL: 1 << 16,
  COLOR: 1 << 17,
  BLIND: 1 << 18,
  HUMIDITY: 1 << 20,
};

// Target temperatures of `sethkrtsoll` / `<tsoll>`, in half degrees.
export const HKR = { OFF: 253, ON: 254, MIN: 16, MAX: 56 };

const bool = (value) => (value === null ? null : value !== 0);
const scaled = (value, divisor, digits) =>
  value === null ? null : Number((value / divisor).toFixed(digits));

function readHkr(node) {
  if (!node) {
    return null;
  }
  const tsoll = intOf(node, 'tsoll');
  const half = (key) => {
    const value = intOf(node, key);
    return value === null || value >= HKR.OFF ? null : value / 2;
  };
  const endTime = (key) => {
    const value = intOf(node, key);
    return value ? value : null;
  };
  const next = child(node, 'nextchange');
  return {
    measured: half('tist'),
    // Raw value: 253 (off) and 254 (on) are states, not temperatures.
    target: tsoll,
    comfort: half('komfort'),
    eco: half('absenk'),
    lock: bool(intOf(node, 'lock')),
    deviceLock: bool(intOf(node, 'devicelock')),
    errorCode: intOf(node, 'errorcode'),
    windowOpen: bool(intOf(node, 'windowopenactiv')),
    windowOpenEnd: endTime('windowopenactiveendtime'),
    boost: bool(intOf(node, 'boostactive')),
    boostEnd: endTime('boostactiveendtime'),
    summer: bool(intOf(node, 'summeractive')),
    holiday: bool(intOf(node, 'holidayactive')),
    // Unix time of the next switch of the weekly programme (0: none).
    nextChangeAt: intOf(next, 'endperiod') || null,
    nextTarget: next ? intOf(next, 'tchange') : null,
    batteryLow: bool(intOf(node, 'batterylow')),
    battery: intOf(node, 'battery'),
  };
}

function readColor(node) {
  if (!node) {
    return null;
  }
  return {
    mode: Number(node.attrs.current_mode) || null,
    fullColor: node.attrs.fullcolorsupport === '1',
    hue: intOf(node, 'hue'),
    saturation: intOf(node, 'saturation'),
    unmappedHue: intOf(node, 'unmapped_hue'),
    unmappedSaturation: intOf(node, 'unmapped_saturation'),
    temperature: intOf(node, 'temperature'),
  };
}

/** One `<device>` or `<group>` element. */
export function readDevice(node) {
  const functions = Number(node.attrs.functionbitmask) || 0;
  const has = (bit) => (functions & bit) !== 0;
  const switchNode = child(node, 'switch');
  const meter = child(node, 'powermeter');
  const temperature = child(node, 'temperature');
  const humidity = child(node, 'humidity');
  const level = child(node, 'levelcontrol');
  const blind = child(node, 'blind');
  const alert = child(node, 'alert');
  const unit = child(node, 'etsiunitinfo');
  const hkr = readHkr(child(node, 'hkr'));
  const rawHumidity = intOf(humidity, 'rel_humidity');
  return {
    ain: node.attrs.identifier ?? '',
    id: node.attrs.id ?? '',
    group: node.name === 'group',
    name: textOf(node, 'name') || node.attrs.identifier || '',
    productName: node.attrs.productname ?? '',
    manufacturer: node.attrs.manufacturer ?? '',
    firmware: node.attrs.fwversion ?? '',
    functions,
    has,
    present: intOf(node, 'present') === 1,
    // The device is still applying a command (FRITZ!OS 7.20+).
    txbusy: intOf(node, 'txbusy') === 1,
    unitType: intOf(unit, 'unittype'),
    // Battery: on the device since FRITZ!OS 7.08, inside <hkr> before.
    battery: intOf(node, 'battery') ?? hkr?.battery ?? null,
    batteryLow: bool(intOf(node, 'batterylow')) ?? hkr?.batteryLow ?? null,
    hasBattery: child(node, 'battery') !== null || child(child(node, 'hkr'), 'battery') !== null,
    // The temperature includes the offset set in the box.
    temperature: has(FUNCTIONS.TEMPERATURE) ? scaled(intOf(temperature, 'celsius'), 10, 1) : null,
    // -9999: no valid value yet.
    humidity: rawHumidity === null || rawHumidity < 0 ? null : rawHumidity,
    switch: switchNode
      ? { on: bool(intOf(switchNode, 'state')), lock: bool(intOf(switchNode, 'lock')) }
      : null,
    simpleOn: bool(intOf(child(node, 'simpleonoff'), 'state')),
    meter: meter
      ? {
          power: scaled(intOf(meter, 'power'), 1000, 2),
          energy: scaled(intOf(meter, 'energy'), 1000, 3),
          voltage: scaled(intOf(meter, 'voltage'), 1000, 1),
          hasVoltage: child(meter, 'voltage') !== null,
        }
      : null,
    levelPercent: intOf(level, 'levelpercentage'),
    blind: blind ? { endPositionsSet: bool(intOf(blind, 'endpositionsset')) } : null,
    alert: alert ? bool(intOf(alert, 'state')) : null,
    hkr,
    color: readColor(child(node, 'colorcontrol')),
    buttons: childrenNamed(node, 'button').map((button) => ({
      ain: button.attrs.identifier ?? '',
      id: button.attrs.id ?? '',
      name: textOf(button, 'name') ?? '',
      lastPressed: intOf(button, 'lastpressedtimestamp') || null,
    })),
  };
}

/** Every device and group of a `getdevicelistinfos` answer. */
export function parseDeviceList(xml) {
  const root = parseXml(xml);
  if (root.name !== 'devicelist') {
    throw new Error(`Unexpected answer: <${root.name}> instead of <devicelist>`);
  }
  return root.children
    .filter((node) => node.name === 'device' || node.name === 'group')
    .map(readDevice);
}
