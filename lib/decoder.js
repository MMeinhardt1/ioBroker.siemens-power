'use strict';

/**
 * Hilfsfunktionen: Lesebloecke bilden und Registerwerte dekodieren.
 */

/**
 * Anzahl 16-Bit-Woerter eines Registertyps.
 *
 * @param {import('./models/types').RegType} type - Typ
 * @returns {number} Woerter
 */
function words(type) {
    return type === 'U32' || type === 'S32' ? 2 : 1;
}

/**
 * Register zu zusammenhaengenden Lesebloecken zusammenfassen.
 * Ein Block ueberbrueckt Luecken bis maxGap, aber nie eine als ungueltig bekannte Adresse.
 *
 * @param {import('./models/types').RegisterDef[]} registers - zu lesende Register
 * @param {object} opt - Optionen
 * @param {number} opt.maxGap - groesste Luecke, die mitgelesen wird
 * @param {number} opt.maxQty - groesste Blocklaenge
 * @param {Set<number>} opt.invalid - ungueltige Adressen
 * @returns {{ start: number, qty: number, regs: import('./models/types').RegisterDef[] }[]} Bloecke
 */
function buildBlocks(registers, opt) {
    const sorted = [...registers].filter(r => !opt.invalid.has(r.addr)).sort((a, b) => a.addr - b.addr);
    const blocks = [];
    let cur = null;
    for (const r of sorted) {
        const n = words(r.type);
        if (cur) {
            const end = cur.start + cur.qty; // erste Adresse nach dem Block
            const gap = r.addr - end;
            let gapOk = gap >= 0 && gap <= opt.maxGap && r.addr + n - cur.start <= opt.maxQty;
            for (let a = end; gapOk && a < r.addr; a++) {
                if (opt.invalid.has(a)) {
                    gapOk = false;
                }
            }
            if (gapOk) {
                cur.qty = r.addr + n - cur.start;
                cur.regs.push(r);
                continue;
            }
            blocks.push(cur);
        }
        cur = { start: r.addr, qty: n, regs: [r] };
    }
    if (cur) {
        blocks.push(cur);
    }
    return blocks;
}

/**
 * Rohwert(e) eines Registers aus den gelesenen Daten holen.
 *
 * @param {import('./models/types').RegisterDef} reg - Register
 * @param {number[]} data - gelesene Woerter des Blocks
 * @param {number} start - Startadresse des Blocks
 * @returns {{ raw: number, value: number } | null} raw = ganzzahliger Rohwert (ohne Vorzeichen fuer U16), value = skaliert
 */
function decode(reg, data, start) {
    const i = reg.addr - start;
    if (i < 0 || i + words(reg.type) > data.length) {
        return null;
    }
    let raw;
    switch (reg.type) {
        case 'S16':
            raw = data[i] > 32767 ? data[i] - 65536 : data[i];
            break;
        case 'U32':
            raw = data[i] * 65536 + data[i + 1];
            break;
        case 'S32': {
            const u = data[i] * 65536 + data[i + 1];
            raw = u > 2147483647 ? u - 4294967296 : u;
            break;
        }
        default:
            raw = data[i];
    }
    const f = reg.factor ?? 1;
    const value = f === 1 ? raw : Math.round(raw * f * 1e6) / 1e6;
    return { raw, value };
}

/**
 * Wert in Rohwert fuer FC06 umrechnen.
 *
 * @param {import('./models/types').RegisterDef} reg - Register
 * @param {number} value - skalierter Wert
 * @returns {number} 16-Bit-Rohwert
 */
function encode(reg, value) {
    const f = reg.factor ?? 1;
    const raw = Math.round(value / f);
    return raw < 0 ? (raw + 65536) & 0xffff : raw & 0xffff;
}

module.exports = { words, buildBlocks, decode, encode };
