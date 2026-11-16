'use strict';

// modbus-serial v8 ships its CommonJS class export without a construct signature in the
// bundled type definitions — restored via the global ModbusRTUConstructor type (lib/adapter-config.d.ts).
const ModbusRTU = /** @type {ModbusRTUConstructor} */ (/** @type {unknown} */ (require('modbus-serial')));

/**
 * Modbus-Verbindung zur Waermepumpe.
 *
 * Unterschiede zur einfachen Variante:
 *  - 'tcprtu' = RTU-Telegramme ueber TCP (z. B. ESP-Bridge mit stream_server), 'tcp' = Modbus TCP, 'serial' = RS-485 direkt
 *  - Alle Anfragen laufen nacheinander mit einer Pause dazwischen (requestDelay)
 *  - Bleibt eine Antwort aus, wird die Anfrage wiederholt, OHNE die Verbindung zu trennen (retries).
 *    Erst nach mehreren aufeinanderfolgenden Fehlschlaegen wird neu verbunden.
 */
class ModbusConnection {
    /**
     * @param {object} config - Verbindungskonfiguration
     * @param {'tcprtu'|'tcp'|'serial'} config.connectionType - Verbindungsart
     * @param {string} [config.host] - IP/Hostname
     * @param {number} [config.port] - TCP-Port
     * @param {string} [config.serialPort] - serielle Schnittstelle
     * @param {number} [config.baudRate] - Baudrate
     * @param {string} [config.parity] - Paritaet
     * @param {number} [config.stopBits] - Stoppbits
     * @param {number} config.unitId - Modbus-Adresse
     * @param {number} config.timeout - Antwort-Timeout (ms)
     * @param {number} config.requestDelay - Pause zwischen zwei Anfragen (ms)
     * @param {number} config.retries - Wiederholungen bei ausbleibender Antwort
     * @param {object} adapter - Adapter (log, setTimeout, clearTimeout)
     */
    constructor(config, adapter) {
        this.config = config;
        this.adapter = adapter;
        this.log = adapter.log;
        this.client = new ModbusRTU();
        this.connected = false;
        this._busy = Promise.resolve();
        this._lastRequestEnd = 0;
        this._lastErrorKey = null;
        /** Statistik fuer info.*/
        this.stats = {
            requests: 0,
            timeouts: 0,
            retriesOk: 0,
            failures: 0,
            consecutiveFailures: 0,
            lastTimeout: 0,
            /** slowest answered request since the last call of takeMaxResponseMs() (ms) */
            maxResponseMs: 0,
        };
    }

    /**
     * Verbindung aufbauen.
     *
     * @returns {Promise<boolean>} true bei Erfolg
     */
    async connect() {
        await this._closeQuietly();
        this.client = new ModbusRTU();
        const c = this.config;
        try {
            const connectTimeout = Math.max(c.timeout || 3000, 3000);
            const connectPromise =
                c.connectionType === 'serial'
                    ? this.client.connectRTUBuffered(c.serialPort, {
                          baudRate: c.baudRate || 9600,
                          dataBits: 8,
                          parity: /** @type {'none' | 'even' | 'odd'} */ (c.parity || 'none'),
                          stopBits: c.stopBits || 1,
                      })
                    : c.connectionType === 'tcp'
                      ? this.client.connectTCP(c.host, { port: c.port || 502 })
                      : this.client.connectTelnet(c.host, { port: c.port || 502 }); // rohe RTU-Telegramme (connectTcpRTUBuffered sendet MBAP!)
            let timer;
            await Promise.race([
                connectPromise,
                new Promise((_, reject) => {
                    timer = this.adapter.setTimeout(
                        () => reject(new Error(`Verbindungsaufbau nach ${connectTimeout} ms abgebrochen`)),
                        connectTimeout,
                    );
                }),
            ]);
            this.adapter.clearTimeout(timer);
            this.client.setTimeout(c.timeout || 3000);
            this.client.setID(c.unitId || 1);
            this.connected = true;
            this.stats.consecutiveFailures = 0;
            if (this._lastErrorKey !== null) {
                this.log.info('Modbus-Verbindung wiederhergestellt');
                this._lastErrorKey = null;
            }
            return true;
        } catch (err) {
            this.connected = false;
            await this._closeQuietly();
            const key = `connect:${err.code || err.message}`;
            if (this._lastErrorKey !== key) {
                this.log.error(`Modbus-Verbindung fehlgeschlagen: ${err.message}`);
                this._lastErrorKey = key;
            } else {
                this.log.debug(`Modbus-Verbindung weiterhin nicht moeglich: ${err.message}`);
            }
            return false;
        }
    }

