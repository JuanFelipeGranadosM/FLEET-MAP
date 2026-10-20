export type StateId = 'op' | 'idle' | 'standby' | 'down' | 'off';
export type LatLon = [number, number];

export interface EquipmentType { id: string; name: string; rate: number; fuel: number; models: string[] }
export interface Client { id: string; name: string }
export interface Site {
  id: string; name: string; short: string; client: string; lat: number; lon: number; radius: number; sunday: boolean;
  /** eje del corredor [lat, lon]; provisional = coordenadas aún no confirmadas */
  path?: LatLon[]; provisional?: boolean;
}
export interface StateDef { id: StateId; name: string; color: string }

export interface Catalog {
  currency: string; today: string; historyDays: number; standbyFactor: number;
  bbox: { latMin: number; latMax: number; lonMin: number; lonMax: number };
  types: EquipmentType[]; clients: Client[]; sites: Site[]; roads: LatLon[][]; states: StateDef[];
}

export interface Equipment {
  id: string; pin: string; oem: string; model: string; typeId: string; siteId: string; clientId: string;
  lat: number; lon: number; rate: number; standbyFactor: number; year: number; hourMeter: number; route: LatLon[] | null;
  // libro de arranque diario
  description?: string | null; plate?: string | null; uf?: string | null; manager?: string | null; icon?: string | null;
}

export interface LiveStatus { id: string; state: StateId; lat: number; lon: number; ts: number; fault?: string | null; prev?: StateId | null }

/** Series en columnas; índice = equipo * days.length + día */
export interface DailyMetrics {
  days: string[]; equipmentIds: string[];
  work: number[]; idle: number[]; standby: number[]; down: number[]; fuel: number[];
}

export interface BillingLine { concept: string; hours: number; rate: number; factor: number; amount: number }
export interface Billing {
  equipmentId: string; dateFrom: string; dateTo: string; currency: string;
  lines: BillingLine[]; total: number; potential: number; notBilled: number; utilization: number;
}
