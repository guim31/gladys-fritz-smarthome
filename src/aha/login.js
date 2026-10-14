// -----------------------------------------------------------------------------
// The login of the FRITZ!Box web interface (`/login_sid.lua?version=2`), as
// AVM documents it in "Session IDs in FRITZ!OS" and as pyfritzhome does it:
// the box gives a challenge, the integration answers it with the password,
// the box returns a session id (SID) valid 20 minutes after the last request.
//
// Two answer formats:
// - PBKDF2 (FRITZ!OS 7.24 and later), challenge `2$<iter1>$<salt1>$<iter2>$<salt2>`:
//   hash1 = PBKDF2-SHA256(password, salt1, iter1), hash2 = PBKDF2-SHA256(hash1,
//   salt2, iter2), response `<salt2>$<hex(hash2)>`.
// - MD5 (older boxes), challenge of 8 hex digits: response
//   `<challenge>-<md5(UTF-16LE("<challenge>-<password>"))>`, every character
//   above U+00FF of the password replaced by a dot first.
// -----------------------------------------------------------------------------

import { createHash, pbkdf2Sync } from 'node:crypto';

export const EMPTY_SID = '0000000000000000';

/** The answer to a PBKDF2 challenge (`2$…`). */
export function pbkdf2Response(challenge, password) {
  const [, iter1, salt1, iter2, salt2] = String(challenge).split('$');
  const hash1 = pbkdf2Sync(
    Buffer.from(String(password), 'utf8'),
    Buffer.from(salt1, 'hex'),
    Number(iter1),
    32,
    'sha256',
  );
  const hash2 = pbkdf2Sync(hash1, Buffer.from(salt2, 'hex'), Number(iter2), 32, 'sha256');
  return `${salt2}$${hash2.toString('hex')}`;
}

/** The answer to an MD5 challenge. */
export function md5Response(challenge, password) {
  const safe = [...String(password)].map((char) => (char.codePointAt(0) > 255 ? '.' : char));
  const hash = createHash('md5')
    .update(Buffer.from(`${challenge}-${safe.join('')}`, 'utf16le'))
    .digest('hex');
  return `${challenge}-${hash}`;
}

/** The answer to a challenge, in the format the challenge asks for. */
export function challengeResponse(challenge, password) {
  return String(challenge).startsWith('2$')
    ? pbkdf2Response(challenge, password)
    : md5Response(challenge, password);
}
