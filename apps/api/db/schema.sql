-- FleetMap · esquema para producción (PostgreSQL + TimescaleDB + PostGIS)
-- El worker de ingesta escribe aquí lo que trae de AEMP; la API lee de aquí
-- en lugar de consultar al OEM en cada petición.
-- TimescaleDB es opcional: sin la extensión las tablas quedan como tablas normales.
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS timescaledb;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'TimescaleDB no disponible: telemetry_reading y equipment_day quedan como tablas normales';
END $$;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE client   (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE site     (id text PRIMARY KEY, name text NOT NULL, client_id text REFERENCES client(id),
                       area geometry(Polygon, 4326), works_sunday boolean DEFAULT false);
CREATE TABLE equipment (
  id text PRIMARY KEY, pin text UNIQUE NOT NULL, oem text, model text, type_id text NOT NULL,
  site_id text REFERENCES site(id), rate numeric(12,2) NOT NULL, standby_factor numeric(4,3) DEFAULT 0.5,
  year int
);

-- Lecturas crudas acumuladas tal como llegan de AEMP (idempotentes por equipo + instante).
CREATE TABLE telemetry_reading (
  equipment_id text REFERENCES equipment(id), ts timestamptz NOT NULL,
  cum_operating_hours double precision, cum_idle_hours double precision, cum_fuel_l double precision,
  location geometry(Point, 4326), engine_on boolean, fault_codes text[],
  PRIMARY KEY (equipment_id, ts)
);

-- Agregado diario que consume el tablero.
CREATE TABLE equipment_day (
  equipment_id text REFERENCES equipment(id), day date NOT NULL,
  work_h real, idle_h real, standby_h real, down_h real, fuel_l real,
  PRIMARY KEY (equipment_id, day)
);
CREATE INDEX ON telemetry_reading USING gist (location);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('telemetry_reading', 'ts');
    PERFORM create_hypertable('equipment_day', by_range('day'));
  END IF;
END $$;
