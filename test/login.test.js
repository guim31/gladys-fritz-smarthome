// -----------------------------------------------------------------------------
// The login of the FRITZ!Box (src/aha/login.js, src/aha/client.js): AVM's own
// examples of both challenge formats, then the session against the simulated
// box: PBKDF2 and MD5 logins, refused password, missing right, blocked
// logins, expired session, silent box.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AhaClient, rightsOf } from '../src/aha/client.js';
import { challengeResponse, md5Response, pbkdf2Response } from '../src/aha/login.js';
import { parseXml } from '../src/aha/xml.js';
import { PASSWORD, USERNAME, createFakeBox, fixture } from './helpers/fakeBox.js';

const client = (box, options = {}) =>
  new AhaClient({
    host: box.host,
    username: USERNAME,
    password: PASSWORD,
    request: box.request,
    ...options,
  });

test('the examples of AVM "Session IDs in FRITZ!OS" give the documented answers', () => {
  assert.equal(md5Response('1234567z', 'äbc'), '1234567z-9e224a41eeefa284df7bb0f26c2913e2');
  assert.equal(
    pbkdf2Response('2$10000$5A1711$2000$5A1722', '1example!'),
    '5A1722$1798a1672bca7c6463d6b245f82b53703b0f50813401b03e4045a5861e689adb',
  );
  // Characters above U+00FF become a dot before MD5 hashing.
  assert.equal(md5Response('1234567z', 'a€b'), md5Response('1234567z', 'a.b'));
});

test('the challenge format chooses the answer (pyfritzhome fixtures, checked with Python hashlib)', () => {
  const pbkdf2 = parseXml(fixture('login_rsp_without_valid_sid_pbkdf2.xml'));
  const md5 = parseXml(fixture('login_rsp_without_valid_sid.xml'));
  const challenge = (session) => session.children.find((node) => node.name === 'Challenge').text;
  assert.equal(
    challengeResponse(challenge(pbkdf2), PASSWORD),
    'b9c232dea345233f5a893b2284931ac8$578e08263c2d6380645900c930a836fc99144b498d330539c7bbc574b9432ac8',
  );
  assert.equal(
    challengeResponse(challenge(md5), PASSWORD),
    '44b750c0-19681cf4895acdc5b7d663a359e16328',
  );
  assert.deepEqual(rightsOf(pbkdf2), {});
});

for (const login of ['pbkdf2', 'md5']) {
  test(`a ${login} login opens a session that reads the devices`, async () => {
    const box = createFakeBox({ login });
    const aha = client(box);
    const xml = await aha.deviceListXml();
    assert.match(xml, /^<\?xml/);
    assert.equal(box.logins, 1);
    assert.equal(box.sessions.size, 1);
    await aha.logout();
    assert.equal(box.sessions.size, 0);
  });
}

test('a refused password is an auth error, never retried by the client', async () => {
  const box = createFakeBox();
  const aha = new AhaClient({
    host: box.host,
    username: USERNAME,
    password: 'nope',
    request: box.request,
  });
  await assert.rejects(aha.deviceListXml(), { kind: 'auth' });
  assert.equal(box.failedLogins, 1);
});

test('a user without the "Smart Home" right is told so, and its session is closed', async () => {
  const box = createFakeBox({ smartHome: false });
  await assert.rejects(client(box).login(), { kind: 'rights' });
  assert.equal(box.logins, 1);
  assert.equal(box.sessions.size, 0);
});

test('blocked logins are reported with their delay, without sending the password', async () => {
  const box = createFakeBox();
  box.blockTime = 32;
  await assert.rejects(client(box).login(), { kind: 'blocked', seconds: 32 });
  assert.equal(box.failedLogins, 0);
});

test('an expired session logs in again once, transparently', async () => {
  const box = createFakeBox();
  const aha = client(box);
  await aha.deviceListXml();
  box.expireSessions();
  await aha.deviceListXml();
  assert.equal(box.logins, 2);
});

test('concurrent commands share one login', async () => {
  const box = createFakeBox();
  const aha = client(box);
  await Promise.all([aha.deviceListXml(), aha.deviceListXml(), aha.deviceListXml()]);
  assert.equal(box.logins, 1);
});

test('a silent box, another web server, a refused command', async () => {
  const box = createFakeBox();
  await assert.rejects(client(box, { host: '192.0.2.99' }).login(), { kind: 'unreachable' });
  const notABox = new AhaClient({
    host: 'example.test',
    username: USERNAME,
    password: PASSWORD,
    request: async () => ({ status: 200, headers: {}, body: '<html><body>Hello</body></html>' }),
  });
  await assert.rejects(notABox.login(), { kind: 'unreachable', message: /not a FRITZ!Box/ });
  const aha = client(box);
  await assert.rejects(aha.setTargetHalfDegrees('11657 0000103', 70), { kind: 'invalid' });
  await assert.rejects(aha.setSwitch('99999 9999999', true), { kind: 'invalid' });
});

test('the session id never shows in an error message', async () => {
  const box = createFakeBox();
  const aha = client(box);
  await aha.login();
  const sid = aha.sid;
  box.reachable = false;
  const err = await aha.deviceListXml().catch((error) => error);
  assert.equal(err.kind, 'unreachable');
  assert.ok(!err.message.includes(sid));
  assert.ok(!err.message.includes(PASSWORD));
});
