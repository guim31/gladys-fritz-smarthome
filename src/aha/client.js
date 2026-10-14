// -----------------------------------------------------------------------------
// The AHA-HTTP client of a FRITZ!Box: a session (src/aha/login.js) and the
// commands of `/webservices/homeautoswitch.lua`, as AVM documents them in
// "AHA-HTTP-Interface" and as pyfritzhome calls them.
//
// Errors carry a `kind` the hub turns into a status for the user:
// - unreachable: no answer (network, timeout, 5xx);
// - auth: the box refused the user name or the password;
// - blocked: the box blocks logins for `seconds` after failed attempts;
// - rights: the user lacks the "Smart Home" right;
// - invalid: the box refused a command (`inval`, HTTP 400), e.g. a device
//   that does not support it.
// -----------------------------------------------------------------------------

import { httpRequest } from './http.js';
import { EMPTY_SID, challengeResponse } from './login.js';
import { child, childrenNamed, parseXml, textOf } from './xml.js';

const LOGIN_PATH = '/login_sid.lua';
const AHA_PATH = '/webservices/homeautoswitch.lua';

export class AhaError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.kind = kind;
    Object.assign(this, extra);
  }
}

/** The rights of a `SessionInfo`, as `{ HomeAuto: 2, … }`. */
export function rightsOf(session) {
  const rights = {};
  const block = child(session, 'Rights');
  const names = childrenNamed(block, 'Name');
  const access = childrenNamed(block, 'Access');
  names.forEach((name, index) => {
    rights[name.text] = Number(access[index]?.text ?? 0);
  });
  return rights;
}

export class AhaClient {
  /**
   * @param {object} options
   * @param {string} options.host address of the box (IP or name)
   * @param {boolean} [options.https] port 443 instead of 80 (self-signed certificate, not checked)
   * @param {string} options.username
   * @param {string} options.password
   * @param {Function} [options.request] HTTP seam (tests): same contract as httpRequest
   */
  constructor({ host, https = false, username, password, request }) {
    this.host = host;
    this.base = `${https ? 'https' : 'http'}://${host.includes(':') ? `[${host}]` : host}`;
    this.username = username;
    this.password = password;
    this.request = request ?? httpRequest;
    this.sid = null;
    this.loggingIn = null;
  }

  async get(path, params) {
    const url = new URL(path, this.base);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    let response;
    try {
      response = await this.request({ method: 'GET', url: url.toString() });
    } catch (err) {
      throw new AhaError('unreachable', `No answer from ${this.host} (${err.code ?? err.message})`);
    }
    if (response.status >= 500) {
      throw new AhaError('unreachable', `HTTP ${response.status} from ${this.host}`);
    }
    return response;
  }

  async sessionInfo(params) {
    const response = await this.get(LOGIN_PATH, { version: 2, ...params });
    if (response.status !== 200) {
      throw new AhaError('unreachable', `HTTP ${response.status} on the login page`);
    }
    let session;
    try {
      session = parseXml(response.body);
    } catch {
      session = null;
    }
    if (session?.name !== 'SessionInfo') {
      throw new AhaError('unreachable', `${this.host} is not a FRITZ!Box (no login page)`);
    }
    return session;
  }

  /** Open a session; one login at a time, shared by concurrent callers. */
  login() {
    this.loggingIn ??= this.doLogin().finally(() => {
      this.loggingIn = null;
    });
    return this.loggingIn;
  }

  async doLogin() {
    this.sid = null;
    const first = await this.sessionInfo({});
    const blockTime = Number(textOf(first, 'BlockTime') ?? 0);
    if (blockTime > 0) {
      throw new AhaError('blocked', `Logins blocked for ${blockTime} s`, { seconds: blockTime });
    }
    const challenge = textOf(first, 'Challenge') ?? '';
    const answer = await this.sessionInfo({
      username: this.username,
      response: challengeResponse(challenge, this.password),
    });
    const sid = textOf(answer, 'SID');
    if (!sid || sid === EMPTY_SID) {
      const seconds = Number(textOf(answer, 'BlockTime') ?? 0);
      throw new AhaError('auth', 'Login refused (user name or password)', { seconds });
    }
    if (!(rightsOf(answer).HomeAuto > 0)) {
      // Logged in without the right: close that session, it is useless.
      await this.get(LOGIN_PATH, { version: 2, logout: 1, sid }).catch(() => {});
      throw new AhaError('rights', 'The user lacks the "Smart Home" right');
    }
    this.sid = sid;
    return sid;
  }

  async logout() {
    const sid = this.sid;
    this.sid = null;
    if (sid) {
      await this.get(LOGIN_PATH, { version: 2, logout: 1, sid }).catch(() => {});
    }
  }

  /**
   * One AHA command. A refused session (HTTP 403: expired after 20 minutes,
   * or the box restarted) logs in again once.
   * @returns {Promise<string>} the answer, trimmed
   */
  async command(switchcmd, { ain, ...params } = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sid = this.sid ?? (await this.login());
      const response = await this.get(AHA_PATH, { switchcmd, sid, ain, ...params });
      if (response.status === 403 || response.status === 401) {
        // Another caller may have logged in again meanwhile: keep its session.
        if (this.sid === sid) {
          this.sid = null;
        }
        continue;
      }
      if (response.status === 400) {
        throw new AhaError('invalid', `${switchcmd} refused (HTTP 400)`);
      }
      if (response.status !== 200) {
        throw new AhaError('unreachable', `HTTP ${response.status} on ${switchcmd}`);
      }
      const body = String(response.body ?? '').trim();
      if (body === 'inval') {
        throw new AhaError('invalid', `${switchcmd} refused (inval)`);
      }
      return body;
    }
    // Logged in, then refused again: the right was removed in between.
    throw new AhaError('rights', 'The user lacks the "Smart Home" right');
  }

  /** The raw `getdevicelistinfos` document. */
  deviceListXml() {
    return this.command('getdevicelistinfos');
  }

  // --- Commands (AIN with its space, as the box gives it) ---------------------

  setSwitch(ain, on) {
    return this.command(on ? 'setswitchon' : 'setswitchoff', { ain });
  }

  /** On/off of a HAN-FUN unit (a lamp, a plug of another brand). */
  setSimpleOnOff(ain, on) {
    return this.command('setsimpleonoff', { ain, onoff: on ? 1 : 0 });
  }

  /** Brightness of a lamp, closing of a blind: 0 to 100. */
  setLevelPercentage(ain, percent) {
    return this.command('setlevelpercentage', { ain, level: Math.round(percent) });
  }

  /** `open`, `close` or `stop`. */
  setBlind(ain, target) {
    return this.command('setblind', { ain, target });
  }

  /** Free colour (FRITZ!OS 7.39+): hue 0-359, saturation 0-255. */
  setUnmappedColor(ain, hue, saturation) {
    return this.command('setunmappedcolor', { ain, hue, saturation, duration: 0 });
  }

  /** Target in half degrees: 16-56 (8-28 °C), 253 off, 254 on. */
  setTargetHalfDegrees(ain, value) {
    return this.command('sethkrtsoll', { ain, param: value });
  }

  /** Boost until a Unix time (0 ends it); 24 hours ahead at most. */
  setBoost(ain, endTimestamp) {
    return this.command('sethkrboost', { ain, endtimestamp: endTimestamp });
  }

  /** "Window open" mode until a Unix time (0 ends it); 24 hours ahead at most. */
  setWindowOpen(ain, endTimestamp) {
    return this.command('sethkrwindowopen', { ain, endtimestamp: endTimestamp });
  }
}