    /**
     * Verbindung trennen.
     *
     * @returns {Promise<void>}
     */
    async disconnect() {
        this.connected = false;
        await this._closeQuietly();
    }

    /**
     * Socket schliessen, Fehler ignorieren.
     */
    async _closeQuietly() {
        try {
            if (this.client && this.client.isOpen) {
                await new Promise(resolve => this.client.close(() => resolve(undefined)));
            }
        } catch {
            // ignorieren
        }
    }

    /**
     * Fehler einordnen.
     *
     * @param {object} err - Fehler von modbus-serial
     * @returns {'timeout'|'illegal'|'exception'|'connection'} Art
     */
    static classify(err) {
        if (!err) {
            return 'connection';
        }
        if (err.modbusCode === 2) {
            return 'illegal';
        }
        if (err.modbusCode) {
            return 'exception';
        }
        if (err.errno === 'ETIMEDOUT' || /timed out/i.test(err.message || '')) {
            return 'timeout';
        }
        return 'connection';
    }

    /**
     * Anfrage in die Warteschlange stellen (nacheinander, mit Pause und Wiederholung).
     *
     * @template T
     * @param {string} label - Beschreibung fuers Log
     * @param {() => Promise<T>} fn - eigentliche Anfrage
     * @returns {Promise<T>} Ergebnis
     */
    _request(label, fn) {
        const run = async () => {
            if (!this.connected) {
                throw Object.assign(new Error('Nicht verbunden'), { kind: 'connection' });
            }
            const retries = Math.max(0, this.config.retries ?? 1);
            let lastErr;
            for (let attempt = 0; attempt <= retries; attempt++) {
                const wait = this._lastRequestEnd + (this.config.requestDelay || 0) - Date.now();
                if (wait > 0) {
                    await new Promise(r => this.adapter.setTimeout(r, wait));
                }
                this.stats.requests++;
                const t0 = Date.now();
                try {
                    const res = await fn();
                    this._lastRequestEnd = Date.now();
                    const ms = this._lastRequestEnd - t0;
                    if (ms > this.stats.maxResponseMs) {
                        this.stats.maxResponseMs = ms;
                    }
                    this.stats.consecutiveFailures = 0;
                    if (attempt > 0) {
                        this.stats.retriesOk++;
                        this.log.debug(`${label}: answered on attempt ${attempt + 1} after ${ms} ms`);
                    } else {
                        this.log.debug(`${label}: ok in ${ms} ms`);
                    }
                    return res;
                } catch (err) {
                    this._lastRequestEnd = Date.now();
                    const kind = ModbusConnection.classify(err);
                    err.kind = kind;
                    lastErr = err;
                    if (kind === 'timeout') {
                        this.stats.timeouts++;
                        this.stats.lastTimeout = Date.now();
                        this.log.debug(
                            `${label}: no answer after ${Date.now() - t0} ms (attempt ${attempt + 1}/${retries + 1})`,
                        );
                        continue; // wiederholen, Verbindung bleibt bestehen
                    }
                    if (kind === 'illegal' || kind === 'exception') {
                        this.log.debug(
                            `${label}: exception ${err.modbusCode} (${err.message}) after ${Date.now() - t0} ms`,
                        );
                        // Geraet hat geantwortet -> Verbindung ist in Ordnung
                        this.stats.consecutiveFailures = 0;
                        throw err;
                    }
                    // Verbindungsfehler (Socket zu o. ae.)
                    this.connected = false;
                    throw err;
                }
            }
            this.stats.failures++;
            this.stats.consecutiveFailures++;
            throw lastErr;
        };
        const p = this._busy.then(run, run);
        this._busy = p.catch(() => undefined);
        return p;
    }

    /**
     * Return the slowest response time since the last call and reset it.
     *
     * @returns {number} milliseconds (0 = no answered request)
     */
    takeMaxResponseMs() {
        const v = this.stats.maxResponseMs;
        this.stats.maxResponseMs = 0;
        return v;
    }

    /**
     * Holding-Register lesen (FC03).
     *
     * @param {number} address - Startadresse
     * @param {number} qty - Anzahl
     * @returns {Promise<number[]>} Rohwerte
     */
    readHolding(address, qty) {
        return this._request(
            `FC03 ${address}+${qty}`,
            async () => (await this.client.readHoldingRegisters(address, qty)).data,
        );
    }

    /**
     * Ein Register schreiben (FC06).
     *
     * @param {number} address - Adresse
     * @param {number} value - Rohwert (0..65535)
     * @returns {Promise<void>}
     */
    async writeRegister(address, value) {
        await this._request(`FC06 ${address}=${value}`, async () => {
            await this.client.writeRegister(address, value & 0xffff);
        });
    }
}

module.exports = ModbusConnection;
