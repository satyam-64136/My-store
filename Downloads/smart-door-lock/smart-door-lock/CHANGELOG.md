# Changelog
Format: [Keep a Changelog](https://keepachangelog.com), versioning: [SemVer](https://semver.org).

## [Unreleased]
### Changed (structure)
- Flattened for GitHub: `index.html` at the repo root (GitHub Pages) and `firmware/` at the top level.
- Removed the optional Python tooling (`fwtest/`, `tests/`, `requirements*.txt`, `.env.example`, `config.example.json`); the lock does not need it.
### Added
- `docs/WIRING.txt`: text wiring guide with nets and a first-power-up checklist.
### Changed (broker)
- Default broker is now EMQX Cloud Serverless (HiveMQ closed free Serverless clusters). Web app has a WebSocket port field (default 8084).
### Fixed
- MQTT/Telegram TLS failed on brokers without Max Fragment Length support (forced 512 byte buffers). Now probes support and falls back to default buffers, pausing MQTT during the Telegram call when memory is tight.
- Clear `[MQTT] fail rc=` messages and a warning for a malformed `MQTT_HOST`.
### Added (LCD)
- 16x2 I2C LCD status display (auto-detects address). Needs the LiquidCrystal I2C library.
### Changed
- Wiring diagram and docs updated for a 12 V battery (no adapter), 1N5819 flyback diode, optional 100 µF capacitor and a 16x2 I2C LCD on D1/D2.

## [2.0.0] - 2026-11-18
### Changed
- Rebuilt around MQTT push (any cloud MQTT broker) instead of Google Apps Script polling. Unlock latency drops from 1-3 s to ~50-150 ms.
- OTP is generated (hardware RNG) and verified on the ESP8266; the web app never sees the code.
- Hardware: ESP8266 NodeMCU + 4-channel relay + 12 V solenoid + buck converter. No keypad, no LCD.
- Web app redesigned: lock dial, 6-box code entry, toasts, activity log, light/dark.
### Added
- Error handling: command timeouts, CDN fallback, auth-failure stop, offline/online handling, low-memory guard, WiFi watchdog.
- `secrets.h` separation so credentials stay out of git.
### Security
- 6-digit OTP, 5 min expiry, single use, 3 tries then 60 s lockout, 15 s request cooldown.
- Telegram OTP message is auto-deleted after use. Revoke any token from v1 (it was committed in plain text).

## [1.0.0]
- Initial version: ESP32/ESP8266 polling a Google Apps Script backend, Telegram OTP, LCD, keypad stubs.
