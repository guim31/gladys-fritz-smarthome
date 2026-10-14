// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `smart_home`.
//
// The FRITZ!SmartHome devices at a glance: three tiles (power drawn by the
// plugs, thermostats heating, windows open), then a status list, one row per
// device: the thermostat's temperature and target (or off, boost, window
// open, summer, holiday), the plug's state and power, the lamp, the blind,
// the detector, the battery when it is low, "out of reach".
//
// Devices shown: the ones chosen in the widget settings, else the ones added
// to Gladys, else every device of the box. Read-only: the controls are the
// devices' own (the dashboard's device widgets, scenes).
//
// Budget (8 components, 6 tiles, 1 status): 3 tiles, 1 status of 10 rows at
// most, a text when the box is not connected or has no device.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import {
  MODE,
  detectorKind,
  isBlind,
  isButton,
  isDetector,
  isLight,
  isPlug,
  isThermostat,
  modeOf,
  targetOf,
} from './devices.js';
import { WIDGET_KEY } from './hub.js';

export const TTL_SECONDS = 30;
export const MAX_STATUS_ROWS = 10;

export const TEXT = {
  notConnected: {
    en: 'Not connected to the FRITZ!Box: check the configuration of the integration.',
    fr: "Pas de connexion à la FRITZ!Box : vérifiez la configuration de l'intégration.",
    de: 'Keine Verbindung zur FRITZ!Box: Prüfe die Konfiguration der Integration.',
    es: 'Sin conexión con la FRITZ!Box: revise la configuración de la integración.',
  },
  noDevice: {
    en: 'No smart home device on the FRITZ!Box yet.',
    fr: "Aucun appareil Smart Home sur la FRITZ!Box pour l'instant.",
    de: 'Noch kein Smart-Home-Gerät an der FRITZ!Box.',
    es: 'Todavía no hay dispositivos Smart Home en la FRITZ!Box.',
  },
  power: { en: 'Plugs', fr: 'Prises', de: 'Steckdosen', es: 'Enchufes' },
  heating: { en: 'Heating', fr: 'Chauffent', de: 'Heizen', es: 'Calientan' },
  windows: {
    en: 'Windows open',
    fr: 'Fenêtres ouvertes',
    de: 'Fenster offen',
    es: 'Ventanas abiertas',
  },
  on: { en: 'On', fr: 'Allumé', de: 'An', es: 'Encendido' },
  off: { en: 'Off', fr: 'Éteint', de: 'Aus', es: 'Apagado' },
  heatingOff: { en: 'Off', fr: 'Arrêt', de: 'Aus', es: 'Apagado' },
  boost: { en: 'Boost', fr: 'Boost', de: 'Boost', es: 'Boost' },
  windowOpen: {
    en: 'Window open',
    fr: 'Fenêtre ouverte',
    de: 'Fenster offen',
    es: 'Ventana abierta',
  },
  summer: { en: 'Summer mode', fr: 'Mode été', de: 'Sommermodus', es: 'Modo verano' },
  holiday: { en: 'Holiday', fr: 'Vacances', de: 'Urlaub', es: 'Vacaciones' },
  open: { en: 'Open', fr: 'Ouvert', de: 'Offen', es: 'Abierto' },
  closed: { en: 'Closed', fr: 'Fermé', de: 'Geschlossen', es: 'Cerrado' },
  alarm: { en: 'Alarm', fr: 'Alarme', de: 'Alarm', es: 'Alarma' },
  ok: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  absent: {
    en: 'Out of reach',
    fr: 'Hors de portée',
    de: 'Außer Reichweite',
    es: 'Fuera de alcance',
  },
  batteryLow: {
    en: 'battery low',
    fr: 'pile faible',
    de: 'Batterie schwach',
    es: 'batería baja',
  },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Batterie', es: 'Batería' },
  unknown: { en: 'Unknown', fr: 'Inconnu', de: 'Unbekannt', es: 'Desconocido' },
};

const t = (text, language) => text[language] ?? text.en;

