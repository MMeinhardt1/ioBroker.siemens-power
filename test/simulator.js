'use strict';

/**
 * Kleiner Modbus-Simulator fuer Tests: RTU-Telegramme ueber TCP (wie die ESP-Bridge mit stream_server).
 * Unterstuetzt FC03 und FC06, lehnt ungueltige Adressen mit Exception 2 ab und kann einzelne Antworten auslassen.
 */

const net = require('node:net');

/**
 * @param {Buffer} buf - Daten
 * @returns {number} CRC16 (Modbus)
 */
function crc16(buf) {
    let crc = 0xffff;
    for (const b of buf) {
        crc ^= b;
        for (let k = 0; k < 8; k++) {
            crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
        }
    }
    return crc;
}

/**
 * @param {Buffer} body - Telegramm ohne CRC
 * @returns {Buffer} Telegramm mit CRC
 */
function withCrc(body) {
    const c = crc16(body);
    return Buffer.concat([body, Buffer.from([c & 0xff, c >> 8])]);
}

/**
 * Simulator starten.
 *
 * @param {object} opt - Optionen
 * @param {number} opt.port - TCP-Port
 * @param {Record<number, number>} opt.registers - Registerwerte (Rohwerte)
 * @param {Set<number>} opt.invalid - ungueltige Adressen
 * @param {(req: { fc: number, addr: number, qty: number }) => boolean} [opt.drop] - true = keine Antwort
 * @returns {Promise<{ server: net.Server, registers: Record<number, number>, log: object[] }>} Simulator
 */
function startSimulator(opt) {
    const log = [];
    const server = net.createServer(sock => {
        let buf = Buffer.alloc(0);
        sock.on('data', d => {
            buf = Buffer.concat([buf, d]);
            while (buf.length >= 8) {
                const frame = buf.subarray(0, 8);
                buf = buf.subarray(8);
                if (crc16(frame.subarray(0, 6)) !== frame.readUInt16LE(6)) {
                    continue;
                }
                const unit = frame[0];
                const fc = frame[1];
                const addr = frame.readUInt16BE(2);
                const qtyOrVal = frame.readUInt16BE(4);
                const req = { fc, addr, qty: fc === 3 ? qtyOrVal : 1 };
                log.push(req);
                if (opt.drop && opt.drop(req)) {
                    continue;
                }
                if (fc === 3) {
                    let bad = false;
                    for (let a = addr; a < addr + qtyOrVal; a++) {
                        if (opt.invalid.has(a)) {
                            bad = true;
                        }
                    }
                    if (bad) {
                        sock.write(withCrc(Buffer.from([unit, 0x83, 0x02])));
                        continue;
                    }
                    const body = Buffer.alloc(3 + qtyOrVal * 2);
                    body[0] = unit;
                    body[1] = 3;
                    body[2] = qtyOrVal * 2;
                    for (let i = 0; i < qtyOrVal; i++) {
                        body.writeUInt16BE((opt.registers[addr + i] ?? 0) & 0xffff, 3 + i * 2);
                    }
                    sock.write(withCrc(body));
                } else if (fc === 6) {
                    opt.registers[addr] = qtyOrVal;
                    sock.write(frame);
                } else {
                    sock.write(withCrc(Buffer.from([unit, fc | 0x80, 0x01])));
                }
            }
        });
    });
    return new Promise(resolve =>
        server.listen(opt.port, '127.0.0.1', () => resolve({ server, registers: opt.registers, log })),
    );
}

module.exports = { startSimulator };
