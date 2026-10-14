# FRITZ!SmartHome for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that connects the
**AVM smart home devices** (DECT and DECT ULE / HAN-FUN) managed by a FRITZ!Box: FRITZ!DECT 200/210
plugs, FRITZ!DECT 301/302 and Comet DECT radiator thermostats, Rollotron blinds, FRITZ!DECT 500
lamps, HAN-FUN detectors, and the FRITZ!DECT 400/440 buttons as scene triggers. The equivalent of
the Home Assistant **AVM FRITZ!SmartHome** (`fritzbox`) integration. Everything stays local: the
AHA-HTTP interface documented by AVM. No cloud, no MyFRITZ! account.

It complements [gladys-fritzbox](https://github.com/guim31/gladys-fritzbox) (internet, guest
Wi-Fi, presence, calls), which leaves the smart home devices out: install either or both.

> **Developed without the hardware: feedback welcome.** The integration is covered by automated
> tests built on real device lists of FRITZ!Boxes (collected by pyfritzhome), its login was checked
> against AVM's own examples (PBKDF2 and MD5), and the whole integration ran against a simulated box
> in the locked-down container, but it has not run against a real FRITZ!Box yet. Please report what
> works and what does not in the [issues](https://github.com/guim31/gladys-fritz-smarthome/issues).
>
> **Ohne die Hardware entwickelt: Rückmeldungen sind willkommen.**

## Features

- **One Gladys device per smart home device**, with the features it has:
  - plugs: **switch**, **power** (W), **energy** (kWh), **voltage** (V), **temperature**;
  - radiator thermostats: **target temperature** (bounded to 8–28 °C), **heating** mode (off /
    heating, never the permanent "on"), **open window** mode, **boost**, **temperature**,
    **battery**;
  - blinds: **position** (100 = open) and open / stop / close;
  - lamps: **on/off**, **brightness**, **colour**;
  - HAN-FUN detectors: **opening**, **smoke**, **motion**, **water leak**;
  - buttons and sensors: **battery**, **temperature**, **humidity**.
- **Dashboard widget**: power of the plugs, thermostats heating, open windows, and one line per
  device.
- **Scene triggers**: a FRITZ!DECT **button pressed** (which button, short or long press), an
  **open window detected** by a thermostat, a **battery low**.
- **Scene action**: **set a radiator thermostat** to its comfort or eco temperature, a boost or the
  "window open" mode for a while (24 h at most), or end them.

## Requirements

- Gladys Assistant **5.1.0** or later.
- A FRITZ!Box with FRITZ!OS 7 or later (7.24+ recommended for the PBKDF2 login), and a FRITZ!Box
  user with the **Smart Home** right.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter
   `https://github.com/guim31/gladys-fritz-smarthome` (or install it from the catalog once it is
   listed). The install screen shows the access the integration asks for: the **SSDP search for
   urn:dslforum-org:device:InternetGatewayDevice:1** (to find the box when no address is given).
2. In **Configuration**, enter the user name and password (the address is optional), then run
   **Test the connection**.
3. Open the **Discover** tab and press **Add to Gladys** on the devices you want.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

```
Integration container ──AHA-HTTP: /login_sid.lua + /webservices/homeautoswitch.lua, HTTP :80 (or HTTPS :443)──▶ FRITZ!Box
      │ SDK (WebSocket + host API)
      ▼
Gladys core (host network) ──SSDP M-SEARCH (only without an address)──▶ LAN
```

- Login as AVM documents it ("Session IDs in FRITZ!OS"): PBKDF2 challenge (FRITZ!OS 7.24+) or MD5
  (older), session id renewed when the box expires it, the "Smart Home" right checked. A refused
  login stops for 15 minutes; a login blocked by the box waits for its delay.
- One `getdevicelistinfos` per read (30 s by default), parsed without dependency; devices are
  published with `should_poll: false` and only the changes are sent, plus every value every 12
  hours. Button presses are detected from `lastpressedtimestamp` between two reads.
- Commands: `setswitchon/off`, `setsimpleonoff`, `setlevelpercentage`, `setblind`,
  `setunmappedcolor`, `sethkrtsoll` (16–56 half degrees or 253 = off; never 254 = on),
  `sethkrboost`, `sethkrwindowopen`.

## Limitations

- **Developed without the hardware**: see above.
- One FRITZ!Box per installation. Groups and templates of the box are not proposed.
- Button presses are seen at the next read (10 s to 2 min), two presses between two reads count as
  one. The FRITZ!DECT 400 short/long presses are told apart by the order of its two entries (and
  their German names "kurz"/"lang"): to be confirmed on a real device.
- Colour temperature of the lamps is not offered. Holiday/summer periods, comfort/eco temperatures
  and the weekly programme stay in the box.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests + the SDK's fake Gladys and a simulated FRITZ!Box
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store --skip-image-check .   # store validator
```

```
index.js                SDK wiring (src/app.js registers the handlers)
src/app.js              handlers → hub, configuration action
src/hub.js              session, read cycle, states, scene events, commands
src/aha/client.js       AHA-HTTP client (login, session, commands, errors)
src/aha/login.js        PBKDF2 and MD5 challenge answers
src/aha/devicelist.js   getdevicelistinfos → plain objects
src/aha/xml.js          small XML reader
src/aha/http.js         the one place that opens HTTP connections
src/discovery.js        SSDP answers relayed by the core
src/devices.js          Gladys devices and values, names in four languages
src/scenes.js           scene action
src/widgets.js          dashboard widget
src/messages.js         texts sent from the container, four languages
src/config.js           configuration defaults and normalization
```

## Credits

- [pyfritzhome](https://github.com/hthiery/python-fritzhome) (MIT, Heiko Thiery): the reference for
  the AHA-HTTP commands and the login, and the real device lists and login answers of its tests used
  as fixtures.
- [Home Assistant](https://www.home-assistant.io/integrations/fritzbox/) (`fritzbox`, Apache-2.0):
  what users expect (thermostat bounds 8–28 °C, blind position, lock / summer / holiday handling).
- [AVM](https://avm.de/service/schnittstellen/): the public "AHA-HTTP-Interface" and "Session IDs"
  documents.
- [gladys-fritzbox](https://github.com/guim31/gladys-fritzbox): the HTTP layer, the SSDP search and
  the configuration form.
- Cover: the FRITZ! logo (December 2025) from
  [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Fritz!_Logo_2025.12.svg), public
  domain, recolored white.

Not affiliated with FRITZ! GmbH (formerly AVM). FRITZ!, FRITZ!Box and FRITZ!DECT are trademarks of
FRITZ! GmbH.

## License

Apache-2.0, see [LICENSE](LICENSE).
