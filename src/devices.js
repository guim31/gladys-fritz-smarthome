// -----------------------------------------------------------------------------
// The Gladys devices of the integration: one per smart home device of the box
// (external id built from its AIN, the identifier printed on the device), with
// the features its `functionbitmask` announces:
//
//   switch       switch/binary            a plug (FRITZ!DECT 200/210, HAN-FUN plug), controllable
//   power        switch/power (W)         its meter
//   energy       switch/energy (kWh)      total since the plug was installed
//   voltage      switch/voltage (V)       when the box reports it
//   light        light/binary             a lamp (FRITZ!DECT 500), controllable
//   brightness   light/brightness (%)     controllable
//   color        light/color              controllable (free colour, FRITZ!OS 7.39+)
//   position     shutter/position (%)     a blind (Rollotron via DECT ULE), 100 = open, controllable
//   shutter      shutter/state            open / stop / close
//   target       thermostat/target-temperature  a radiator thermostat (FRITZ!DECT 301/302,
//                                         Comet DECT), 8 to 28 °C, controllable
//   mode         thermostat/mode          0 off (valve closed), 1 heating, controllable
//   window       opening-sensor/binary    the thermostat's "window open" mode (0 = open, 1 = closed)
//   boost        input/binary             the thermostat's boost
//   alert        opening-, smoke-, motion-, leak-sensor or input/binary: HAN-FUN detectors
//   temperature  temperature-sensor/decimal (°C)
//   humidity     humidity-sensor/decimal (%)
//   battery      battery/integer (%)
//
// Buttons (FRITZ!DECT 400/440) are scene triggers (src/hub.js): their device
// shows the battery, the temperature and the humidity they measure.
//
// Groups and templates of the box are not published: a group would duplicate
// the devices it contains.
//
// Every device is published with should_poll: false: the integration reads
// the box itself, at the configured interval (src/hub.js).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { FUNCTIONS, HKR } from './aha/devicelist.js';

export const DEVICE_TYPE = 'dect';

// Bounds of the thermostat target, the range of the FRITZ!DECT thermostats.
export const MIN_TARGET = 8;
export const MAX_TARGET = 28;

// Display bounds.
const MAX_POWER_W = 3700;
const MAX_ENERGY_KWH = 1000000;
const MAX_VOLTAGE_V = 260;

// HAN-FUN unit types of the detectors (AVM "AHA-HTTP-Interface", etsiunitinfo).
export const UNIT_TYPES = {
  DOOR_CONTACT: 513,
  WINDOW_CONTACT: 514,
  MOTION: 515,
  SMOKE: 516,
  FLOOD: 518,
};

// Gladys: an opening sensor publishes 0 when open, 1 when closed.
export const OPENING = { OPEN: 0, CLOSED: 1 };
export const SHUTTER = { OPEN: 1, STOP: 0, CLOSE: -1 };
export const MODE = { OFF: 0, HEATING: 1 };

// Feature names, frozen at creation in Gladys (language of the configuration).
export const NAMES = {
  en: {
    switch: 'Power',
    power: 'Power consumption',
    energy: 'Energy',
    voltage: 'Voltage',
    light: 'Light',
    brightness: 'Brightness',
    color: 'Color',
    position: 'Position',
    shutter: 'Blind',
    target: 'Target temperature',
    mode: 'Heating',
    window: 'Window (open window mode)',
    boost: 'Boost',
    opening: 'Opening',
    smoke: 'Smoke',
    motion: 'Motion',
    flood: 'Water leak',
    alert: 'Alarm',
    temperature: 'Temperature',
    humidity: 'Humidity',
    battery: 'Battery',
  },
  fr: {
    switch: 'Alimentation',
    power: 'Puissance consommée',
    energy: 'Énergie',
    voltage: 'Tension',
    light: 'Lumière',
    brightness: 'Luminosité',
    color: 'Couleur',
    position: 'Position',
    shutter: 'Volet',
    target: 'Consigne',
    mode: 'Chauffage',
    window: 'Fenêtre (mode fenêtre ouverte)',
    boost: 'Boost',
    opening: 'Ouverture',
    smoke: 'Fumée',
    motion: 'Mouvement',
    flood: "Fuite d'eau",
    alert: 'Alarme',
    temperature: 'Température',
    humidity: 'Humidité',
    battery: 'Batterie',
  },
  de: {
    switch: 'Strom',
    power: 'Leistung',
    energy: 'Energie',
    voltage: 'Spannung',
    light: 'Licht',
    brightness: 'Helligkeit',
    color: 'Farbe',
    position: 'Position',
    shutter: 'Rollladen',
    target: 'Solltemperatur',
    mode: 'Heizen',
    window: 'Fenster (Fenster-offen-Modus)',
    boost: 'Boost',
    opening: 'Öffnung',
    smoke: 'Rauch',
    motion: 'Bewegung',
    flood: 'Wasserleck',
    alert: 'Alarm',
    temperature: 'Temperatur',
    humidity: 'Luftfeuchtigkeit',
    battery: 'Batterie',
  },
  es: {
    switch: 'Alimentación',
    power: 'Potencia consumida',
    energy: 'Energía',
    voltage: 'Tensión',
    light: 'Luz',
    brightness: 'Brillo',
    color: 'Color',
    position: 'Posición',
    shutter: 'Persiana',
    target: 'Temperatura objetivo',
    mode: 'Calefacción',
    window: 'Ventana (modo ventana abierta)',
    boost: 'Boost',
    opening: 'Apertura',
    smoke: 'Humo',
    motion: 'Movimiento',
    flood: 'Fuga de agua',
    alert: 'Alarma',
    temperature: 'Temperatura',
    humidity: 'Humedad',
    battery: 'Batería',
  },
};

