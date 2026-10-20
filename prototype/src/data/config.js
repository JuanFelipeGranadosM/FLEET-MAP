/* FleetMap · configuración de dominio
 * Catálogos de tipos de equipo, obras y clientes. En producción esto vendría
 * del ERP / maestro de activos; la telemetría (AEMP) sólo aporta PIN, OEM y modelo.
 */
window.FM = window.FM || {};

FM.config = {
  currency: 'USD',
  locale: 'es-CO',
  // Ventana de datos disponible para la maqueta (días hacia atrás desde "hoy").
  historyDays: 180,
  today: '2026-10-20',
  // Factor de facturación del standby sobre la tarifa hora (contrato tipo).
  defaultStandbyFactor: 0.5,

  // Bounding box geográfico del área de operación (lat/lon WGS84).
  bbox: { latMin: 5.0, latMax: 6.6, lonMin: -76.0, lonMax: -74.4 },

  types: [
    { id: 'EXC', name: 'Excavadora',      rate: 95,  fuel: 18, models: ['CAT 336', 'Komatsu PC360LC-11', 'Volvo EC380E', 'Hitachi ZX350LC'] },
    { id: 'VOL', name: 'Volqueta',        rate: 70,  fuel: 22, models: ['Volvo A40G', 'CAT 745', 'Komatsu HM400-5'] },
    { id: 'CAR', name: 'Cargador',        rate: 85,  fuel: 16, models: ['CAT 966 GC', 'Volvo L150H', 'Komatsu WA470-8'] },
    { id: 'BUL', name: 'Bulldozer',       rate: 120, fuel: 28, models: ['CAT D8', 'Komatsu D155AX-8', 'Liebherr PR 756'] },
    { id: 'MOT', name: 'Motoniveladora',  rate: 90,  fuel: 15, models: ['CAT 140 GC', 'John Deere 772G', 'Komatsu GD655-7'] },
    { id: 'RET', name: 'Retroexcavadora', rate: 55,  fuel: 8,  models: ['CAT 420', 'John Deere 310L', 'Case 580N'] },
    { id: 'COM', name: 'Compactador',     rate: 60,  fuel: 10, models: ['CAT CS56B', 'Dynapac CA2500', 'Bomag BW 213'] },
    { id: 'GRU', name: 'Grúa',            rate: 150, fuel: 20, models: ['Liebherr LTM 1090', 'Grove GMK5150L'] },
  ],

  clients: [
    { id: 'C1', name: 'Concesión Vial Andina' },
    { id: 'C2', name: 'Agregados del Valle' },
    { id: 'C3', name: 'Hidroeléctrica Sur' },
    { id: 'C4', name: 'Constructora Meridiano' },
    { id: 'C5', name: 'Minera Cordillera' },
  ],

  // mix: peso relativo de cada tipo de equipo en la obra.
  sites: [
    { id: 'S1', name: 'Troncal Norte · Tramo 2', short: 'Troncal Norte',  client: 'C1', lat: 6.35, lon: -75.55, radius: 0.05, sunday: false, mix: { EXC: 4, VOL: 8, MOT: 3, COM: 3, BUL: 2, CAR: 1 } },
    { id: 'S2', name: 'Cantera La Esperanza',    short: 'La Esperanza',   client: 'C2', lat: 6.05, lon: -75.20, radius: 0.035, sunday: true,  mix: { EXC: 3, CAR: 4, VOL: 6 } },
    { id: 'S3', name: 'Presa Río Claro',         short: 'Río Claro',      client: 'C3', lat: 5.45, lon: -74.85, radius: 0.05, sunday: true,  mix: { EXC: 5, VOL: 7, BUL: 3, GRU: 3, COM: 2 } },
    { id: 'S4', name: 'Parque Industrial Occidente', short: 'P.I. Occidente', client: 'C4', lat: 5.70, lon: -75.70, radius: 0.03, sunday: false, mix: { RET: 5, EXC: 2, COM: 2, GRU: 1, CAR: 2 } },
    { id: 'S5', name: 'Variante San Isidro',     short: 'San Isidro',     client: 'C1', lat: 5.95, lon: -75.85, radius: 0.04, sunday: false, mix: { MOT: 3, COM: 3, VOL: 4, EXC: 2, RET: 2 } },
    { id: 'S6', name: 'Mina El Porvenir',        short: 'El Porvenir',    client: 'C5', lat: 5.20, lon: -75.30, radius: 0.045, sunday: true, mix: { EXC: 4, VOL: 9, CAR: 3, BUL: 2 } },
  ],

  // Corredores viales (secuencias de puntos lat/lon) usados en el mapa base y por las volquetas.
  roads: [
    [[6.35, -75.55], [6.25, -75.42], [6.12, -75.28], [6.05, -75.20]],
    [[6.05, -75.20], [5.88, -75.10], [5.66, -74.96], [5.45, -74.85]],
    [[6.05, -75.20], [5.98, -75.45], [5.84, -75.60], [5.70, -75.70]],
    [[5.70, -75.70], [5.82, -75.79], [5.95, -75.85]],
    [[5.70, -75.70], [5.50, -75.55], [5.33, -75.40], [5.20, -75.30]],
    [[5.20, -75.30], [5.28, -75.10], [5.40, -74.94], [5.45, -74.85]],
    [[6.35, -75.55], [6.20, -75.72], [6.05, -75.82], [5.95, -75.85]],
  ],
  rivers: [
    [[6.60, -75.05], [6.30, -75.00], [6.00, -74.98], [5.75, -74.90], [5.52, -74.88], [5.45, -74.85], [5.25, -74.70], [5.00, -74.62]],
    [[6.60, -75.95], [6.30, -75.78], [6.00, -75.62], [5.75, -75.52], [5.45, -75.45], [5.10, -75.48], [5.00, -75.50]],
  ],
  // Orden en que se dibujan/listan los estados en vivo.
  states: [
    { id: 'op',      name: 'Operando',   color: '#38e0a0' },
    { id: 'idle',    name: 'Ralentí',    color: '#ff9b5c' },
    { id: 'standby', name: 'Standby',    color: '#6cb6ff' },
    { id: 'down',    name: 'Avería',     color: '#ff5d73' },
    { id: 'off',     name: 'Sin señal',  color: '#7d8aa3' },
  ],
};
