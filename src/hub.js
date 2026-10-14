// -----------------------------------------------------------------------------
// The hub: the session with the FRITZ!Box, the read cycle, the states
// published to Gladys, the scene events and the commands. Everything the SDK
// handlers, the scene actions and the widget need goes through it (src/app.js
// wires it).
//
// Scheduling: the devices are published with should_poll: false and the hub
// reads the box at the configured interval, one `getdevicelistinfos` per
// cycle (onPoll stays as a fallback). States: `publishChangedStates` sends
// only what changed, plus a heartbeat every 12 hours so that a stable value
// never shows "no recent value" (the front's default is 48 hours).
//
// Scene events compare a read with the previous one: a button whose
// `lastpressedtimestamp` moved, a thermostat entering its "window open" mode,
// a battery turning low. The first read after a start only sets the baseline.
//
// Refused logins stop the reads for 15 minutes: the FRITZ!Box blocks logins
// for a growing time after failed attempts, retrying at every cycle would
// lock the user out of the box.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { AhaClient } from './aha/client.js';
import { HKR, parseDeviceList } from './aha/devicelist.js';
import {
  MAX_TARGET,
  MIN_TARGET,
  MODE,
  SHUTTER,
  ainKey,
  ainKeyOf,
  buildDevice,
  buttonOf,
  deviceIds,
  isBlind,
  isButton,
  isLight,
  isPlug,
  isPublishable,
  isThermostat,
  modeOf,
  rgbToHs,
  valuesOf,
} from './devices.js';
import { SCAN_TIMEOUT_SECONDS, boxCandidates } from './discovery.js';
import { ERRORS, REPORTS, STATUS, join, render } from './messages.js';
import { ProblemLog } from './problems.js';

const logger = createLogger({ name: 'fritz-smarthome' });

export const WIDGET_KEY = 'smart_home';
export const TRIGGERS = {
  BUTTON_PRESSED: 'button_pressed',
  WINDOW_OPEN: 'window_open_detected',
  BATTERY_LOW: 'battery_low',
};
export const THERMOSTAT_MODES = ['comfort', 'eco', 'boost', 'window_open', 'end_boost'];
// AVM: boost and "window open" end 24 hours ahead at most.
export const MAX_MINUTES = 1440;
export const DEFAULT_MINUTES = { boost: 30, window_open: 15 };

export const DEFAULT_TIMINGS = {
  heartbeatMs: 12 * 60 * 60 * 1000,
  authRetryMs: 15 * 60 * 1000,
  // requestWidgetRefresh is rate-limited to one call every 10 s by the core.
  widgetRefreshMs: 10000,
  // The box answers a command at once, the device a few seconds later (txbusy).
  afterCommandMs: 3000,
};

const FALLBACK_HOST = 'fritz.box';

export class GladysError extends Error {
  /** An error whose message is a multi-language object (shown in Gladys). */
  constructor(message, language = 'en') {
    super(message[language] ?? message.en);
    this.messages = message;
  }
}