/** The AIN without its spaces: `11657 0000101-1` → `116570000101-1`. */
export const ainKey = (ain) => String(ain).replace(/\s+/g, '');

export const deviceIds = (gladys, ain) => gladys.externalIds(DEVICE_TYPE, ainKey(ain));

/** The AIN key of a device external id of the integration, or null. */
export function ainKeyOf(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  return externalId.slice(prefix.length).split(':')[0] || null;
}

// --- HSV <-> RGB (the box speaks hue 0-359 and saturation 0-255) -------------

/** Hue (degrees), saturation (0-255) at full value → RGB integer. */
export function hsToRgb(hue, saturation) {
  const s = Math.min(Math.max(saturation / 255, 0), 1);
  const h = (((hue % 360) + 360) % 360) / 60;
  const c = s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] =
    h < 1
      ? [c, x, 0]
      : h < 2
        ? [x, c, 0]
        : h < 3
          ? [0, c, x]
          : h < 4
            ? [0, x, c]
            : h < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = 1 - c;
  const byte = (value) => Math.round((value + m) * 255);
  return (byte(r) << 16) + (byte(g) << 8) + byte(b);
}

/** RGB integer → { hue: 0-359, saturation: 0-255 } (the brightness is its own feature). */
export function rgbToHs(rgb) {
  const value = Math.min(Math.max(Math.round(Number(rgb)) || 0, 0), 0xffffff);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let hue = 0;
  if (delta > 0) {
    if (max === r) {
      hue = 60 * (((g - b) / delta) % 6);
    } else if (max === g) {
      hue = 60 * ((b - r) / delta + 2);
    } else {
      hue = 60 * ((r - g) / delta + 4);
    }
  }
  return {
    hue: Math.round((hue + 360) % 360) % 360,
    saturation: max === 0 ? 0 : Math.round((delta / max) * 255),
  };
}

// --- What a device is ----------------------------------------------------------

/** On/off of a plug: the AVM switch element, or a HAN-FUN switchable unit that is not a lamp. */
export const isPlug = (dev) =>
  dev.has(FUNCTIONS.SWITCH) || (dev.has(FUNCTIONS.SWITCHABLE) && !dev.has(FUNCTIONS.LIGHTBULB));
export const isLight = (dev) => dev.has(FUNCTIONS.LIGHTBULB);
export const isBlind = (dev) => dev.has(FUNCTIONS.BLIND);
export const isThermostat = (dev) => dev.has(FUNCTIONS.THERMOSTAT);
export const isButton = (dev) => dev.has(FUNCTIONS.BUTTON);
// A blind raises its own alarms (obstacle, overheating), not a detector.
export const isDetector = (dev) => dev.has(FUNCTIONS.ALARM) && !isBlind(dev);

/** The feature name key and the category of a detector, from its HAN-FUN unit type. */
export function detectorKind(dev) {
  switch (dev.unitType) {
    case UNIT_TYPES.DOOR_CONTACT:
    case UNIT_TYPES.WINDOW_CONTACT:
      return { name: 'opening', category: CATEGORIES.OPENING_SENSOR };
    case UNIT_TYPES.SMOKE:
      return { name: 'smoke', category: CATEGORIES.SMOKE_SENSOR };
    case UNIT_TYPES.MOTION:
      return { name: 'motion', category: CATEGORIES.MOTION_SENSOR };
    case UNIT_TYPES.FLOOD:
      return { name: 'flood', category: CATEGORIES.LEAK_SENSOR };
    default:
      return { name: 'alert', category: CATEGORIES.INPUT };
  }
}

/** A device the integration publishes: not a group, with at least one feature. */
export const isPublishable = (dev) => !dev.group && featureSpecs(dev).length > 0;

