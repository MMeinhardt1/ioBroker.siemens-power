'use strict';

/**
 * Verbrauchswerte aus den Zaehlerstaenden: heute/gestern, Monat/Vormonat, Jahr/Vorjahr
 * fuer Bezug und Lieferung. Startzaehlerstaende werden in Datenpunkten gespeichert, ein Neustart
 * des Adapters unterbricht die Werte daher nicht.
 *
 * Die Klasse kennt kein ioBroker: Ausgaben laufen ueber put(). So ist sie testbar.
 */

const PERIODS = [
    { id: 'Tag', cur: 'heute', prev: 'gestern', key: d => ymd(d), txt: ['heute', 'gestern'] },
    {
        id: 'Monat',
        cur: 'Monat',
        prev: 'Vormonat',
        key: d => ymd(d).slice(0, 7),
        txt: ['im laufenden Monat', 'im Vormonat'],
    },
    {
        id: 'Jahr',
        cur: 'Jahr',
        prev: 'Vorjahr',
        key: d => ymd(d).slice(0, 4),
        txt: ['im laufenden Jahr', 'im Vorjahr'],
    },
];
const KINDS = [
    { id: 'import', name: 'Bezug' },
    { id: 'export', name: 'Lieferung' },
];

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const r3 = x => Math.round(x * 1000) / 1000;

/**
 * Verbrauch je Tag, Monat und Jahr aus den Zaehlerstaenden.
 */
class Statistics {
    /**
     * @param {(rel: string, val: any, name: string, unit?: string, role?: string) => void} put - Wert ausgeben
     */
    constructor(put) {
        this.put = put;
        /** aktuelle Zaehlerstaende */
        this.counter = {};
        /** ein kleinerer Wert wird erst beim zweiten Mal in Folge akzeptiert */
        this.pending = {};
        /** Start je Art und Zeitraum: { import: { Tag: { key, start } } } */
        this.start = { import: {}, export: {} };
    }

    /**
     * Gespeicherte Startwerte uebernehmen.
     *
     * @param {Record<string, any>} st - eigene Datenpunkte (relative ID -> Wert)
     */
    restore(st) {
        for (const k of KINDS) {
            for (const p of PERIODS) {
                const start = st[`Verbrauch.Intern.${k.name}_Start_${p.id}`];
                const key = st[`Verbrauch.Intern.${k.name}_Zeitraum_${p.id}`];
                if (typeof start === 'number' && typeof key === 'string' && key) {
                    this.start[k.id][p.id] = { key, start };
                }
            }
        }
    }

    /**
     * Zaehlerstand uebernehmen.
     *
     * @param {'import'|'export'} kind - Bezug oder Lieferung
     * @param {number} kwh - Zaehlerstand
     */
    onCounter(kind, kwh) {
        const prev = this.counter[kind];
        if (prev == null || kwh >= prev) {
            this.counter[kind] = kwh;
            delete this.pending[kind];
            return;
        }
        if (this.pending[kind] === kwh) {
            this.counter[kind] = kwh;
            delete this.pending[kind];
        } else {
            this.pending[kind] = kwh;
        }
    }

    /**
     * Verbrauchswerte berechnen.
     *
     * @param {number} [nowMs] - Zeitpunkt (fuer Tests)
     */
    update(nowMs) {
        const now = new Date(nowMs ?? Date.now());
        for (const k of KINDS) {
            const c = this.counter[k.id];
            if (c == null) {
                continue;
            }
            for (const p of PERIODS) {
                const key = p.key(now);
                const s = this.start[k.id][p.id];
                const base = `Verbrauch.${k.name}_`;
                if (!s || s.key !== key || c < s.start) {
                    if (s && s.key !== key && c >= s.start) {
                        this.put(`${base}${p.prev}`, r3(c - s.start), `${k.name} ${p.txt[1]}`, 'kWh', 'value.energy');
                    }
                    this.start[k.id][p.id] = { key, start: c };
                    this.put(
                        `Verbrauch.Intern.${k.name}_Start_${p.id}`,
                        c,
                        `Zählerstand ${k.name} zu Beginn des Zeitraums (${p.id})`,
                        'kWh',
                        'value.energy',
                    );
                    this.put(
                        `Verbrauch.Intern.${k.name}_Zeitraum_${p.id}`,
                        key,
                        `Zeitraum der Startwerte (${p.id})`,
                        '',
                        'text',
                    );
                }
                this.put(
                    `${base}${p.cur}`,
                    r3(c - this.start[k.id][p.id].start),
                    `${k.name} ${p.txt[0]}`,
                    'kWh',
                    'value.energy',
                );
            }
        }
    }
}

module.exports = { Statistics };
