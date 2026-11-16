'use strict';

/*
 * ioBroker.siemens-power
 * Siemens SENTRON 7KT PAC1600 Energiezaehler ueber Modbus (RTU ueber TCP, Modbus TCP oder RS-485).
 */

const utils = require('@iobroker/adapter-core');
const ModbusConnection = require('./lib/modbus');
const { buildBlocks, decode } = require('./lib/decoder');
const { getModel } = require('./lib/models');
const { Statistics } = require('./lib/statistics');

const STAT_TICK_MS = 60_000;
const RECONNECT_AFTER_FAILURES = 3;

/**
 * Adapter fuer Siemens-7KT-Energiezaehler.
 */
class Siemens7kt extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options] - Adapter-Optionen
     */
    constructor(options) {
        super({ ...options, name: 'siemens-power' });
        /** @type {ModbusConnection | null} */
        this.modbus = null;
        /** @type {import('./lib/models/types').ModelDef | undefined} */
        this.model = undefined;
        /** @type {Statistics | null} */
        this.stats = null;
        this._stopped = false;
        this._pollTimer = null;
        this._tickTimer = null;
        /** @type {Set<number>} */
        this._invalid = new Set();
        this._last = new Map();
        this._objects = new Map();

        this.on('ready', this.onReady.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    /**
     * Adapter gestartet.
     */
    async onReady() {
        const cfg = this.config;
        await this.setStateAsync('info.connection', { val: false, ack: true });
        this.model = getModel(cfg.model);
        if (!this.model) {
            this.log.error(`Unbekanntes Modell "${cfg.model}" – bitte in der Instanz-Konfiguration wählen`);
            return;
        }
        if (cfg.connectionType !== 'serial' && !cfg.host) {
            this.log.error('Keine IP-Adresse konfiguriert');
            return;
        }
        this.log.info(`Modell: ${this.model.label}`);
        this.model.invalidAddresses.forEach(a => this._invalid.add(a));

        await this._createObjects();

        this.stats = new Statistics((rel, val, name, unit, role) => this._put(rel, val, { name, unit, role }));
        await this._restoreStatistics();

        this.modbus = new ModbusConnection(
            {
                connectionType: cfg.connectionType || 'tcprtu',
                host: cfg.host,
                port: Number(cfg.port) || 502,
                serialPort: cfg.serialPort,
                baudRate: Number(cfg.baudRate) || 9600,
                parity: cfg.parity || 'none',
                stopBits: Number(cfg.stopBits) || 1,
                unitId: Number(cfg.unitId) || 1,
                timeout: Number(cfg.timeout) || 3000,
                requestDelay: Math.max(0, Number(cfg.requestDelay) || 0),
                retries: Math.max(0, Math.min(3, Number(cfg.retries ?? 1))),
            },
            this,
        );
        this._tickTimer = this.setInterval(() => this.stats && this.stats.update(), STAT_TICK_MS);
        await this._connectAndPoll();
    }

    /**
     * Datenpunkte fuer alle Register anlegen.
     */
    async _createObjects() {
        for (const reg of this.model.registers) {
            await this._ensureObject(
                reg.state,
                { name: reg.name, type: 'number', role: reg.role, unit: reg.unit, read: true, write: false },
                { register: reg.addr, handbuch: reg.addr + 1 },
            );
        }
        const info = [
            ['info.model', 'Gewähltes Modell', 'string', 'info.name'],
            ['info.requests', 'Modbus-Anfragen seit Start', 'number', 'value'],
            ['info.timeouts', 'Ausgebliebene Antworten seit Start', 'number', 'value'],
            ['info.retriesOk', 'Davon im zweiten Versuch beantwortet', 'number', 'value'],
            ['info.failures', 'Anfragen ohne Antwort (auch nach Wiederholung)', 'number', 'value'],
            ['info.lastTimeout', 'Zeitpunkt der letzten ausgebliebenen Antwort', 'number', 'date'],
            ['info.cycleMs', 'Dauer des letzten Abfragezyklus', 'number', 'value'],
        ];
        for (const [id, name, type, role] of info) {
            await this._ensureObject(id, {
                name,
                type: /** @type {ioBroker.CommonType} */ (type),
                role,
                read: true,
                write: false,
                unit: id === 'info.cycleMs' ? 'ms' : undefined,
            });
        }
        await this.setStateAsync('info.model', { val: this.model.label, ack: true });
    }

    /**
     * Objekt (und fehlende Ordner darueber) anlegen bzw. aktualisieren – je ID nur einmal pro Start.
     *
     * @param {string} id - relative ID
     * @param {Partial<ioBroker.StateCommon>} common - common
     * @param {object} [native] - native
     * @returns {Promise<void>}
     */
    _ensureObject(id, common, native) {
        let p = this._objects.get(id);
        if (!p) {
            p = (async () => {
                const parts = id.split('.');
                for (let i = 1; i < parts.length; i++) {
                    const fid = parts.slice(0, i).join('.');
                    if (fid === 'info' || this._objects.has(`#${fid}`)) {
                        continue;
                    }
                    this._objects.set(`#${fid}`, Promise.resolve());
                    await this.setObjectNotExistsAsync(fid, {
                        type: 'folder',
                        common: { name: parts[i - 1] },
                        native: {},
                    });
                }
                const c = { ...common };
                if (!c.unit) {
                    delete c.unit;
                }
                await this.extendObjectAsync(id, {
                    type: 'state',
                    common: /** @type {ioBroker.StateCommon} */ (c),
                    native: native || {},
                });
            })();
            this._objects.set(id, p);
        }
        return p;
    }

    /**
     * Berechneten Wert schreiben (Objekt bei Bedarf anlegen), nur bei Aenderung.
     *
     * @param {string} rel - relative ID
     * @param {ioBroker.StateValue} val - Wert
     * @param {{ name: string, unit?: string, role?: string }} meta - Beschreibung
     */
    _put(rel, val, meta) {
        if (this._last.get(rel) === val) {
            return;
        }
        this._last.set(rel, val);
        const type = typeof val === 'number' ? 'number' : typeof val === 'boolean' ? 'boolean' : 'string';
        this._ensureObject(rel, {
            name: meta.name,
            type,
            role: meta.role || 'value',
            unit: meta.unit,
            read: true,
            write: false,
        })
            .then(() => this.setStateAsync(rel, { val, ack: true }))
            .catch(e => this.log.warn(`Datenpunkt ${rel}: ${e.message}`));
    }

    /**
     * Wert eines vorhandenen Datenpunkts schreiben, nur bei Aenderung.
     *
     * @param {string} rel - relative ID
     * @param {ioBroker.StateValue} val - Wert
     */
    _set(rel, val) {
        if (this._last.get(rel) === val) {
            return;
        }
        this._last.set(rel, val);
        this.setStateAsync(rel, { val, ack: true }).catch(e => this.log.warn(`Datenpunkt ${rel}: ${e.message}`));
    }

    /**
     * Startwerte der Verbrauchsstatistik aus den eigenen Datenpunkten lesen.
     */
    async _restoreStatistics() {
        try {
            const states = await this.getStatesAsync('Verbrauch.Intern.*');
            /** @type {Record<string, ioBroker.StateValue>} */
            const rel = {};
            for (const [id, st] of Object.entries(states || {})) {
                if (st) {
                    rel[id.slice(this.namespace.length + 1)] = st.val;
                }
            }
            this.stats.restore(rel);
        } catch (e) {
            this.log.warn(`Verbrauchswerte konnten nicht wiederhergestellt werden: ${e.message}`);
        }
    }

    /**
     * Verbinden und Abfrage starten (bei Fehler erneut nach 30 s).
     */
    async _connectAndPoll() {
        if (this._stopped) {
            return;
        }
        const ok = await this.modbus.connect();
        if (this._stopped) {
            return;
        }
        await this.setStateAsync('info.connection', { val: ok, ack: true });
        if (ok) {
            this.log.info(
                `Verbunden mit ${this.config.connectionType === 'serial' ? this.config.serialPort : `${this.config.host}:${this.config.port}`}`,
            );
            this._poll();
        } else {
            this._pollTimer = this.setTimeout(() => this._connectAndPoll(), 30_000);
        }
    }

    /**
     * Ein Abfragezyklus.
     */
    async _poll() {
        if (this._stopped) {
            return;
        }
        const pollMs = Math.max(2, Number(this.config.pollInterval) || 10) * 1000;
        const t0 = Date.now();
        const blocks = buildBlocks(this.model.registers, {
            maxGap: this.model.maxGap,
            maxQty: Math.max(2, Math.min(this.model.maxBlock, Number(this.config.maxBlock) || this.model.maxBlock)),
            invalid: this._invalid,
        });
        for (const b of blocks) {
            if (this._stopped) {
                return;
            }
            await this._readBlock(b);
            if (!this.modbus.connected || this.modbus.stats.consecutiveFailures >= RECONNECT_AFTER_FAILURES) {
                break;
            }
        }
        this.stats.update();
        const s = this.modbus.stats;
        this._set('info.requests', s.requests);
        this._set('info.timeouts', s.timeouts);
        this._set('info.retriesOk', s.retriesOk);
        this._set('info.failures', s.failures);
        if (s.lastTimeout) {
            this._set('info.lastTimeout', s.lastTimeout);
        }
        this._set('info.cycleMs', Date.now() - t0);

        if (!this.modbus.connected || this.modbus.stats.consecutiveFailures >= RECONNECT_AFTER_FAILURES) {
            this.log.warn(`Zähler antwortet nicht (${s.consecutiveFailures} Anfragen ohne Antwort) – verbinde neu`);
            await this.setStateAsync('info.connection', { val: false, ack: true });
            await this.modbus.disconnect();
            this._pollTimer = this.setTimeout(() => this._connectAndPoll(), 5_000);
            return;
        }
        this._pollTimer = this.setTimeout(() => this._poll(), Math.max(500, pollMs - (Date.now() - t0)));
    }

    /**
     * Einen Block lesen; bei "Illegal Data Address" einzeln lesen und abgelehnte Adressen merken.
     *
     * @param {{ start: number, qty: number, regs: import('./lib/models/types').RegisterDef[] }} b - Block
     * @returns {Promise<boolean>} true, wenn alle Register gelesen wurden
     */
    async _readBlock(b) {
        try {
            const data = await this.modbus.readHolding(b.start, b.qty);
            for (const reg of b.regs) {
                const d = decode(reg, data, b.start);
                if (d) {
                    this._set(reg.state, d.value);
                    if (reg.counter) {
                        this.stats.onCounter(reg.counter, d.value);
                    }
                }
            }
            return true;
        } catch (err) {
            if (err.kind === 'illegal' && b.regs.length > 1) {
                this.log.info(`Block ${b.start}-${b.start + b.qty - 1} abgelehnt – lese einzeln`);
                let all = true;
                for (const reg of b.regs) {
                    all = (await this._readBlock({ start: reg.addr, qty: 2, regs: [reg] })) && all;
                }
                return all;
            }
            if (err.kind === 'illegal') {
                this._invalid.add(b.regs[0].addr);
                this.log.warn(
                    `Register ${b.regs[0].addr} (${b.regs[0].key}) wird vom Zähler abgelehnt und nicht mehr gelesen`,
                );
                return false;
            }
            if (err.kind === 'timeout') {
                this.log.debug(`Block ${b.start}-${b.start + b.qty - 1}: keine Antwort`);
            } else {
                this.log.warn(`Block ${b.start}-${b.start + b.qty - 1}: ${err.message}`);
            }
            return false;
        }
    }

    /**
     * @param {() => void} callback - Rueckruf
     */
    async onUnload(callback) {
        this._stopped = true;
        try {
            if (this._pollTimer) {
                this.clearTimeout(this._pollTimer);
            }
            if (this._tickTimer) {
                this.clearInterval(this._tickTimer);
            }
            if (this.modbus) {
                await this.modbus.disconnect();
            }
            await this.setStateAsync('info.connection', { val: false, ack: true });
        } catch {
            // ignorieren
        }
        callback();
    }
}

if (require.main !== module) {
    module.exports = options => new Siemens7kt(options);
} else {
    new Siemens7kt();
}
