// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// - set_thermostat_mode: put a radiator thermostat on its comfort or eco
//   temperature (the ones set in the FRITZ!Box), start a boost (valve fully
//   open) or the "window open" mode (valve closed) for a number of minutes,
//   or end both. What the core's "Control a device" cannot do: the boost and
//   the "window open" mode have no feature, and comfort / eco follow the
//   temperatures of the box. Boost and "window open" end by themselves (24
//   hours at most, the box's limit): nothing stays open forever.
// -----------------------------------------------------------------------------

import { MAX_MINUTES, THERMOSTAT_MODES } from './hub.js';

/** Minutes from a number field (or a scene variable resolved to a string); 0 when empty. */
export function minutesOf(value) {
  const minutes = Math.round(Number(String(value ?? '').replace(',', '.')));
  return Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, MAX_MINUTES) : 0;
}

export const SCENE_ACTIONS = {
  async set_thermostat_mode(hub, { fields }) {
    const mode = THERMOSTAT_MODES.includes(fields?.mode) ? fields.mode : null;
    if (!mode) {
      throw new Error(`Unknown mode: ${fields?.mode}`);
    }
    await hub.thermostatAction(fields?.device, mode, minutesOf(fields?.duration_minutes));
    return {};
  },
};