/** `21.5 °C` in the number format of the language. */
export function formatNumber(value, language, digits = 1) {
  const locale = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' }[language] ?? 'en-GB';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

const celsius = (value, language) => `${formatNumber(value, language)} °C`;

/** The status row of a device. */
export function deviceRow(dev, language) {
  const row = (value, icon, color = WIDGET_COLORS.NEUTRAL) => ({
    label: String(dev.name).slice(0, 40),
    value: String(value).slice(0, 40),
    icon,
    color,
  });
  if (!dev.present) {
    return row(t(TEXT.absent, language), 'wifi-off', WIDGET_COLORS.WARNING);
  }
  let result;
  if (isThermostat(dev)) {
    const hkr = dev.hkr ?? {};
    const measured = dev.temperature ?? hkr.measured;
    const now = measured === null || measured === undefined ? '' : celsius(measured, language);
    const target = targetOf(hkr);
    if (hkr.holiday) {
      result = row(`${now} · ${t(TEXT.holiday, language)}`, 'thermometer');
    } else if (hkr.summer) {
      result = row(`${now} · ${t(TEXT.summer, language)}`, 'thermometer');
    } else if (hkr.windowOpen) {
      result = row(`${now} · ${t(TEXT.windowOpen, language)}`, 'wind', WIDGET_COLORS.WARNING);
    } else if (hkr.boost) {
      result = row(`${now} · ${t(TEXT.boost, language)}`, 'thermometer', WIDGET_COLORS.DANGER);
    } else if (modeOf(hkr) === MODE.OFF) {
      result = row(`${now} · ${t(TEXT.heatingOff, language)}`, 'thermometer');
    } else if (target !== null) {
      result = row(`${now} → ${celsius(target, language)}`, 'thermometer', WIDGET_COLORS.SUCCESS);
    } else {
      result = row(now || t(TEXT.unknown, language), 'thermometer');
    }
  } else if (isPlug(dev)) {
    const on = dev.switch ? dev.switch.on : dev.simpleOn;
    const power = dev.meter?.power;
    const value =
      on === null
        ? t(TEXT.unknown, language)
        : on && power !== null && power !== undefined
          ? `${t(TEXT.on, language)} · ${formatNumber(power, language)} W`
          : t(on ? TEXT.on : TEXT.off, language);
    result = row(value, 'power', on ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL);
  } else if (isLight(dev)) {
    const on = dev.simpleOn;
    const value =
      on && dev.levelPercent !== null
        ? `${t(TEXT.on, language)} · ${dev.levelPercent} %`
        : t(on === null ? TEXT.unknown : on ? TEXT.on : TEXT.off, language);
    result = row(value, 'sun', on ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL);
  } else if (isBlind(dev)) {
    const value =
      dev.levelPercent === null
        ? t(TEXT.unknown, language)
        : `${t(TEXT.open, language)} ${100 - dev.levelPercent} %`;
    result = row(value, 'sliders');
  } else if (isDetector(dev)) {
    const opening = detectorKind(dev).name === 'opening';
    const value =
      dev.alert === null
        ? t(TEXT.unknown, language)
        : t(
            opening ? (dev.alert ? TEXT.open : TEXT.closed) : dev.alert ? TEXT.alarm : TEXT.ok,
            language,
          );
    const color = dev.alert
      ? opening
        ? WIDGET_COLORS.WARNING
        : WIDGET_COLORS.DANGER
      : WIDGET_COLORS.NEUTRAL;
    result = row(value, opening ? 'maximize-2' : 'bell', color);
  } else if (dev.temperature !== null) {
    result = row(celsius(dev.temperature, language), 'thermometer');
  } else if (dev.battery !== null) {
    result = row(
      `${t(TEXT.battery, language)} ${dev.battery} %`,
      isButton(dev) ? 'circle' : 'battery',
    );
  } else {
    result = row(t(TEXT.ok, language), 'circle');
  }
  if (dev.batteryLow) {
    result.value = `${result.value} · ${t(TEXT.batteryLow, language)}`.slice(0, 40);
    result.color = WIDGET_COLORS.WARNING;
  }
  return result;
}

// Order of the rows: what is heated and powered first.
const rank = (dev) =>
  isThermostat(dev)
    ? 0
    : isPlug(dev)
      ? 1
      : isLight(dev)
        ? 2
        : isBlind(dev)
          ? 3
          : isDetector(dev)
            ? 4
            : 5;

/** The devices a widget instance shows. */
export function selectedDevices(view, settings) {
  const chosen = Array.isArray(settings?.devices) ? settings.devices : [];
  if (chosen.length > 0) {
    const byId = new Map(view.devices.map((entry) => [entry.externalId, entry]));
    return chosen.map((id) => byId.get(id)?.dev).filter(Boolean);
  }
  const created = view.devices.filter((entry) => entry.created);
  return (created.length > 0 ? created : view.devices).map((entry) => entry.dev);
}

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(hub, { settings, language = 'en' }) {
      const view = hub.view();
      if (!view.connected) {
        return {
          ttl_seconds: TTL_SECONDS,
          components: [{ type: 'text', variant: 'body', text: t(TEXT.notConnected, language) }],
        };
      }
      const devices = selectedDevices(view, settings);
      if (devices.length === 0) {
        return {
          ttl_seconds: TTL_SECONDS,
          components: [{ type: 'text', variant: 'body', text: t(TEXT.noDevice, language) }],
        };
      }
      const present = devices.filter((dev) => dev.present);
      const components = [];
      const plugs = present.filter((dev) => isPlug(dev) && dev.meter);
      if (plugs.length > 0) {
        const watts = plugs.reduce((sum, dev) => sum + (dev.meter.power ?? 0), 0);
        components.push({
          type: 'value',
          value: `${formatNumber(watts, language)} W`,
          label: t(TEXT.power, language),
          icon: 'zap',
        });
      }
      const thermostats = devices.filter(isThermostat);
      if (thermostats.length > 0) {
        const heating = present.filter(
          (dev) => isThermostat(dev) && !dev.hkr?.windowOpen && modeOf(dev.hkr) === MODE.HEATING,
        ).length;
        components.push({
          type: 'value',
          value: `${heating} / ${thermostats.length}`,
          label: t(TEXT.heating, language),
          icon: 'thermometer',
        });
      }
      const openings = present.filter(
        (dev) =>
          (isThermostat(dev) &&
            dev.hkr?.windowOpen !== null &&
            dev.hkr?.windowOpen !== undefined) ||
          (isDetector(dev) && detectorKind(dev).name === 'opening'),
      );
      if (openings.length > 0) {
        const open = openings.filter((dev) =>
          isThermostat(dev) ? dev.hkr.windowOpen : dev.alert === true,
        ).length;
        components.push({
          type: 'value',
          value: open,
          label: t(TEXT.windows, language),
          icon: 'wind',
        });
      }
      const rows = [...devices]
        .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
        .slice(0, MAX_STATUS_ROWS)
        .map((dev) => deviceRow(dev, language));
      components.push({ type: 'status', items: rows });
      return { ttl_seconds: TTL_SECONDS, components };
    },

    // Read-only: no button.
    async action() {
      return undefined;
    },
  },
};
