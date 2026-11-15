'use strict';

/**
 * Liste aller unterstuetzten Zaehler. Ein neues Modell (z. B. 7KT1665 oder einphasige 7KT1661):
 *  1. Datei unter lib/models/ anlegen (Vorlage: siemens-7kt1666.js).
 *  2. Hier in MODELS eintragen.
 *  3. In admin/jsonConfig.json beim Dropdown "model" ergaenzen.
 */

/** @type {import('./types').ModelDef[]} */
const MODELS = [require('./siemens-7kt1666')];

/**
 * Modell anhand der ID holen.
 *
 * @param {string} id - Modell-ID aus der Konfiguration
 * @returns {import('./types').ModelDef | undefined} Modell
 */
function getModel(id) {
    return MODELS.find(m => m.id === id);
}

module.exports = { MODELS, getModel };
