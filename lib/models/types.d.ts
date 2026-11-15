// Typen fuer die Modell-Definitionen (nur fuer den Typecheck, keine Laufzeitwirkung)

export type RegType = 'U16' | 'S16' | 'U32' | 'S32';

export interface RegisterDef {
    /** Protokolladresse (0-basiert, so wie sie auf dem Bus gesendet wird) */
    addr: number;
    key: string;
    type: RegType;
    factor?: number;
    unit?: string;
    /** Ziel-Datenpunkt (relativ zur Instanz) */
    state: string;
    name: string;
    role: string;
    /** Zaehlerstand (fuer die Tages-/Monats-/Jahreswerte) */
    counter?: 'import' | 'export';
    group?: 'live' | 'settings';
    desc?: string;
}

export interface ModelDef {
    id: string;
    label: string;
    manufacturer: string;
    registers: RegisterDef[];
    /** Adressen, die das Geraet ablehnt */
    invalidAddresses: number[];
    /** groesste Anzahl Register je Anfrage, die das Geraet verarbeitet */
    maxBlock: number;
    /** Luecken bis zu dieser Groesse duerfen mitgelesen werden (Geraet liefert dort 0) */
    maxGap: number;
}
