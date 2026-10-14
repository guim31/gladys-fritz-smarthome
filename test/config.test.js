import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, normalizeHost } from '../src/config.js';

const DEFAULTS = {
  host: '',
  username: '',
  password: '',
  https: false,
  pollInterval: 30,
  language: 'fr',
};

test('the defaults apply to an empty or broken configuration', () => {
  assert.deepEqual(normalizeConfig(), DEFAULTS);
  assert.deepEqual(normalizeConfig(null), DEFAULTS);
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), DEFAULTS);
  assert.deepEqual(normalizeConfig({ poll_interval: '7', language: 'it', https: 'no' }), DEFAULTS);
});

test('values are trimmed and typed; the password is kept as typed', () => {
  assert.deepEqual(
    normalizeConfig({
      host: ' 192.0.2.1 ',
      username: ' gladys ',
      password: ' secret ',
      https: true,
      poll_interval: '10',
      language: 'de',
    }),
    {
      host: '192.0.2.1',
      username: 'gladys',
      password: ' secret ',
      https: true,
      pollInterval: 10,
      language: 'de',
    },
  );
});

test('an address pasted as a URL or with a port is reduced to the host', () => {
  assert.equal(normalizeHost('http://192.0.2.1/'), '192.0.2.1');
  assert.equal(normalizeHost('https://fritz.box/'), 'fritz.box');
  assert.equal(normalizeHost('fritz.box:80'), 'fritz.box');
  assert.equal(normalizeHost('[fd00::1]'), 'fd00::1');
  assert.equal(normalizeHost('fd00::1'), 'fd00::1');
  assert.equal(normalizeHost(''), '');
  assert.equal(normalizeHost(42), '');
});
