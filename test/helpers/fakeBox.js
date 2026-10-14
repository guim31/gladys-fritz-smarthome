// -----------------------------------------------------------------------------
// A simulated FRITZ!Box, built on the fixtures (the device list of
// test/fixtures/aha, real answers of pyfritzhome's tests): a `request` double
// for the AHA client (src/aha/http.js) that checks the login like the box
// does (PBKDF2 or MD5 challenge, session ids, the "Smart Home" right, blocked
// logins), answers `homeautoswitch.lua` and applies the commands to the
// device list. `serve()` exposes the same box over real HTTP, for the manual
// check in the locked-down Docker container (never used by the tests, which
// do not touch the network).
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { challengeResponse } from '../../src/aha/login.js';

process.env.LOG_LEVEL ??= 'silent';

export const fixture = (name) =>
  readFileSync(new URL(`../fixtures/aha/${name}`, import.meta.url), 'utf8');

export const USERNAME = 'gladys';
export const PASSWORD = 'secret password';
// The challenges of pyfritzhome's login fixtures.
const CHALLENGES = {
  pbkdf2: '2$10000$a64b986b521fcbc44d7a9f0adad34b14$1000$b9c232dea345233f5a893b2284931ac8',
  md5: '44b750c0',
};

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

function sessionInfo({ sid = '0000000000000000', challenge, blockTime = 0, rights = [] }) {
  const rightsXml = rights.map(
    ([name, access]) => `<Name>${name}</Name><Access>${access}</Access>`,
  );
  return (
    '<?xml version="1.0" encoding="utf-8"?><SessionInfo>' +
    `<SID>${sid}</SID><Challenge>${challenge}</Challenge><BlockTime>${blockTime}</BlockTime>` +
    `<Rights>${rightsXml.join('')}</Rights><Users><User last="1">${USERNAME}</User></Users></SessionInfo>`
  );
}

/**
 * @param {object} [options]
 * @param {'pbkdf2'|'md5'} [options.login] format of the challenge
 * @param {string} [options.host] the address it answers on (others: no answer)
 * @param {boolean} [options.smartHome] false: the user lacks the "Smart Home" right
 * @param {string} [options.xml] the device list
 */
