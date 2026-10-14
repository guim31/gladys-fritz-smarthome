# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the user name and password of a FRITZ!Box user, entered in the
  Gladys configuration (the password is a `secret` field) and received from
  Gladys at start. They are kept in memory only, never written under `/data`
  nor logged. The password never travels: the login answers a challenge
  (PBKDF2, or MD5 on old boxes). The session id is kept in memory, never
  logged, and the session is closed when the integration stops. After a
  refused login, the integration waits 15 minutes before trying again, so that
  it never locks the user out of the box.
- **Stored in `/data`**: nothing.
- **Network**: from its container, HTTP (port 80) or HTTPS (port 443,
  certificate not verified: the box's own) towards the FRITZ!Box only. The
  SSDP search is sent by the Gladys core on the integration's behalf
  (manifest `network_discovery`). Nothing leaves the local network.
- **Commands**: the thermostats are bounded to 8–28 °C, and neither the
  permanent "on" (254) nor a boost or "window open" mode longer than 24 hours
  can be sent.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the FRITZ!Box, its smart home devices and their firmware (report those to
AVM).
