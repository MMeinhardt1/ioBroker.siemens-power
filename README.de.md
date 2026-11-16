![Logo](admin/siemens-power.png)

# ioBroker.siemens-power

**[English version](README.md)**

Adapter für Siemens-SENTRON-Energiezähler der Reihe 7KT PAC1600 über Modbus: direkt per RS-485, per Modbus TCP oder als RTU-Telegramme über TCP (z. B. ESP32-Bridge mit `stream_server`).

## Unterstützte Modelle

| Modell                                       | Status   |
| -------------------------------------------- | -------- |
| Siemens 7KT1666 (3-phasig, 80 A, Modbus RTU) | getestet |

Weitere Geräte der Reihe (z. B. 7KT1665 mit Wandleranschluss oder einphasige 7KT1661) haben eigene Registertabellen. Sie lassen sich als neue Datei unter `lib/models/` ergänzen, eingetragen in `lib/models/index.js` und im Dropdown in `admin/jsonConfig.json`.

## Hinweise zum 7KT1666

- **Adressen:** Auf dem Bus gelten die Handbuchadressen **minus 1**. Das ist per Scan bestätigt, die Modelldatei enthält bereits die Busadressen.
- **Blockgröße:** Das Gerät beantwortet höchstens etwa 32 Register pro Anfrage. Der Adapter hält das ein.
- **Werkseinstellungen:** Adresse 1, 9600 Baud, 8N1, Modbus RTU (P8-01 … P8-05).
- **Rücklieferung:** Soll auch Rücklieferung gezählt werden (PV, Akku), muss am Zähler **P1-02 = ON** stehen.

## Datenpunkte

| Ordner            | Inhalt                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `Spannung`        | L1-N, L2-N, L3-N, L1-L2, L2-L3, L3-L1, Systemmittelwerte                                  |
| `Strom`           | L1, L2, L3                                                                                |
| `Leistung`        | Wirk-, Blind- und Scheinleistung je Phase und gesamt                                      |
| `Leistungsfaktor` | je Phase und gesamt                                                                       |
| `Netz.Frequenz`   | Netzfrequenz                                                                              |
| `Energie`         | Zählerstände Wirk- und Blindenergie Bezug/Lieferung (kWh/kvarh), Teilzähler               |
| `Verbrauch`       | Bezug und Lieferung heute/gestern, Monat/Vormonat, Jahr/Vorjahr; übersteht einen Neustart |
| `info`            | Verbindung, Anfragen, ausgebliebene Antworten, Zyklusdauer                                |

Bleibt eine Antwort aus, wird die Anfrage wiederholt, ohne die Verbindung zu trennen. Neu verbunden wird erst nach 3 Anfragen in Folge ohne Antwort.

## Umzug vom Modbus-Adapter

Das Skript `tools/migration_von_modbus.js` überträgt die InfluxDB-Einstellungen mit denselben Aliasen von `modbus.0.holdingRegisters.*` auf die neuen Datenpunkte. Grafana läuft dadurch unverändert weiter.

## Fehlersuche

Mit der Logstufe **debug** der Instanz siehst du:

- jede Modbus-Anfrage mit Antwortzeit (`FC03 104+16: ok in 87 ms`), ausgebliebene Antworten und Wiederholungen,
- eine Zusammenfassung je Abfragezyklus (`Cycle: 22/22 blocks ok, 5 values changed, 1450 ms, slowest answer 120 ms`),
- mit der Option _Rohwerte der Register ins Log schreiben_ zusätzlich jeden empfangenen Block als Rohzahlen.

Die Datenpunkte unter `info.*` (Anfragen, Timeouts, Wiederholungen, Zyklusdauer, längste Antwortzeit) gibt es immer.

## Installation

```bash
iob url https://github.com/MMeinhardt1/ioBroker.siemens-power
iob add siemens-power
```

## Changelog

### 0.2.0 (2026-11-16)

- Adapter von `siemens-7kt1666` in `siemens-power` umbenannt (Repository `ioBroker.siemens-power`); Datenpunkte heißen jetzt `siemens-power.0.*`
- Ausführliches Debug-Log: Antwortzeit jeder Anfrage, eine Zusammenfassung je Abfragezyklus, optional die Rohwerte der Register (neue Option _Rohwerte der Register ins Log schreiben_)
- Neuer Datenpunkt `info.responseMsMax` (längste Antwortzeit im letzten Abfragezyklus)
- IP-Adresse / Hostname wird in der Admin-Oberfläche geprüft (ungültig = nicht speicherbar) und beim Start bereinigt (z. B. ein Komma am Ende)
- Neue Instanzen werden deaktiviert angelegt und starten erst nach der Konfiguration

### 0.1.0 (2026-11-15)

- Erstveröffentlichung: Siemens 7KT1666, Verbrauch je Tag/Monat/Jahr

## License

MIT License, Copyright (c) 2026 MMeinhardt1
