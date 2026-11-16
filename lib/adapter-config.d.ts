// Erweitert den AdapterConfig-Typ um die native-Konfiguration aus io-package.json (nur fuer den Typecheck).

declare global {
    /** modbus-serial v8 liefert keinen Konstruktor-Typ fuer den CommonJS-Export */
    type ModbusRTUConstructor = new () => import('modbus-serial');

    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace ioBroker {
        interface AdapterConfig {
            model: string;
            connectionType: 'tcprtu' | 'tcp' | 'serial';
            host: string;
            port: number;
            unitId: number;
            serialPort: string;
            baudRate: number;
            parity: string;
            stopBits: number;
            pollInterval: number;
            timeout: number;
            requestDelay: number;
            retries: number;
            maxBlock: number;
            logRawValues: boolean;
        }
    }
}

export {};
