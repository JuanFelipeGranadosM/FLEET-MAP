-- FleetMap · operación diaria (pool), ubicaciones y facturación por contrato.
-- Se aplica después de schema.sql. Fuentes que lo alimentan hoy:
--   · parte diario / panel de control (BMC_1.xlsx hoja Registros)  → daily_report
--   · recibos de báscula del acta del cliente (F12-C "Detalle Acta") → haul_ticket
--   · hoja "Acta" del F12-C (cantidades, precio contractual y otrosí) → contract, contract_item, tariff
--   · hoja "STAND BY" del acta y la validación de días disponibles  → standby_window
--   · GPS del proveedor de rastreo (Detalle_GPS, TrayectosFlota)    → gps_fix
-- Montos en COP salvo que tariff.currency diga otra cosa.

-- ── Organización ────────────────────────────────────────────────────────────
-- Las obras grandes (TM1 SUR/NORTE, TM2 SUR/NORTE) siguen en `site`; las UF son el detalle.
ALTER TABLE site ADD COLUMN IF NOT EXISTS project text;          -- 'TM1', 'TM2'
CREATE TABLE IF NOT EXISTS functional_unit (
  id text PRIMARY KEY,                     -- 'TM1-UF05'
  site_id text NOT NULL REFERENCES site(id),
  name text NOT NULL,
  area geometry(MultiPolygon, 4326)
);

-- Contratantes, contratistas y dueños de equipos de terceros.
CREATE TABLE IF NOT EXISTS party (
  id text PRIMARY KEY,                     -- 'CONSORCIO-BMC', 'ORTIZ', dueños de volquetas de terceros
  name text NOT NULL,
  nit text,
  kind text NOT NULL DEFAULT 'empresa' CHECK (kind IN ('empresa', 'persona'))
);

-- Equipos sin telemetría OEM (tractocamiones, volquetas) entran con su placa como PIN.
ALTER TABLE equipment ALTER COLUMN rate DROP NOT NULL;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS plate text UNIQUE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS code text;          -- código interno, p. ej. P0TC0NN
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS owner_id text REFERENCES party(id);

CREATE TABLE IF NOT EXISTS operator (
  id bigserial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  document text                            -- cédula: dato personal, no se expone en la API
);

-- ── Pool diario: una fila por equipo y día ──────────────────────────────────
-- Horas trabajadas, desplazamiento (odómetro) y producción (m³, viajes) del parte de trabajo.
CREATE TABLE IF NOT EXISTS daily_report (
  equipment_id text NOT NULL REFERENCES equipment(id),
  day date NOT NULL,
  report_no text,                          -- número del parte (talonario)
  operator_id bigint REFERENCES operator(id),
  site_id text REFERENCES site(id),
  uf_id text REFERENCES functional_unit(id),
  status text NOT NULL CHECK (status IN ('trabajando', 'disponible', 'taller', 'varado', 'sin_registro')),
  odometer_start numeric(10,1),
  odometer_end numeric(10,1),
  km numeric(8,1) GENERATED ALWAYS AS (GREATEST(odometer_end - odometer_start, 0)) STORED,
  shift_start time,
  shift_end time,
  -- jornadas que pasan la medianoche (23:00 → 16:00) cuentan el tramo del día siguiente
  hours numeric(5,2) GENERATED ALWAYS AS (
    CASE WHEN shift_start IS NULL OR shift_end IS NULL THEN NULL
         ELSE round((extract(epoch FROM (shift_end - shift_start)) / 3600.0
                    + CASE WHEN shift_end < shift_start THEN 24 ELSE 0 END)::numeric, 2) END) STORED,
  m3 numeric(8,2),
  trips smallint,
  route text,                              -- trayecto tal como lo escribe el parte
  origin text,
  destination text,
  location geometry(Point, 4326),          -- última posición conocida del día (GPS o frente)
  note text,
  source text NOT NULL,                    -- 'BMC_1.xlsx', 'parte', 'gps'
  loaded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (equipment_id, day)
);
CREATE INDEX IF NOT EXISTS daily_report_day ON daily_report (day);
CREATE INDEX IF NOT EXISTS daily_report_location ON daily_report USING gist (location);

-- ── Ubicaciones crudas del rastreador ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS gps_fix (
  equipment_id text NOT NULL REFERENCES equipment(id),
  ts timestamptz NOT NULL,
  location geometry(Point, 4326) NOT NULL,
  speed_kmh real,
  odometer_km double precision,
  ignition boolean,
  address text,
  source text NOT NULL,
  PRIMARY KEY (equipment_id, ts)
);
CREATE INDEX IF NOT EXISTS gps_fix_location ON gps_fix USING gist (location);

