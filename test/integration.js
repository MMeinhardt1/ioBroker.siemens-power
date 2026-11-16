'use strict';

const path = require('node:path');
const assert = require('node:assert');
const { tests } = require('@iobroker/testing');
const { startSimulator } = require('./simulator');

const PORT = 15022;
const regs = {};
const u32 = (addr, v) => {
    const u = v < 0 ? v + 4294967296 : v;
    regs[addr] = Math.floor(u / 65536);
    regs[addr + 1] = u % 65536;
};
u32(1, 23150); // U L1-N 231,50 V
u32(7, 4670); // I L1 0,467 A
u32(19, 297); // P L1 2,97 W
u32(25, -36600); // Q L1 -366 var
u32(49, 5000); // 50,00 Hz
u32(57, 3341); // P gesamt 33,41 W
u32(6687, 12345678); // 12345,678 kWh
u32(6689, 0);

tests.integration(path.join(__dirname, '..'), {
    allowedExitCodes: [11],
    defineAdditionalTests({ suite }) {
        suite('Abfrage gegen Simulator', getHarness => {
            let sim;
            before(async () => {
                sim = await startSimulator({
                    port: PORT,
                    registers: regs,
                    invalid: new Set(),
                    drop: req => req.fc === 3 && req.qty > 32, // wie das Geraet: grosse Bloecke werden nicht beantwortet
                });
            });
            after(() => sim && sim.server.close());
            it('liest Messwerte und Zaehlerstaende', async function () {
                this.timeout(60_000);
                const harness = getHarness();
                await harness.changeAdapterConfig('siemens-power', {
                    native: {
                        model: 'siemens-7kt1666',
                        connectionType: 'tcprtu',
                        host: ' 127.0.0.1, ', // typo on purpose: must be cleaned up by the adapter
                        port: PORT,
                        unitId: 1,
                        pollInterval: 3,
                        timeout: 500,
                        requestDelay: 10,
                        retries: 1,
                        logRawValues: true,
                        maxBlock: 32,
                    },
                });
                await harness.startAdapterAndWait();
                await new Promise(r => setTimeout(r, 6_000));
                const ns = 'siemens-power.0.';
                const get = async id => (await harness.states.getStateAsync(ns + id))?.val;
                assert.strictEqual(await get('info.connection'), true);
                assert.ok((await get('info.responseMsMax')) >= 0, 'response time state');
                assert.strictEqual(await get('Spannung.L1_N'), 231.5);
                assert.strictEqual(await get('Strom.L1'), 0.467);
                assert.strictEqual(await get('Leistung.Wirk_L1'), 2.97);
                assert.strictEqual(await get('Leistung.Blind_L1'), -366);
                assert.strictEqual(await get('Netz.Frequenz'), 50);
                assert.strictEqual(await get('Leistung.Wirk_Gesamt'), 33.41);
                assert.strictEqual(await get('Energie.Wirk_Bezug'), 12345.678);
                assert.strictEqual(await get('Verbrauch.Bezug_heute'), 0);
                assert.strictEqual(await get('info.failures'), 0);
                assert.ok(
                    sim.log.every(r => r.qty <= 32),
                    'keine Anfrage ueber 32 Register',
                );
            });
        });
    },
});
