// Copia del catálogo de apps/api/app/domain/catalog.py para el modo demo (sin servidor).
import type { Catalog } from '../api/types';

export const MIX: Record<string, Record<string, number>> = {
  S1: { EXC: 4, VOL: 8, MOT: 3, COM: 3, BUL: 2, CAR: 1 },
  S2: { EXC: 3, CAR: 4, VOL: 6 },
  S3: { EXC: 5, VOL: 7, BUL: 3, GRU: 3, COM: 2 },
  S4: { RET: 5, EXC: 2, COM: 2, GRU: 1, CAR: 2 },
  S5: { MOT: 3, COM: 3, VOL: 4, EXC: 2, RET: 2 },
  S6: { EXC: 4, VOL: 9, CAR: 3, BUL: 2 },
};

export const CATALOG: Catalog = {
  currency: 'USD', today: '2026-10-20', historyDays: 180, standbyFactor: 0.5,
  bbox: { latMin: 5.0, latMax: 6.6, lonMin: -76.0, lonMax: -74.4 },
  types: [
    { id: 'EXC', name: 'Excavadora', rate: 95, fuel: 18, models: ['CAT 336', 'Komatsu PC360LC-11', 'Volvo EC380E', 'Hitachi ZX350LC'] },
    { id: 'VOL', name: 'Volqueta', rate: 70, fuel: 22, models: ['Volvo A40G', 'CAT 745', 'Komatsu HM400-5'] },
    { id: 'CAR', name: 'Cargador', rate: 85, fuel: 16, models: ['CAT 966 GC', 'Volvo L150H', 'Komatsu WA470-8'] },
    { id: 'BUL', name: 'Bulldozer', rate: 120, fuel: 28, models: ['CAT D8', 'Komatsu D155AX-8', 'Liebherr PR 756'] },
    { id: 'MOT', name: 'Motoniveladora', rate: 90, fuel: 15, models: ['CAT 140 GC', 'John Deere 772G', 'Komatsu GD655-7'] },
    { id: 'RET', name: 'Retroexcavadora', rate: 55, fuel: 8, models: ['CAT 420', 'John Deere 310L', 'Case 580N'] },
    { id: 'COM', name: 'Compactador', rate: 60, fuel: 10, models: ['CAT CS56B', 'Dynapac CA2500', 'Bomag BW 213'] },
    { id: 'GRU', name: 'Grúa', rate: 150, fuel: 20, models: ['Liebherr LTM 1090', 'Grove GMK5150L'] },
  ],
  clients: [
    { id: 'C1', name: 'Concesión Vial Andina' }, { id: 'C2', name: 'Agregados del Valle' }, { id: 'C3', name: 'Hidroeléctrica Sur' },
    { id: 'C4', name: 'Constructora Meridiano' }, { id: 'C5', name: 'Minera Cordillera' },
  ],
  sites: [
    { id: 'S1', name: 'Troncal Norte · Tramo 2', short: 'Troncal Norte', client: 'C1', lat: 6.35, lon: -75.55, radius: 0.05, sunday: false },
    { id: 'S2', name: 'Cantera La Esperanza', short: 'La Esperanza', client: 'C2', lat: 6.05, lon: -75.2, radius: 0.035, sunday: true },
    { id: 'S3', name: 'Presa Río Claro', short: 'Río Claro', client: 'C3', lat: 5.45, lon: -74.85, radius: 0.05, sunday: true },
    { id: 'S4', name: 'Parque Industrial Occidente', short: 'P.I. Occidente', client: 'C4', lat: 5.7, lon: -75.7, radius: 0.03, sunday: false },
    { id: 'S5', name: 'Variante San Isidro', short: 'San Isidro', client: 'C1', lat: 5.95, lon: -75.85, radius: 0.04, sunday: false },
    { id: 'S6', name: 'Mina El Porvenir', short: 'El Porvenir', client: 'C5', lat: 5.2, lon: -75.3, radius: 0.045, sunday: true },
  ],
  // En el modo demo las rutas de acarreo salen de vías reales (ver mockApi.ts).
  roads: [],
  states: [
    { id: 'op', name: 'Operando', color: '#38e0a0' }, { id: 'idle', name: 'Ralentí', color: '#ff9b5c' },
    { id: 'standby', name: 'Standby', color: '#6cb6ff' }, { id: 'down', name: 'Avería', color: '#ff5d73' },
    { id: 'off', name: 'Sin señal', color: '#7d8aa3' },
  ],
};
