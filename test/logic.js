'use strict';

const assert = require('node:assert');
const { buildBlocks, decode } = require('../lib/decoder');
const { Statistics } = require('../lib/statistics');
const { MODELS } = require('../lib/models');

describe('Modell 7KT1666', () => {
    const m = MODELS[0];
    it('Busadressen = Handbuch - 1, eindeutige Datenpunkte', () => {
        assert.strictEqual(m.registers.find(r => r.key === 'P_Sys').addr, 57);
        assert.strictEqual(m.registers.find(r => r.key === 'E_Bezug').addr, 6687);
        const s = m.registers.map(r => r.state);
        assert.strictEqual(new Set(s).size, s.length);
    });
    it('Bloecke halten die 32-Register-Grenze ein', () => {
        const b = buildBlocks(m.registers, { maxGap: m.maxGap, maxQty: m.maxBlock, invalid: new Set() });
        b.forEach(x => assert.ok(x.qty <= 32, `${x.start}+${x.qty}`));
        assert.ok(b.length <= 4, `${b.length} Bloecke`);
    });
    it('dekodiert Wirkleistung (S32) und Zaehlerstand (Wh -> kWh)', () => {
        const p = m.registers.find(r => r.key === 'P_Sys');
        assert.strictEqual(decode(p, [0xffff, 0xfc18], 57).value, -10);
        const e = m.registers.find(r => r.key === 'E_Bezug');
        assert.strictEqual(decode(e, [0x0001, 0x86a0], 6687).value, 100);
    });
});

describe('Verbrauchsstatistik', () => {
    function make() {
        const out = {};
        return { s: new Statistics((rel, val) => (out[rel] = val)), out };
    }
    it('heute/gestern, Monat, Jahr', () => {
        const { s, out } = make();
        s.onCounter('import', 1000);
        s.update(new Date(2026, 10, 30, 23, 0).getTime());
        s.onCounter('import', 1012.5);
        s.update(new Date(2026, 10, 30, 23, 59).getTime());
        assert.strictEqual(out['Verbrauch.Bezug_heute'], 12.5);
        s.onCounter('import', 1013);
        s.update(new Date(2026, 11, 1, 0, 1).getTime());
        assert.strictEqual(out['Verbrauch.Bezug_gestern'], 13);
        assert.strictEqual(out['Verbrauch.Bezug_Vormonat'], 13);
        assert.strictEqual(out['Verbrauch.Bezug_heute'], 0);
        assert.strictEqual(out['Verbrauch.Bezug_Jahr'], 13);
    });
    it('ignoriert einen einzelnen kleineren Zaehlerwert, stellt Startwerte wieder her', () => {
        const { s, out } = make();
        const now = new Date(2026, 10, 15, 12).getTime();
        s.restore({ 'Verbrauch.Intern.Bezug_Start_Tag': 990, 'Verbrauch.Intern.Bezug_Zeitraum_Tag': '2026-11-15' });
        s.onCounter('import', 1000);
        s.onCounter('import', 0);
        s.update(now);
        assert.strictEqual(out['Verbrauch.Bezug_heute'], 10);
    });
});