export function createFakeBox({
  login = 'pbkdf2',
  host = '192.0.2.1',
  smartHome = true,
  xml = fixture('devicelist.xml'),
} = {}) {
  const box = {
    host,
    xml,
    login,
    smartHome,
    reachable: true,
    blockTime: 0,
    failedLogins: 0,
    logins: 0,
    sessions: new Set(),
    /** Every AHA command received: `{ switchcmd, ain, ...params }`. */
    commands: [],
    /** Paths requested (no query string: it holds the session id). */
    paths: [],

    /** Replace the block of one device (or group) of the list. */
    edit(ain, fn) {
      const pattern = new RegExp(
        `<(device|group)\\b[^>]*identifier="${escapeRegExp(ain)}"[\\s\\S]*?</\\1>`,
      );
      if (!pattern.test(box.xml)) {
        throw new Error(`No device ${ain} in the fake box`);
      }
      box.xml = box.xml.replace(pattern, (block) => fn(block));
    },
    /** Set the text of the first `<tag>` of a device (`<tag/>` too). */
    setTag(ain, tag, value) {
      box.edit(ain, (block) => {
        const full = new RegExp(`<${tag}>[\\s\\S]*?</${tag}>|<${tag}/>`);
        if (!full.test(block)) {
          throw new Error(`No <${tag}> in ${ain}`);
        }
        return block.replace(full, `<${tag}>${value}</${tag}>`);
      });
    },
    /** The text of the first `<tag>` of a device. */
    tag(ain, tag) {
      const block = box.xml.match(
        new RegExp(`identifier="${escapeRegExp(ain)}"[\\s\\S]*?</(device|group)>`),
      )?.[0];
      return block?.match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`))?.[1] ?? null;
    },
    /** A press on a button (`AIN-n`) at a Unix time. */
    press(buttonAin, timestamp) {
      box.xml = box.xml.replace(
        new RegExp(
          `(<button identifier="${escapeRegExp(buttonAin)}"[\\s\\S]*?<lastpressedtimestamp>)[^<]*(</lastpressedtimestamp>)`,
        ),
        `$1${timestamp}$2`,
      );
    },
    /** The box forgets every session (20 minutes without a request, a restart). */
    expireSessions() {
      box.sessions.clear();
    },
    request,
  };

  function answer(status, body = '') {
    return { status, headers: { 'content-type': 'text/xml' }, body };
  }

  function loginPage(query) {
    const challenge = CHALLENGES[box.login];
    if (query.get('logout')) {
      box.sessions.delete(query.get('sid'));
      return answer(200, sessionInfo({ challenge }));
    }
    if (!query.has('response')) {
      return answer(200, sessionInfo({ challenge, blockTime: box.blockTime }));
    }
    const expected = challengeResponse(challenge, PASSWORD);
    if (
      box.blockTime > 0 ||
      query.get('username') !== USERNAME ||
      query.get('response') !== expected
    ) {
      box.failedLogins += 1;
      return answer(200, sessionInfo({ challenge, blockTime: box.blockTime }));
    }
    box.logins += 1;
    const sid = randomBytes(8).toString('hex');
    box.sessions.add(sid);
    const rights = box.smartHome
      ? [
          ['Dial', 2],
          ['HomeAuto', 2],
          ['BoxAdmin', 2],
        ]
      : [['Dial', 2]];
    return answer(200, sessionInfo({ sid, challenge, rights }));
  }

  function setBlock(ain, tag, value) {
    try {
      box.setTag(ain, tag, value);
    } catch {
      // A device without that element: the box answers anyway.
    }
  }

  function homeAuto(query) {
    if (!box.sessions.has(query.get('sid'))) {
      return answer(403, 'Forbidden');
    }
    const switchcmd = query.get('switchcmd');
    const ain = query.get('ain');
    const params = Object.fromEntries(
      [...query.entries()].filter(([key]) => !['sid', 'switchcmd', 'ain'].includes(key)),
    );
    box.commands.push({ switchcmd, ...(ain ? { ain } : {}), ...params });
    if (switchcmd === 'getdevicelistinfos') {
      return box.smartHome ? answer(200, box.xml) : answer(403, 'Forbidden');
    }
    if (!ain || !box.xml.includes(`identifier="${ain}"`)) {
      return answer(400, 'Bad Request');
    }
    switch (switchcmd) {
      case 'setswitchon':
      case 'setswitchoff': {
        const on = switchcmd === 'setswitchon' ? 1 : 0;
        setBlock(ain, 'state', on);
        return answer(200, `${on}\n`);
      }
      case 'setsimpleonoff':
        box.edit(ain, (block) =>
          block.replace(/(<simpleonoff>\s*<state>)[\s\S]*?(<\/state>)/, `$1${params.onoff}$2`),
        );
        return answer(200, '');
      case 'setlevelpercentage':
        setBlock(ain, 'levelpercentage', params.level);
        return answer(200, '');
      case 'setblind':
        if (!['open', 'close', 'stop'].includes(params.target)) {
          return answer(400, 'Bad Request');
        }
        if (params.target !== 'stop') {
          setBlock(ain, 'levelpercentage', params.target === 'open' ? 0 : 100);
        }
        return answer(200, '');
      case 'setunmappedcolor':
        setBlock(ain, 'hue', params.hue);
        setBlock(ain, 'saturation', params.saturation);
        return answer(200, '');
      case 'sethkrtsoll': {
        const value = Number(params.param);
        if (!((value >= 16 && value <= 56) || value === 253 || value === 254)) {
          return answer(200, 'inval');
        }
        setBlock(ain, 'tsoll', value);
        return answer(200, '');
      }
      case 'sethkrboost':
      case 'sethkrwindowopen': {
        const [flag, end] =
          switchcmd === 'sethkrboost'
            ? ['boostactive', 'boostactiveendtime']
            : ['windowopenactiv', 'windowopenactiveendtime'];
        const timestamp = Number(params.endtimestamp);
        setBlock(ain, flag, timestamp > 0 ? 1 : 0);
        setBlock(ain, end, timestamp);
        return answer(200, `${timestamp}\n`);
      }
      default:
        return answer(400, 'Bad Request');
    }
  }

  async function request({ url }) {
    const target = new URL(url);
    if (!box.reachable || target.hostname !== box.host) {
      throw Object.assign(new Error(`connect ECONNREFUSED ${target.hostname}`), {
        code: 'ECONNREFUSED',
      });
    }
    box.paths.push(target.pathname);
    if (target.pathname === '/login_sid.lua') {
      return loginPage(target.searchParams);
    }
    if (target.pathname === '/webservices/homeautoswitch.lua') {
      return homeAuto(target.searchParams);
    }
    return answer(404, 'Not Found');
  }

  /** Serve the box over real HTTP (manual check only). */
  box.serve = (port = 8080, address = '0.0.0.0') =>
    new Promise((resolve) => {
      const server = http.createServer(async (req, res) => {
        const result = await request({ url: `http://${box.host}${req.url}` }).catch(() =>
          answer(500, ''),
        );
        res.writeHead(result.status, result.headers);
        res.end(result.body);
      });
      server.listen(port, address, () => resolve(server));
    });

  return box;
}
