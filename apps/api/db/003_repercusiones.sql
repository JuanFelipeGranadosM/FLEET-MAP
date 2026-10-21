-- FleetMap · repercusión interna de maquinaria (horas × tarifa cargadas a cada proyecto),
-- presupuesto de venta, costes vs venta y fin de uso de activos.
-- Fuente: libro "DATOS INFORME MASTER" de control de gestión (hojas HISTORICO, PTTO VENTA,
-- LISTA DE EQUIPOS, LISTA DE PROYECTOS, LISTA FAMILIAS, COSTES VS VENTA, RETOMAS).
-- Se aplica después de 002_operacion_facturacion.sql. Montos en COP.

CREATE TABLE IF NOT EXISTS equipment_family (
  code text PRIMARY KEY,                   -- 'P0TC'
  name text NOT NULL                       -- 'TRACTOCAMIONES'
);

-- Proyectos / centros de coste destino. group_name es la obra grande (TM1 SUR, TM2 NORTE, PLANTAS…).
CREATE TABLE IF NOT EXISTS cost_project (
  id text PRIMARY KEY,                     -- '3501', '39P04', '35PS'
  short_name text,                         -- 'T1 - UF1'
  name text,
  group_name text,
  site_id text REFERENCES site(id),
  management_control text,
  site_manager text,
  production_manager text
);

-- Maestro de activos de la base de maquinaria (incluye los que no tienen telemetría ni ficha en equipment).
CREATE TABLE IF NOT EXISTS asset (
  code text PRIMARY KEY,                   -- '40BUP0TC009'
  equipment_id text,                       -- código corto del libro de arranque: 'P0TC009'
  description text,
  family_code text REFERENCES equipment_family(code),
  plate text,
  rate_hour numeric(14,2),                 -- tarifa vigente de la lista de equipos
  gps text
);
CREATE INDEX IF NOT EXISTS asset_equipment ON asset (equipment_id);

-- Historial de tarifa hora: una fila por cada cambio observado en las actas de repercusión reales.
-- La tarifa vigente de la lista de equipos queda en asset.rate_hour.
CREATE TABLE IF NOT EXISTS asset_rate (
  asset_code text NOT NULL REFERENCES asset(code),
  valid_from date NOT NULL,
  rate_hour numeric(14,2) NOT NULL,
  source text NOT NULL DEFAULT 'HISTORICO',
  PRIMARY KEY (asset_code, valid_from, rate_hour)
);

-- Acta de repercusión mensual (real) y presupuesto de venta, línea por línea.
CREATE TABLE IF NOT EXISTS repercussion (
  id bigserial PRIMARY KEY,
  period date NOT NULL,                    -- primer día del mes del corte
  kind text NOT NULL CHECK (kind IN ('real', 'presupuesto')),
  asset_code text NOT NULL REFERENCES asset(code),
  description text,
  hours numeric(10,2),                     -- horas del parte
  pct numeric(6,4),                        -- % repercutido cuando el equipo se reparte
  hours_billed numeric(10,2),              -- horas trabajadas y/o disponibles que se cobran
  rate_hour numeric(14,2),
  amount numeric(16,2) NOT NULL,           -- horas cobradas × tarifa (las regularizaciones de almacén traen solo el valor)
  project_id text REFERENCES cost_project(id),
  project_name text,
  cost_center text,                        -- '3700.02.05'
  family_code text REFERENCES equipment_family(code),
  group_name text,                         -- TM1 SUR, TM2 NORTE, PLANTAS, PAROS…
  income_type text,                        -- REPERCUSIÓN, STOCK REALIZABLE…
  source_row int
);
CREATE INDEX IF NOT EXISTS repercussion_period ON repercussion (period, kind);
CREATE INDEX IF NOT EXISTS repercussion_asset ON repercussion (asset_code, period);

-- Costes vs venta mensual (incurrido y presupuesto).
CREATE TABLE IF NOT EXISTS monthly_pnl (
  period date NOT NULL,
  concept text NOT NULL,                   -- 'COSTE INCURRIDO', 'COSTE PPTO', 'VENTA INCURRIDA'
  amount numeric(18,2) NOT NULL,
  PRIMARY KEY (period, concept)
);

-- Fin de uso y retoma de cada activo.
CREATE TABLE IF NOT EXISTS asset_disposal (
  asset_code text PRIMARY KEY REFERENCES asset(code),
  subfamily text,
  asset_group text,                        -- ACTIVOS, ALQUILADOS…
  hours_histogram numeric(10,1),
  hours_total numeric(10,1),
  hour_meter numeric(10,1),
  end_of_use date,
  sale_date date,
  acquisition_cost numeric(16,2),
  accumulated_amortization numeric(16,2),
  net_book_value numeric(16,2),
  book_gain numeric(16,2),
  retake_pct numeric(8,4),
  retake_value numeric(16,2),
  sales_made numeric(16,2),
  projected_sale numeric(16,2),
  market_sale numeric(16,2),
  buyer text,
  fixed_cost_month numeric(16,2),
  rent_month numeric(16,2)
);

-- ── Vistas ──────────────────────────────────────────────────────────────────
-- Repercusión mensual por obra grande y proyecto.
CREATE OR REPLACE VIEW v_repercussion_month AS
SELECT period, kind, group_name, project_id, project_name,
       count(DISTINCT asset_code) AS assets, sum(hours_billed) AS hours, sum(amount) AS amount
FROM repercussion GROUP BY period, kind, group_name, project_id, project_name;

-- Real vs presupuesto por mes y familia.
CREATE OR REPLACE VIEW v_repercussion_vs_budget AS
SELECT period, family_code,
       sum(amount) FILTER (WHERE kind = 'real') AS real_amount,
       sum(amount) FILTER (WHERE kind = 'presupuesto') AS budget_amount,
       sum(hours_billed) FILTER (WHERE kind = 'real') AS real_hours,
       sum(hours_billed) FILTER (WHERE kind = 'presupuesto') AS budget_hours
FROM repercussion GROUP BY period, family_code;

-- Tarifa hora de un activo en una fecha (última vigencia anterior o igual).
CREATE OR REPLACE FUNCTION asset_rate_at(p_asset text, p_day date) RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT rate_hour FROM asset_rate
  WHERE asset_code = p_asset AND valid_from <= p_day
  ORDER BY valid_from DESC LIMIT 1
$$;
