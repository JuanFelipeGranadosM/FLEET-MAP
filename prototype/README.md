# FleetMap · maqueta de mapa interactivo de flota

Maqueta de un centro de control de maquinaria: mapa animado de equipos, detalle por equipo
(horas trabajadas, ralentí, standby, avería, facturación), filtros cruzados tipo BI y filtro por fecha.
Sin dependencias ni build obligatorio.

## Ejecutar
- Abrir `index.html` en el navegador (o `npx serve .`).
- `node scripts/build.mjs` genera `dist/fleetmap.html` (un solo archivo autocontenido).

## Estructura
| Archivo | Rol |
|---|---|
| `src/data/config.js` | Catálogos: tipos, tarifas, obras, clientes, vías, estados |
| `src/data/providers.js` | Contrato `TelemetryProvider`, simulador y adaptador ISO 15143-3 (AEMP 2.0) |
| `src/data/store.js` | Estado, filtros cruzados y agregación en `Float32Array` |
| `src/ui/map.js` | Mapa en Canvas 2D: relieve, vías, obras, equipos animados, capa de calor |
| `src/ui/charts.js` | Línea de tiempo con selector de rango, sparklines, medidor |
| `src/app.js` | Enlace de la interfaz |

## Conectar telemetría real
En `src/app.js` cambiar `new FM.MockTelemetryProvider()` por `new FM.AempTelemetryProvider({ baseUrl, getToken, assetMaster, shiftHours })`.
Recomendado: un backend propio que consulte la API AEMP de cada OEM (CAT VisionLink, Komatsu Komtrax,
Volvo CareTrack, JDLink…), guarde los tokens OAuth y exponga el mismo contrato ya agregado.
AEMP aporta horas de operación, ralentí, combustible y ubicación; standby, avería y tarifas vienen
del calendario de turnos, del mantenimiento y del contrato.

## Reglas de negocio (maqueta)
- Horas trabajadas = horómetro (motor encendido, incluye ralentí).
- Standby = horas de turno con el equipo disponible y sin operar.
- Facturación = trabajadas × tarifa + standby × tarifa × factor standby (50 %).
- No facturado = (trabajadas + standby + avería) × tarifa − facturación.

## Siguiente paso sugerido para producción
Reemplazar el relieve procedural por MapLibre GL (teselas vectoriales o satélite) y dibujar la capa
de equipos encima (Canvas propio o deck.gl), manteniendo `store.js` y `providers.js`.
