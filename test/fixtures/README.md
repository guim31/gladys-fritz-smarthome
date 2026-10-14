# Test fixtures

- `gladys-feature-table.json`: category/type couples, units and poll frequencies the Gladys core
  knows, extracted from its code (see its `source` field).
- `aha/devicelist.xml`: a `getdevicelistinfos` answer assembled from the real device lists of the
  tests of [pyfritzhome](https://github.com/hthiery/python-fritzhome) (MIT, Heiko Thiery):
  FRITZ!DECT 200 (`powermeter/device_list.xml`, with the `<simpleonoff>` element and the
  function bitmask of recent firmwares added), FRITZ!DECT Repeater 100 and Comet DECT
  (`base/device_list.xml`, `thermostat/device_list_battery_low.xml`, `base/device_not_present.xml`),
  FRITZ!DECT 302 (`thermostat/device_hkr_fritzos_7_57.xml`), FRITZ!DECT 301 and the groups
  (`groups/device_list_thermostat.xml`, `base/device_list.xml`), HAN-FUN window contact and smoke
  detector (`alarm/`), Rollotron 1213 (`blind/`), FRITZ!DECT 500 (`lightbulb/`), FRITZ!DECT 440
  (`button/device_button_fritzdect440_fw_05_10.xml`). Every AIN is replaced by an invented one
  (`11657 00001xx`). The **FRITZ!DECT 400** entry is composed, not captured: one device with two
  `<button>` entries (`-1` "kurz", `-9` "lang"), as AVM's documentation and user reports describe
  it.
- `aha/login_rsp_*.xml`: login answers (`SessionInfo`) of pyfritzhome's tests, PBKDF2 and MD5
  challenges. The expected answers in `test/login.test.js` were computed with Python's `hashlib`;
  the examples of AVM's "Session IDs in FRITZ!OS" are checked too.
- `aha/ssdp-results.json`: results of the core's SSDP scan, copied from gladys-fritzbox (headers
  composed from the AVM format, anonymized addresses).
