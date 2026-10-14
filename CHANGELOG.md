# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- First version: the smart home devices of a FRITZ!Box in Gladys, through its local AHA-HTTP
  interface (login PBKDF2 or MD5, user with the "Smart Home" right, box found on the network when
  no address is given).
- Plugs (FRITZ!DECT 200/210, HAN-FUN): switch, power, energy, voltage, temperature.
- Radiator thermostats (FRITZ!DECT 301/302, Comet DECT): target temperature bounded to 8–28 °C,
  heating off / heating, open window mode, boost, temperature, battery.
- Blinds (Rollotron, DECT ULE): position and open / stop / close. Lamps (FRITZ!DECT 500): on/off,
  brightness, colour. HAN-FUN detectors: opening, smoke, motion, water leak. Battery, temperature
  and humidity of the buttons and sensors.
- Scene triggers: FRITZ!DECT 400/440 button pressed (button, short or long press), open window
  detected, battery low.
- Scene action: set a radiator thermostat (comfort, eco, boost or "window open" for a while, end).
- Dashboard widget: plugs' power, thermostats heating, open windows, one line per device.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-fritz-smarthome/commits/main
