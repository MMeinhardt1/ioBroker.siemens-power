// Umzug vom Modbus-Adapter (modbus.0, Siemens 7KT1666) auf den Adapter siemens-power.0
// Typ: JavaScript (ioBroker-Skript). Voraussetzung: in der javascript-Instanz "Kommando setObject erlauben".
//
// Ablauf:
//  1. siemens-power.0 einmal starten (legt die Datenpunkte an), dann modbus.0 stoppen.
//     Die Bridge bedient je Port nur einen Client – beide gleichzeitig auf Port 5022 geht nicht.
//  2. Dieses Skript mit DRY_RUN = true starten, Log pruefen, dann mit DRY_RUN = false erneut starten.
//  3. In midea-heatpump.0 als Stromzaehler "siemens-power.0.Energie.Wirk_Bezug" eintragen.
//
// Was das Skript macht: Fuer jedes Register unter modbus.0.holdingRegisters wird anhand der Adresse der passende
// Datenpunkt im neuen Adapter gesucht. Die InfluxDB-Einstellung (inkl. Alias, z. B. SZ_Wirkenergie_Bezug) wird
// uebernommen und beim alten Datenpunkt deaktiviert. Gleicher Alias = Grafana laeuft unveraendert weiter.

const DRY_RUN = true;
const ALT = 'modbus.0.holdingRegisters.';
const NEU = 'siemens-power.0.';
const INFLUX = 'influxdb.0';

// Busadresse -> neuer Datenpunkt
const ZIEL = {
    1: 'Spannung.L1_N', // U_L1N
    3: 'Spannung.L2_N', // U_L2N
    5: 'Spannung.L3_N', // U_L3N
    7: 'Strom.L1', // I_L1
    9: 'Strom.L2', // I_L2
    11: 'Strom.L3', // I_L3
    13: 'Spannung.L1_L2', // U_L1L2
    15: 'Spannung.L2_L3', // U_L2L3
    17: 'Spannung.L3_L1', // U_L3L1
    19: 'Leistung.Wirk_L1', // P_L1
    21: 'Leistung.Wirk_L2', // P_L2
    23: 'Leistung.Wirk_L3', // P_L3
    25: 'Leistung.Blind_L1', // Q_L1
    27: 'Leistung.Blind_L2', // Q_L2
    29: 'Leistung.Blind_L3', // Q_L3
    31: 'Leistung.Schein_L1', // S_L1
    33: 'Leistung.Schein_L2', // S_L2
    35: 'Leistung.Schein_L3', // S_L3
    37: 'Leistungsfaktor.L1', // PF_L1
    39: 'Leistungsfaktor.L2', // PF_L2
    41: 'Leistungsfaktor.L3', // PF_L3
    49: 'Netz.Frequenz', // Frequenz
    51: 'Spannung.LN_System', // U_LN_Sys
    53: 'Spannung.LL_System', // U_LL_Sys
    57: 'Leistung.Wirk_Gesamt', // P_Sys
    59: 'Leistung.Blind_Gesamt', // Q_Sys
    61: 'Leistung.Schein_Gesamt', // S_Sys
    63: 'Leistungsfaktor.Gesamt', // PF_Sys
    6687: 'Energie.Wirk_Bezug', // E_Bezug
    6689: 'Energie.Wirk_Lieferung', // E_Lieferung
    6691: 'Energie.Blind_Bezug', // Eq_Bezug
    6693: 'Energie.Blind_Lieferung', // Eq_Lieferung
    6697: 'Energie.Teil.Wirk_Bezug', // E_Teil_Bezug
    6699: 'Energie.Teil.Wirk_Lieferung', // E_Teil_Lieferung
    6701: 'Energie.Teil.Blind_Bezug', // Eq_Teil_Bezug
    6703: 'Energie.Teil.Blind_Lieferung', // Eq_Teil_Lieferung
};

(async () => {
    const ids = [];
    $(`state[id=${ALT}*]`).each(id => ids.push(id));
    let uebernommen = 0;
    for (const altId of ids) {
        const m = altId.slice(ALT.length).match(/^(\d+)_/);
        const ziel = m && ZIEL[Number(m[1])];
        if (!ziel) {
            continue;
        }
        const altObj = await getObjectAsync(altId);
        const cust = altObj && altObj.common && altObj.common.custom && altObj.common.custom[INFLUX];
        if (!cust || !cust.enabled) {
            continue;
        }
        const neuId = NEU + ziel;
        if (!(await getObjectAsync(neuId))) {
            log(`${neuId} fehlt – Adapter einmal starten`, 'warn');
            continue;
        }
        log(`${DRY_RUN ? '[DRY] ' : ''}${altId} -> ${neuId} (Alias ${cust.aliasId || '-'})`);
        if (!DRY_RUN) {
            await extendObjectAsync(neuId, { common: { custom: { [INFLUX]: cust } } });
            await extendObjectAsync(altId, { common: { custom: { [INFLUX]: { ...cust, enabled: false } } } });
        }
        uebernommen++;
    }
    log(`${DRY_RUN ? '[DRY] ' : ''}${uebernommen} Influx-Einstellungen übernommen`);
    stopScript();
})();