-- ── Contratos, ítems y tarifas ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contract (
  id text PRIMARY KEY,                     -- 'CT-NNN-AAAA'
  order_no text,                           -- orden de operación del cliente: 'BMC-NNN-AAAA'
  client_id text NOT NULL REFERENCES party(id),
  contractor_id text NOT NULL REFERENCES party(id),
  object text,
  site_id text REFERENCES site(id),
  cost_center text,                        -- CC-SC
  start_date date,
  end_date date,
  value numeric(16,2),
  billing_cycle text DEFAULT 'mensual',
  payment_days int
);

CREATE TABLE IF NOT EXISTS contract_item (
  contract_id text NOT NULL REFERENCES contract(id),
  code text NOT NULL,                      -- código Navision: '3.02.04'
  description text NOT NULL,
  unit text NOT NULL,                      -- 'm3-km', 'h', 'día', 'viaje'
  qty_contract numeric(14,2),
  PRIMARY KEY (contract_id, code)
);

-- Historial de precios: contrato inicial y cada otrosí abren una vigencia nueva.
CREATE TABLE IF NOT EXISTS tariff (
  contract_id text NOT NULL,
  item_code text NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  unit_price numeric(14,2) NOT NULL,
  qty numeric(14,2),                       -- cantidad vigente con ese precio
  currency text NOT NULL DEFAULT 'COP',
  source text NOT NULL,                    -- 'Contrato inicial', 'Otrosí No. 01'
  in_force boolean NOT NULL DEFAULT true,  -- false: precio pactado cuya vigencia aún no se confirma
  PRIMARY KEY (contract_id, item_code, valid_from, source),
  FOREIGN KEY (contract_id, item_code) REFERENCES contract_item(contract_id, code)
);

-- Mínimo garantizado (stand by): m³ × km × viajes por mes, prorrateado por días disponibles.
CREATE TABLE IF NOT EXISTS standby_rule (
  contract_id text NOT NULL REFERENCES contract(id),
  item_code text NOT NULL,
  min_m3 numeric(8,2) NOT NULL,            -- 20
  min_km numeric(8,2) NOT NULL,            -- 94 (también es la distancia mínima contractual)
  trips_per_month numeric(6,2) NOT NULL,   -- 15
  days_per_month int NOT NULL DEFAULT 30,
  PRIMARY KEY (contract_id, item_code),
  FOREIGN KEY (contract_id, item_code) REFERENCES contract_item(contract_id, code)
);

-- ── Actas de corte (historial de facturación) ───────────────────────────────
CREATE TABLE IF NOT EXISTS billing_cut (
  contract_id text NOT NULL REFERENCES contract(id),
  number int NOT NULL,                     -- acta No.
  period_from date NOT NULL,
  period_to date NOT NULL,
  prepared_on date,
  status text NOT NULL DEFAULT 'recibida'
    CHECK (status IN ('recibida', 'en_revision', 'validada', 'firmada', 'facturada')),
  invoice_no text,
  note text,
  PRIMARY KEY (contract_id, number)
);

-- Cantidades por ítem y concepto: lo que cobró el acta y lo que resultó de la validación.
CREATE TABLE IF NOT EXISTS billing_cut_line (
  contract_id text NOT NULL,
  cut_number int NOT NULL,
  item_code text NOT NULL,
  concept text NOT NULL CHECK (concept IN ('ejecutado', 'standby', 'ajuste')),
  qty_billed numeric(14,2),
  qty_validated numeric(14,2),
  unit_price numeric(14,2) NOT NULL,
  amount numeric(16,2) GENERATED ALWAYS AS (round(coalesce(qty_validated, qty_billed) * unit_price, 2)) STORED,
  note text,
  PRIMARY KEY (contract_id, cut_number, item_code, concept),
  FOREIGN KEY (contract_id, cut_number) REFERENCES billing_cut(contract_id, number),
  FOREIGN KEY (contract_id, item_code) REFERENCES contract_item(contract_id, code)
);

-- Recibos de báscula / viajes del detalle del acta.
CREATE TABLE IF NOT EXISTS haul_ticket (
  id bigserial PRIMARY KEY,
  contract_id text NOT NULL REFERENCES contract(id),
  cut_number int,
  ticket_no text NOT NULL,
  day date NOT NULL,
  plate text NOT NULL,                     -- placa tal como viene (incluye terceros sin ficha en equipment)
  equipment_id text REFERENCES equipment(id),
  supplier_id text REFERENCES party(id),
  driver text,
  m3 numeric(8,2) NOT NULL,
  route_code text,                         -- 'R7803'
  unload_station numeric(10,1),            -- abscisa de descargue
  origin text,
  destination text,
  haul_km numeric(7,1) NOT NULL,
  m3km_billed numeric(10,1),               -- lo que escribió el acta
  m3km_calc numeric(10,1) GENERATED ALWAYS AS (round(m3 * haul_km, 0)) STORED,
  activity text,                           -- 'PARCHEO', 'MIXTO'
  billable boolean NOT NULL DEFAULT true,  -- los vehículos de terceros no entran en la cantidad facturada
  note text,
  FOREIGN KEY (contract_id, cut_number) REFERENCES billing_cut(contract_id, number),
  -- el talonario repite números: la clave incluye placa y fecha
  UNIQUE (contract_id, ticket_no, plate, day)
);
CREATE INDEX IF NOT EXISTS haul_ticket_day ON haul_ticket (day, plate);

