![Logo](admin/siemens-7kt1666.png)

# ioBroker.siemens-7kt1666

**[Deutsche Version](README.de.md)**

ioBroker adapter for Siemens SENTRON 7KT PAC1600 energy meters via Modbus – directly over RS-485, via Modbus TCP, or as RTU frames over TCP (e.g. an ESP32 bridge running `stream_server`).

## Supported models

| Model | Status |
|---|---|
| Siemens 7KT1666 (3-phase, 80 A, Modbus RTU) | tested |

Other devices of the series (e.g. 7KT1665 for current transformers or the single-phase 7KT1661) have their own register tables. They can be added as a new file in `lib/models/`, registered in `lib/models/index.js` and in the dropdown in `admin/jsonConfig.json`.

## Notes on the 7KT1666

- **Addresses:** on the bus, the manual's addresses **minus 1** apply (verified by scanning a real device). The model file already contains the bus addresses.
- **Block size:** the device answers at most about 32 registers per request. The adapter respects this.
- **Factory settings:** address 1, 9600 baud, 8N1, Modbus RTU (P8-01 … P8-05).
- **Export:** to also count energy fed back (PV, battery), set **P1-02 = ON** on the meter.

## Data points

| Folder | Content |
|---|---|
| `Spannung` | voltage L1-N, L2-N, L3-N, L1-L2, L2-L3, L3-L1, system averages |
| `Strom` | current L1, L2, L3 |
| `Leistung` | active, reactive and apparent power per phase and total |
| `Leistungsfaktor` | power factor per phase and total |
| `Netz.Frequenz` | grid frequency |
| `Energie` | meter readings active/reactive energy import/export (kWh/kvarh), partial counters |
| `Verbrauch` | import and export today/yesterday, month/previous month, year/previous year; persist across restarts |
| `info` | connection, requests, missing answers, cycle duration |

Data point names are in German.

If an answer is missing, the request is repeated without closing the connection. The adapter only reconnects after 3 unanswered requests in a row.

## Migration from the ioBroker modbus adapter

`tools/migration_von_modbus.js` (ioBroker JavaScript script) copies the InfluxDB settings, keeping the same aliases, from `modbus.0.holdingRegisters.*` to the new data points. Grafana keeps working unchanged. Run it once with `DRY_RUN = true` first.

## Installation

```bash
iob url https://github.com/MMeinhardt1/iobroker.siemens-7KT1666
iob add siemens-7kt1666
```

## Changelog

### 0.1.0 (2026-11-15)

- Initial release: Siemens 7KT1666, consumption per day/month/year

## License

MIT License

Copyright (c) 2026 MMeinhardt1

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
