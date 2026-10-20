# FleetMap

Centro de control de flota de maquinaria: mapa interactivo con animaciones, detalle por equipo
(horas trabajadas, ralentí, standby, avería y facturación), filtros cruzados tipo BI y filtro por fecha.

| Carpeta | Contenido |
|---|---|
| `apps/web` | React 19 + TypeScript + Vite · MapLibre GL + deck.gl · Apache ECharts · Zustand · TanStack Query |
| `apps/api` | Python · FastAPI · simulador y adaptador ISO 15143-3 (AEMP 2.0) · WebSocket en vivo |
| `apps/api/db/schema.sql` | Esquema PostgreSQL + TimescaleDB + PostGIS para producción |
| `prototype/` | Primera maqueta en un solo HTML (Canvas 2D, sin dependencias) |

## Arranque local

```bash
# 1. API (puerto 8000)
cd apps/api
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
pytest -q                                           # 3 pruebas: endpoints, reglas de facturación, WebSocket

# 2. Web (puerto 5173, /api se redirige a la API)
cd apps/web
npm install
npm run dev
```

Vista previa sin servidor: `npm run build:demo` en `apps/web` genera `dist-demo/index.html` (un solo archivo con el simulador en el navegador y relieve generado como mapa base).

Opcional: `docker compose up` levanta PostgreSQL/Timescale/PostGIS con el esquema y la API.

## Endpoints

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/v1/catalog` | Tipos, tarifas, obras, clientes, vías, estados |
| GET | `/api/v1/fleet` | Equipos con PIN, OEM, modelo, posición, tarifa |
| GET | `/api/v1/metrics/daily?from&to` | Series diarias en columnas (work, idle, standby, down, fuel) |
| GET | `/api/v1/live` | Estado actual de cada equipo |
| GET | `/api/v1/equipment/{id}/billing?from&to` | Facturación oficial del periodo |
| WS | `/api/v1/live/ws` | Cambios de estado en vivo |

Documentación interactiva en `http://localhost:8000/docs`.

## Conectar telemetría real

1. Copiar `apps/api/.env.example` a `.env`, poner `FLEETMAP_PROVIDER=aemp` y las credenciales OAuth2 del OEM.
2. Crear `asset_master.json` con los datos de negocio por PIN: `{ "PIN123": { "typeId": "EXC", "siteId": "S1", "rate": 95 } }`.
3. El adaptador (`app/providers/aemp.py`) convierte las series acumuladas de AEMP a horas diarias. Standby sale del
   calendario de turnos y avería de las órdenes de mantenimiento. **Aún no se ha probado contra una API real**:
   verificar nombres de campos y paginación con la documentación de cada marca.

Para varias marcas, el siguiente paso es un worker que consulte cada OEM, escriba en `telemetry_reading` /
`equipment_day` (ver `db/schema.sql`) y que la API lea de la base en lugar de llamar al OEM en cada petición.

## Reglas de negocio actuales

- Horas trabajadas = horómetro (motor encendido, incluye ralentí).
- Standby = horas de turno con el equipo disponible y sin operar. Turnos: 10 h L–V, 6 h sábado, domingo según obra.
- Facturación = trabajadas × tarifa + standby × tarifa × 50 %.
- No facturado = (trabajadas + standby + avería) × tarifa − facturación.
- Moneda USD. Todo se ajusta en `app/domain/catalog.py` y `app/domain/billing.py`.

## Mapa base

`apps/web/.env.example`: estilo oscuro de CARTO (sin clave) y satélite de Esri. Para producción conviene un
proveedor con contrato (MapTiler, Stadia, Mapbox) y revisar sus términos de uso. Si el estilo no carga, el mapa
cae a un fondo liso y sigue mostrando vías, obras y equipos.

## Rendimiento

- Equipos, pulsos, aros de obra y calor se dibujan en WebGL con deck.gl. El bucle de animación actualiza las
  capas directamente, sin re-render de React por cuadro (~5 % del hilo principal en la prueba).
- La historia completa (180 días) se carga una vez; filtros y fechas se resuelven en el cliente con `Float32Array`
  en ~1–2 ms.
- La API comprime con gzip y separa la librería del mapa, deck.gl y ECharts en chunks propios.