-- Ventanas de disponibilidad por equipo para el stand by de cada acta.
-- `slot` agrupa equipos que se relevan (el que sale y el que lo releva cuentan como un solo tractocamión).
CREATE TABLE IF NOT EXISTS standby_window (
  contract_id text NOT NULL,
  cut_number int NOT NULL,
  equipment_id text NOT NULL REFERENCES equipment(id),
  slot text NOT NULL,
  date_from date NOT NULL,
  date_to date NOT NULL,
  days_available int NOT NULL,             -- días calendario menos taller con parte que lo soporte
  workshop_days int NOT NULL DEFAULT 0,
  note text,
  PRIMARY KEY (contract_id, cut_number, equipment_id),
  FOREIGN KEY (contract_id, cut_number) REFERENCES billing_cut(contract_id, number)
);

-- ── Vistas ──────────────────────────────────────────────────────────────────
-- Uso diario consolidado para el tablero (horas, km, m³, viajes, ubicación).
CREATE OR REPLACE VIEW v_equipment_usage_day AS
SELECT r.equipment_id, e.plate, r.day, r.status, r.hours, r.km, r.m3, r.trips, r.report_no,
       r.site_id, r.uf_id, ST_Y(r.location) AS lat, ST_X(r.location) AS lon
FROM daily_report r JOIN equipment e ON e.id = r.equipment_id;

-- Acta vs cálculo: cuánto cobró cada acta y cuánto da m³ × km recibo por recibo.
CREATE OR REPLACE VIEW v_cut_reconciliation AS
SELECT t.contract_id, t.cut_number, count(*) AS trips, sum(t.m3) AS m3,
       min(t.haul_km) AS km_min, max(t.haul_km) AS km_max,
       sum(t.m3km_billed) AS m3km_billed, sum(t.m3km_calc) AS m3km_calc,
       sum(t.m3km_billed) - sum(t.m3km_calc) AS m3km_diff,
       count(*) FILTER (WHERE t.m3km_billed <> t.m3km_calc) AS tickets_with_diff
FROM haul_ticket t WHERE t.billable
GROUP BY t.contract_id, t.cut_number;

-- Precio vigente de un ítem en una fecha.
CREATE OR REPLACE FUNCTION tariff_at(p_contract text, p_item text, p_day date) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT unit_price FROM tariff
  WHERE contract_id = p_contract AND item_code = p_item AND in_force
    AND valid_from <= p_day AND (valid_to IS NULL OR valid_to >= p_day)
  ORDER BY valid_from DESC LIMIT 1
$$;

-- Mínimo garantizado vs ejecutado por slot (equipos que se relevan suman como uno).
CREATE OR REPLACE VIEW v_standby AS
WITH w AS (
  SELECT sw.contract_id, sw.cut_number, sw.slot, min(sw.date_from) AS date_from, max(sw.date_to) AS date_to,
         sum(sw.days_available) AS days_available, array_agg(e.plate ORDER BY sw.date_from) AS plates
  FROM standby_window sw JOIN equipment e ON e.id = sw.equipment_id
  GROUP BY sw.contract_id, sw.cut_number, sw.slot
), x AS (
  SELECT w.*, r.item_code,
         r.min_m3 * r.min_km * r.trips_per_month * w.days_available / r.days_per_month AS minimum_m3km
  FROM w JOIN standby_rule r ON r.contract_id = w.contract_id
)
SELECT x.*,
       coalesce(t.m3km, 0) AS executed_m3km,
       coalesce(t.trips, 0) AS trips,
       GREATEST(x.minimum_m3km - coalesce(t.m3km, 0), 0) AS shortfall_m3km
FROM x LEFT JOIN LATERAL (
  SELECT sum(ht.m3km_calc) AS m3km, count(*) AS trips
  FROM haul_ticket ht WHERE ht.contract_id = x.contract_id AND ht.cut_number = x.cut_number
    AND ht.billable AND ht.plate = ANY (x.plates)
) t ON true;