const sensor = (key, category, type, extra = {}) => ({
  key,
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

const control = (key, category, type, extra = {}) => ({
  key,
  category,
  type,
  read_only: false,
  has_feedback: true,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

/** The features of a device, without names nor external ids. */
export function featureSpecs(dev) {
  const specs = [];
  if (isPlug(dev)) {
    specs.push(control('switch', CATEGORIES.SWITCH, TYPES.SWITCH.BINARY));
  }
  if (dev.has(FUNCTIONS.POWER_METER) && dev.meter) {
    specs.push(
      sensor('power', CATEGORIES.SWITCH, TYPES.SWITCH.POWER, {
        unit: UNITS.WATT,
        max: MAX_POWER_W,
      }),
      sensor('energy', CATEGORIES.SWITCH, TYPES.SWITCH.ENERGY, {
        unit: UNITS.KILOWATT_HOUR,
        max: MAX_ENERGY_KWH,
      }),
    );
    if (dev.meter.hasVoltage) {
      specs.push(
        sensor('voltage', CATEGORIES.SWITCH, TYPES.SWITCH.VOLTAGE, {
          unit: UNITS.VOLT,
          max: MAX_VOLTAGE_V,
        }),
      );
    }
  }
  if (isLight(dev)) {
    specs.push(control('light', CATEGORIES.LIGHT, TYPES.LIGHT.BINARY));
    if (dev.has(FUNCTIONS.LEVEL)) {
      specs.push(
        control('brightness', CATEGORIES.LIGHT, TYPES.LIGHT.BRIGHTNESS, {
          unit: UNITS.PERCENT,
          max: 100,
        }),
      );
    }
    if (dev.has(FUNCTIONS.COLOR)) {
      specs.push(control('color', CATEGORIES.LIGHT, TYPES.LIGHT.COLOR, { max: 0xffffff }));
    }
  }
  if (isBlind(dev)) {
    specs.push(
      control('position', CATEGORIES.SHUTTER, TYPES.SHUTTER.POSITION, {
        unit: UNITS.PERCENT,
        max: 100,
      }),
      control('shutter', CATEGORIES.SHUTTER, TYPES.SHUTTER.STATE, {
        min: SHUTTER.CLOSE,
        max: SHUTTER.OPEN,
        has_feedback: false,
        keep_history: false,
      }),
    );
  }
  if (isThermostat(dev)) {
    specs.push(
      control('target', CATEGORIES.THERMOSTAT, TYPES.THERMOSTAT.TARGET_TEMPERATURE, {
        unit: UNITS.CELSIUS,
        min: MIN_TARGET,
        max: MAX_TARGET,
      }),
      // max 1: the core offers "off" and "heating" only (no cooling, no auto).
      control('mode', CATEGORIES.THERMOSTAT, TYPES.THERMOSTAT.MODE, {
        min: MODE.OFF,
        max: MODE.HEATING,
      }),
    );
    if (dev.hkr?.windowOpen !== null && dev.hkr?.windowOpen !== undefined) {
      specs.push(sensor('window', CATEGORIES.OPENING_SENSOR, TYPES.SENSOR.BINARY));
    }
    if (dev.hkr?.boost !== null && dev.hkr?.boost !== undefined) {
      specs.push(sensor('boost', CATEGORIES.INPUT, TYPES.SENSOR.BINARY));
    }
  }
  if (isDetector(dev)) {
    specs.push(sensor('alert', detectorKind(dev).category, TYPES.SENSOR.BINARY));
  }
  if (dev.has(FUNCTIONS.TEMPERATURE) || (isThermostat(dev) && !dev.group)) {
    specs.push(
      sensor('temperature', CATEGORIES.TEMPERATURE_SENSOR, TYPES.SENSOR.DECIMAL, {
        unit: UNITS.CELSIUS,
        min: -20,
        max: 60,
      }),
    );
  }
  if (dev.has(FUNCTIONS.HUMIDITY)) {
    specs.push(
      sensor('humidity', CATEGORIES.HUMIDITY_SENSOR, TYPES.SENSOR.DECIMAL, {
        unit: UNITS.PERCENT,
        max: 100,
      }),
    );
  }
  if (dev.hasBattery) {
    specs.push(
      sensor('battery', CATEGORIES.BATTERY, TYPES.BATTERY.INTEGER, {
        unit: UNITS.PERCENT,
        max: 100,
      }),
    );
  }
  return specs;
}

/** The name of a feature, in the configured language. */
function featureName(dev, key, language) {
  const names = NAMES[language] ?? NAMES.en;
  if (key === 'alert') {
    return names[detectorKind(dev).name];
  }
  return names[key];
}

/**
 * The discovery payload of a device.
 * @param {object} gladys
 * @param {object} dev a device of parseDeviceList
 * @param {string} language language of the feature names
 */
export function buildDevice(gladys, dev, language = 'fr') {
  const ids = deviceIds(gladys, dev.ain);
  const params = [{ name: 'AIN', value: dev.ain }];
  if (dev.firmware) {
    params.push({ name: 'FIRMWARE', value: dev.firmware });
  }
  return {
    name: String(dev.name || dev.ain).slice(0, 60),
    external_id: ids.device,
    model: dev.productName || 'FRITZ!SmartHome',
    should_poll: false,
    params,
    features: featureSpecs(dev).map(({ key, ...spec }) => ({
      name: featureName(dev, key, language),
      external_id: ids.feature(key),
      ...spec,
    })),
  };
}

/** Mode of a thermostat: off when the valve is closed (253) or in summer. */
export function modeOf(hkr) {
  if (!hkr || hkr.target === null) {
    return null;
  }
  return hkr.target === HKR.OFF || hkr.summer ? MODE.OFF : MODE.HEATING;
}

/** Target of a thermostat in °C, or null when it is off or fully open. */
export function targetOf(hkr) {
  if (!hkr || hkr.target === null || hkr.target >= HKR.OFF) {
    return null;
  }
  return hkr.target / 2;
}

/**
 * The current values of a device, by feature key (null: unknown, not
 * published). A device out of reach has none.
 */
export function valuesOf(dev) {
  if (!dev.present) {
    return {};
  }
  const values = {};
  const set = (key, value) => {
    if (value !== null && value !== undefined && !Number.isNaN(value)) {
      values[key] = value;
    }
  };
  const flag = (value) => (value === null ? null : value ? 1 : 0);
  if (isPlug(dev)) {
    set('switch', flag(dev.switch ? dev.switch.on : dev.simpleOn));
  }
  if (dev.meter) {
    set('power', dev.meter.power);
    set('energy', dev.meter.energy);
    set('voltage', dev.meter.voltage);
  }
  if (isLight(dev)) {
    set('light', flag(dev.simpleOn));
    set('brightness', dev.levelPercent);
    // Mode 1: hue and saturation; mode 4 (white, colour temperature) has no colour.
    const color = dev.color;
    if (color?.mode === 1 && color.hue !== null && color.saturation !== null) {
      set('color', hsToRgb(color.hue, color.saturation));
    }
  }
  if (isBlind(dev) && dev.levelPercent !== null) {
    // The box gives how closed the blind is; Gladys shows how open it is.
    set('position', 100 - dev.levelPercent);
  }
  if (isThermostat(dev)) {
    set('target', targetOf(dev.hkr));
    set('mode', modeOf(dev.hkr));
    set(
      'window',
      dev.hkr?.windowOpen === null ? null : dev.hkr.windowOpen ? OPENING.OPEN : OPENING.CLOSED,
    );
    set('boost', flag(dev.hkr?.boost ?? null));
  }
  if (isDetector(dev) && dev.alert !== null) {
    set(
      'alert',
      detectorKind(dev).name === 'opening'
        ? dev.alert
          ? OPENING.OPEN
          : OPENING.CLOSED
        : flag(dev.alert),
    );
  }
  set('temperature', dev.temperature ?? (isThermostat(dev) ? dev.hkr?.measured : null));
  set('humidity', dev.humidity);
  set('battery', dev.battery);
  return values;
}

// --- Buttons -----------------------------------------------------------------

export const BUTTONS = {
  TOP_RIGHT: 'top_right',
  BOTTOM_RIGHT: 'bottom_right',
  BOTTOM_LEFT: 'bottom_left',
  TOP_LEFT: 'top_left',
  MAIN: 'main',
};
export const PRESSES = { SHORT: 'short', LONG: 'long' };

// The four buttons of a FRITZ!DECT 440, in the order the box lists them
// (pyfritzhome's fixture: "Oben rechts", "Unten rechts", "Unten links", "Oben links").
const FOUR_BUTTONS = [
  BUTTONS.TOP_RIGHT,
  BUTTONS.BOTTOM_RIGHT,
  BUTTONS.BOTTOM_LEFT,
  BUTTONS.TOP_LEFT,
];

/**
 * Which button and which press an entry of `<button>` stands for. A
 * FRITZ!DECT 400 lists its single button twice, short then long press (the
 * names end in "kurz" / "lang" on a German box); a FRITZ!DECT 440 lists its
 * four buttons.
 */
export function buttonOf(dev, index) {
  const button = dev.buttons[index];
  const name = String(button?.name ?? '').toLowerCase();
  if (dev.buttons.length === 4) {
    return { button: FOUR_BUTTONS[index], press: PRESSES.SHORT };
  }
  let press = index === 1 ? PRESSES.LONG : PRESSES.SHORT;
  if (/(lang|long)\s*$/.test(name)) {
    press = PRESSES.LONG;
  } else if (/(kurz|short|court)\s*$/.test(name)) {
    press = PRESSES.SHORT;
  }
  return { button: BUTTONS.MAIN, press };
}