export class Hub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK fake)
   * @param {Function} [options.request] HTTP seam of the AHA client (tests)
   * @param {boolean} [options.timers] false: no background timer (tests drive the cycles)
   * @param {Function} [options.now] clock in ms
   * @param {object} [options.timings] overrides of DEFAULT_TIMINGS
   */
  constructor({ gladys, request, timers = true, now, timings }) {
    this.gladys = gladys;
    this.request = request;
    this.timers = timers;
    this.now = now ?? (() => Date.now());
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.config = null;
    this.client = null;
    this.foundHost = null;
    this.problem = null;
    this.blockedSeconds = 0;
    this.authBlockedUntil = 0;
    this.problems = new ProblemLog(logger);
    this.announced = false;
    this.lastStatusSent = null;
    this.lastDiscovered = null;
    /** @type {Map<string, object>|null} AIN key → device of the last read */
    this.devices = null;
    this.lastCycleAt = -Infinity;
    this.cycleTimer = null;
    this.afterCommandTimer = null;
    this.refreshTimer = null;
    this.lastRefreshAt = -Infinity;
    this.running = null;
    this.stopped = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.config = config;
    await this.connectBox();
    await this.sendStatus();
    await this.runCycle();
    await this.publishDiscovered();
    this.schedule();
  }

  /** Reconnection to Gladys (it may have restarted): publish everything again. */
  async resync(config) {
    this.config = config;
    this.lastStatusSent = null;
    this.lastDiscovered = null;
    await this.publishDiscovered();
    await this.sendStatus();
    this.gladys.forgetPublishedStates?.();
    await this.publishStates();
    this.requestRefresh();
  }

  async reconfigure(config) {
    const previous = this.config;
    this.config = config;
    const access = (c) => [c.host, c.username, c.password, c.https].join('\u0000');
    if (!previous || access(previous) !== access(config)) {
      await this.client?.logout();
      this.client = null;
      this.announced = false;
      this.authBlockedUntil = 0;
      await this.connectBox();
    }
    // The language of the feature names applies to the devices created from now on.
    this.lastDiscovered = null;
    await this.sendStatus();
    await this.runCycle();
    await this.publishDiscovered();
    this.schedule();
    this.requestRefresh();
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.cycleTimer);
    clearTimeout(this.afterCommandTimer);
    clearTimeout(this.refreshTimer);
    this.cycleTimer = null;
    await this.running?.catch(() => {});
    await this.client?.logout();
  }

  schedule() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearInterval(this.cycleTimer);
    this.cycleTimer = setInterval(() => this.runCycle(), this.config.pollInterval * 1000);
    this.cycleTimer.unref?.();
  }

  /** A read a few seconds after a command, to show what the device did. */
  refreshSoon() {
    if (!this.timers || this.stopped) {
      return;
    }
    clearTimeout(this.afterCommandTimer);
    this.afterCommandTimer = setTimeout(() => this.runCycle(), this.timings.afterCommandMs);
    this.afterCommandTimer.unref?.();
  }

  // --- Connection to the box -------------------------------------------------

  /**
   * Log in to the box: the configured address, else the one found earlier,
   * else a network search, else `fritz.box`. Resolves true once logged in.
   */
  async connectBox() {
    const { config } = this;
    if (!config.username || !config.password) {
      this.client = null;
      this.problem = 'credentials';
      return false;
    }
    if (this.now() < this.authBlockedUntil) {
      return false;
    }
    const candidates = config.host ? [config.host] : [this.foundHost].filter(Boolean);
    let { client, error } = await this.tryHosts(candidates);
    if (!client && !config.host && (!error || error.kind === 'unreachable')) {
      const found = (await this.searchBoxes()).map((candidate) => candidate.address);
      const others = [...new Set([...found, FALLBACK_HOST])].filter(
        (host) => !candidates.includes(host),
      );
      ({ client, error } = await this.tryHosts(others, error));
    }
    if (client) {
      this.client = client;
      this.problem = null;
      this.authBlockedUntil = 0;
      if (!config.host) {
        this.foundHost = client.host;
      }
      // Said at the start and when the box is back, not at every new session.
      const lost = [this.problems.recover('connect'), this.problems.recover('read')].some(Boolean);
      const line = `Logged in to the FRITZ!Box at ${client.host}`;
      if (lost || !this.announced) {
        logger.info(line);
      } else {
        logger.debug(line);
      }
      this.announced = true;
      return true;
    }
    this.client = null;
    this.noteLoginError(error);
    this.problems.fail(
      'connect',
      `Cannot log in to the FRITZ!Box: ${error?.message ?? 'no address'}`,
    );
    return false;
  }

  noteLoginError(error) {
    switch (error?.kind) {
      case 'auth':
      case 'rights':
        this.problem = error.kind;
        this.authBlockedUntil = this.now() + this.timings.authRetryMs;
        break;
      case 'blocked':
        this.problem = 'blocked';
        this.blockedSeconds = error.seconds;
        this.authBlockedUntil = this.now() + error.seconds * 1000;
        break;
      default:
        this.problem = this.config.host ? 'unreachable' : 'notFound';
    }
  }

  /** The first host that answers as a FRITZ!Box; stops at an error other than silence. */
  async tryHosts(hosts, previousError = null) {
    let error = previousError;
    for (const host of hosts) {
      const client = new AhaClient({
        host,
        https: this.config.https,
        username: this.config.username,
        password: this.config.password,
        request: this.request,
      });
      try {
        await client.login();
        return { client, error: null };
      } catch (err) {
        error = err;
        if (err.kind !== 'unreachable') {
          break;
        }
      }
    }
    return { client: null, error };
  }

  /** Boxes found by the core's SSDP search ([] when the search is unavailable). */
  async searchBoxes() {
    try {
      const results = await this.gladys.scanNetwork('ssdp', {
        timeoutSeconds: SCAN_TIMEOUT_SECONDS,
      });
      this.problems.recover('search');
      return boxCandidates(results);
    } catch (err) {
      this.problems.fail('search', `Network search unavailable: ${err.message}`);
      return [];
    }
  }

  /** The connection status of the Configuration screen, sent when it changes. */
  async sendStatus() {
    const host = this.client?.host ?? this.config.host ?? FALLBACK_HOST;
    const connected = this.problem === null && this.client !== null;
    const message = this.problem
      ? render(STATUS, this.problem, { host: host || FALLBACK_HOST, seconds: this.blockedSeconds })
      : undefined;
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatusSent) {
      return;
    }
    this.lastStatusSent = key;
    await this.gladys.setConnectionStatus(connected, message).catch(() => {});
  }

  requireClient() {
    if (!this.client) {
      throw new GladysError(render(ERRORS, 'notConnected'), this.config.language);
    }
    return this.client;
  }

  // --- Discovery ---------------------------------------------------------------

  createdDevices() {
    return this.gladys.devices ?? [];
  }

  isCreated(externalId) {
    return this.createdDevices().some((device) => device.external_id === externalId);
  }

  publishable() {
    return [...(this.devices?.values() ?? [])].filter(isPublishable);
  }

  discoveredDevices() {
    return this.publishable().map((dev) => buildDevice(this.gladys, dev, this.config.language));
  }

  /** The discovered devices, sent when they changed (a new device, a new feature, the language). */
  async publishDiscovered() {
    if (!this.devices) {
      return;
    }
    const devices = this.discoveredDevices();
    const key = JSON.stringify(devices);
    if (key === this.lastDiscovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.lastDiscovered = key;
    } catch (err) {
      logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  async scan() {
    if (!this.client) {
      this.authBlockedUntil = 0;
      await this.connectBox();
      await this.sendStatus();
    }
    this.lastDiscovered = null;
    await this.runCycle();
    await this.publishDiscovered();
  }

  // --- The read cycle ------------------------------------------------------------

  runCycle() {
    if (this.running || this.stopped) {
      return this.running ?? Promise.resolve();
    }
    this.running = this.cycle()
      .then(() => this.problems.recover('cycle'))
      .catch((err) => {
        if (this.problems.fail('cycle', `Read cycle failed: ${err.message}`, 'error')) {
          logger.debug('Read cycle failed', err);
        }
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  async cycle() {
    if (!this.client && !(await this.connectBox())) {
      await this.sendStatus();
      return;
    }
    let list;
    try {
      list = parseDeviceList(await this.client.deviceListXml());
    } catch (err) {
      await this.noteReadFailure(err);
      return;
    }
    this.lastCycleAt = this.now();
    this.problem = null;
    this.problems.recover('read', 'Reading the FRITZ!Box works again');
    this.apply(list);
    await this.sendStatus();
    await this.publishDiscovered();
    await this.publishStates();
  }

  async noteReadFailure(err) {
    if (err.kind && err.kind !== 'unreachable' && err.kind !== 'invalid') {
      this.client = null;
      this.noteLoginError(err);
    } else if (err.kind === 'unreachable') {
      this.problem = this.config.host ? 'unreachable' : 'notFound';
      if (!this.config.host) {
        // The address found earlier may be stale: search again next time.
        this.client = null;
      }
    }
    this.problems.fail('read', `Reading the FRITZ!Box failed: ${err.message}`);
    await this.sendStatus();
  }

  /** Fold a read in: scene events and presence changes against the previous read. */
  apply(list) {
    const previous = this.devices;
    const next = new Map();
    for (const dev of list) {
      if (!dev.group) {
        next.set(ainKey(dev.ain), dev);
      }
    }
    this.devices = next;
    if (!previous) {
      return;
    }
    const nowSeconds = this.now() / 1000;
    for (const [key, dev] of next) {
      const before = previous.get(key);
      if (!before) {
        continue;
      }
      const device = deviceIds(this.gladys, dev.ain).device;
      const deviceName = dev.name;
      if (before.present !== dev.present) {
        logger.info(`${dev.name} is ${dev.present ? 'back in reach' : 'out of reach'} of the box`);
        this.requestRefresh();
      }
      if (isButton(dev)) {
        dev.buttons.forEach((button, index) => {
          const last = before.buttons.find((entry) => entry.ain === button.ain)?.lastPressed;
          if (button.lastPressed && button.lastPressed > (last ?? 0)) {
            const { button: which, press } = buttonOf(dev, index);
            this.fire(TRIGGERS.BUTTON_PRESSED, {
              device,
              device_name: deviceName,
              button: which,
              press,
            });
          }
        });
      }
      if (isThermostat(dev) && dev.hkr?.windowOpen === true && before.hkr?.windowOpen === false) {
        const end = dev.hkr.windowOpenEnd;
        this.fire(TRIGGERS.WINDOW_OPEN, {
          device,
          device_name: deviceName,
          minutes: end ? Math.max(0, Math.round((end - nowSeconds) / 60)) : 0,
        });
      }
      if (dev.batteryLow === true && before.batteryLow === false) {
        this.fire(TRIGGERS.BATTERY_LOW, {
          device,
          device_name: deviceName,
          battery: dev.battery ?? 0,
        });
      }
    }
  }

  /** The states of every created device, published when they changed. */
  async publishStates() {
    if (!this.devices) {
      return;
    }
    const states = [];
    for (const dev of this.publishable()) {
      const ids = deviceIds(this.gladys, dev.ain);
      if (!this.isCreated(ids.device)) {
        continue;
      }
      for (const [key, value] of Object.entries(valuesOf(dev))) {
        states.push({ device_feature_external_id: ids.feature(key), state: value });
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      const { count } = await this.gladys.publishChangedStates(states, {
        heartbeat: this.timings.heartbeatMs,
      });
      if (count > 0) {
        this.requestRefresh();
      }
      this.problems.recover('publish', 'Gladys accepts the states again');
    } catch (err) {
      // Sent again at the next cycle (the SDK forgets what Gladys refused).
      this.problems.fail('publish', `Publishing the states failed: ${err.message}`);
    }
  }

  fire(key, data) {
    logger.debug(`Scene event ${key} from ${data.device_name}`);
    this.gladys
      .publishSceneEvent(key, data)
      .catch((err) => logger.warn(`Scene event ${key} refused: ${err.message}`));
  }

  // --- Gladys events -----------------------------------------------------------

  async onDeviceCreated() {
    if (!this.devices) {
      await this.runCycle();
    }
    // The SDK forgot the states of this device: everything is published again.
    await this.publishStates();
    this.requestRefresh();
  }

  /** onPoll fallback: should_poll is false, but a Gladys polling anyway gets an answer. */
  async poll() {
    // One read serves every device: skip it when the timer read the box recently.
    if (this.now() - this.lastCycleAt < (this.config.pollInterval * 1000) / 2) {
      return;
    }
    await this.runCycle();
  }

  // --- Commands ------------------------------------------------------------------

  /** The device of the last read behind a Gladys device external id. */
  deviceOf(externalId) {
    this.requireClient();
    const key = ainKeyOf(this.gladys, externalId);
    const dev = key ? this.devices?.get(key) : null;
    if (!dev) {
      throw new GladysError(render(ERRORS, 'unknownDevice'), this.config.language);
    }
    if (!dev.present) {
      throw new GladysError(render(ERRORS, 'absent', { name: dev.name }), this.config.language);
    }
    return dev;
  }

  fail(key, dev) {
    return new GladysError(render(ERRORS, key, { name: dev?.name ?? '' }), this.config.language);
  }

  async command(fn) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof GladysError) {
        throw err;
      }
      if (err.kind && err.kind !== 'invalid') {
        await this.noteReadFailure(err);
      }
      throw new GladysError(
        render(ERRORS, 'failed', { reason: err.kind ?? err.message }),
        this.config.language,
      );
    }
  }

  /** Publish what a command set, then read the device again a few seconds later. */
  async confirm(dev, key, value) {
    const id = deviceIds(this.gladys, dev.ain).feature(key);
    if (this.isCreated(deviceIds(this.gladys, dev.ain).device)) {
      await this.gladys
        .publishChangedStates([{ device_feature_external_id: id, state: value }])
        .catch(() => {});
    }
    this.requestRefresh();
    this.refreshSoon();
  }

  async setValue(device, feature, value) {
    const dev = this.deviceOf(device.external_id);
    const key = String(feature.external_id).split(':').at(-1);
    const number = Number(value);
    const client = this.client;
    if (key === 'switch' && isPlug(dev)) {
      if (dev.switch?.lock) {
        throw this.fail('locked', dev);
      }
      const on = number === 1;
      await this.command(() =>
        dev.switch ? client.setSwitch(dev.ain, on) : client.setSimpleOnOff(dev.ain, on),
      );
      logger.info(`${dev.name} switched ${on ? 'on' : 'off'}`);
      await this.confirm(dev, key, on ? 1 : 0);
      return;
    }
    if (key === 'light' && isLight(dev)) {
      await this.command(() => client.setSimpleOnOff(dev.ain, number === 1));
      logger.info(`${dev.name} turned ${number === 1 ? 'on' : 'off'}`);
      await this.confirm(dev, key, number === 1 ? 1 : 0);
      return;
    }
    if (key === 'brightness' && isLight(dev)) {
      const percent = Math.min(100, Math.max(0, Math.round(number)));
      await this.command(() => client.setLevelPercentage(dev.ain, percent));
      logger.info(`${dev.name} brightness set to ${percent} %`);
      await this.confirm(dev, key, percent);
      return;
    }
    if (key === 'color' && isLight(dev)) {
      const { hue, saturation } = rgbToHs(number);
      await this.command(() => client.setUnmappedColor(dev.ain, hue, saturation));
      logger.info(`${dev.name} colour changed`);
      await this.confirm(dev, key, Math.round(number));
      return;
    }
    if (key === 'position' && isBlind(dev)) {
      const open = Math.min(100, Math.max(0, Math.round(number)));
      await this.command(() => client.setLevelPercentage(dev.ain, 100 - open));
      logger.info(`${dev.name} moved to ${open} % open`);
      await this.confirm(dev, key, open);
      return;
    }
    if (key === 'shutter' && isBlind(dev)) {
      const target = number === SHUTTER.OPEN ? 'open' : number === SHUTTER.CLOSE ? 'close' : 'stop';
      await this.command(() => client.setBlind(dev.ain, target));
      logger.info(`${dev.name}: ${target}`);
      this.requestRefresh();
      this.refreshSoon();
      return;
    }
    if (key === 'target' && isThermostat(dev)) {
      await this.setTarget(dev, number);
      return;
    }
    if (key === 'mode' && isThermostat(dev)) {
      await this.setMode(dev, number === MODE.HEATING ? MODE.HEATING : MODE.OFF);
      return;
    }
    throw new GladysError(render(ERRORS, 'unknownDevice'), this.config.language);
  }

  /** A thermostat that accepts changes: not locked, not on holiday, not in summer mode. */
  thermostatOf(dev) {
    if (!isThermostat(dev)) {
      throw this.fail('notThermostat', dev);
    }
    if (dev.hkr?.lock) {
      throw this.fail('locked', dev);
    }
    if (dev.hkr?.holiday) {
      throw this.fail('holiday', dev);
    }
    if (dev.hkr?.summer) {
      throw this.fail('summer', dev);
    }
    return dev;
  }

  /** Target temperature, bounded to 8-28 °C in half degrees. */
  async setTarget(dev, celsius) {
    this.thermostatOf(dev);
    if (!Number.isFinite(celsius)) {
      throw this.fail('failed', dev);
    }
    const bounded = Math.min(MAX_TARGET, Math.max(MIN_TARGET, Math.round(celsius * 2) / 2));
    await this.command(() => this.client.setTargetHalfDegrees(dev.ain, bounded * 2));
    logger.info(`${dev.name} target set to ${bounded} °C`);
    dev.hkr.target = bounded * 2;
    await this.confirm(dev, 'target', bounded);
    await this.confirm(dev, 'mode', MODE.HEATING);
    return bounded;
  }

  /**
   * Off closes the valve (253). Heating goes back to the temperature of the
   * weekly programme: comfort, or eco during an eco period. Never "on" (254,
   * the valve open whatever the temperature).
   */
  async setMode(dev, mode) {
    this.thermostatOf(dev);
    if (mode === MODE.OFF) {
      await this.command(() => this.client.setTargetHalfDegrees(dev.ain, HKR.OFF));
      logger.info(`${dev.name} heating off`);
      dev.hkr.target = HKR.OFF;
      await this.confirm(dev, 'mode', MODE.OFF);
      return null;
    }
    if (modeOf(dev.hkr) === MODE.HEATING && dev.hkr.target !== HKR.ON) {
      return dev.hkr.target / 2;
    }
    // The next switch goes to comfort: we are in an eco period.
    const eco = dev.hkr.comfort !== null && dev.hkr.nextTarget === dev.hkr.comfort * 2;
    return this.setTarget(dev, (eco ? dev.hkr.eco : dev.hkr.comfort) ?? 20);
  }

  /** The "Set a thermostat mode" scene action. */
  async thermostatAction(externalId, mode, minutes) {
    const dev = this.thermostatOf(this.deviceOf(externalId));
    const client = this.client;
    const until = (duration) => Math.floor(this.now() / 1000) + duration * 60;
    switch (mode) {
      case 'comfort':
        return this.setTarget(dev, dev.hkr.comfort ?? 20);
      case 'eco':
        return this.setTarget(dev, dev.hkr.eco ?? 16);
      case 'boost': {
        const duration = minutes || DEFAULT_MINUTES.boost;
        await this.command(() => client.setBoost(dev.ain, until(duration)));
        logger.info(`${dev.name} boost for ${duration} min`);
        break;
      }
      case 'window_open': {
        const duration = minutes || DEFAULT_MINUTES.window_open;
        await this.command(() => client.setWindowOpen(dev.ain, until(duration)));
        logger.info(`${dev.name} window open mode for ${duration} min`);
        break;
      }
      case 'end_boost':
        await this.command(async () => {
          await client.setBoost(dev.ain, 0);
          await client.setWindowOpen(dev.ain, 0);
        });
        logger.info(`${dev.name} boost and window open mode ended`);
        break;
      default:
        throw this.fail('failed', dev);
    }
    this.requestRefresh();
    this.refreshSoon();
    return null;
  }

  /** The "Test the connection" report. */
  async testConnection() {
    if (!this.client) {
      this.authBlockedUntil = 0;
      await this.connectBox();
      await this.sendStatus();
    }
    if (!this.client) {
      throw new GladysError(
        render(STATUS, this.problem ?? 'notFound', {
          host: this.config.host || FALLBACK_HOST,
          seconds: this.blockedSeconds,
        }),
        this.config.language,
      );
    }
    await this.runCycle();
    if (!this.client || !this.devices) {
      throw new GladysError(
        render(STATUS, this.problem ?? 'unreachable', {
          host: this.config.host || FALLBACK_HOST,
          seconds: this.blockedSeconds,
        }),
        this.config.language,
      );
    }
    const devices = this.publishable();
    const parts = [render(REPORTS, 'connected', { host: this.client.host })];
    if (devices.length === 0) {
      parts.push(render(REPORTS, 'none'));
    } else {
      parts.push(
        render(REPORTS, 'devices', {
          count: devices.length,
          absent: devices.filter((dev) => !dev.present).length,
        }),
        render(REPORTS, 'discover'),
      );
    }
    return join(...parts);
  }

  // --- Widget ------------------------------------------------------------------

  requestRefresh() {
    if (this.stopped) {
      return;
    }
    const now = this.now();
    const wait = this.lastRefreshAt + this.timings.widgetRefreshMs - now;
    if (wait <= 0) {
      this.lastRefreshAt = now;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    } else if (this.timers && !this.refreshTimer) {
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.requestRefresh();
      }, wait);
      this.refreshTimer.unref?.();
    }
  }

  /** What the widget shows: the devices, with their external id and whether they are created. */
  view() {
    return {
      connected: Boolean(this.client && this.devices),
      devices: this.publishable().map((dev) => {
        const id = deviceIds(this.gladys, dev.ain).device;
        return { dev, externalId: id, created: this.isCreated(id) };
      }),
    };
  }
}
