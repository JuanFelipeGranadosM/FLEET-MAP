/* Mapa base sin token ni teselas externas: fondo claro + relieve suave generado.
 * Vías, ríos, límites y ciudades reales (Natural Earth) los dibuja deck.gl encima. */
import { useEffect, useMemo } from 'react';
import { Map, useControl, useMap } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { makeTerrain } from '../../lib/terrain';
import type { BaseMapProps, ViewApi } from './types';

function Overlay({ onOverlay, onView }: Pick<BaseMapProps, 'onOverlay' | 'onView'>) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));
  const { current } = useMap();
  useEffect(() => onOverlay(overlay), [overlay, onOverlay]);
  useEffect(() => { if (current) onView(current as unknown as ViewApi); }, [current, onView]);
  return null;
}

export default function MapLibreBase({ bounds, onOverlay, onView, onZoom }: BaseMapProps) {
  const style = useMemo<StyleSpecification>(() => {
    const t = makeTerrain({ lonMin: bounds[0][0], latMin: bounds[0][1], lonMax: bounds[1][0], latMax: bounds[1][1] });
    return {
      version: 8,
      sources: { terrain: { type: 'image', url: t.url, coordinates: t.coordinates } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#eef1f4' } },
        { id: 'terrain', type: 'raster', source: 'terrain', paint: { 'raster-fade-duration': 0, 'raster-opacity': 0.9 } },
      ],
    };
  }, [bounds]);
  return (
    <Map
      initialViewState={{ bounds, fitBoundsOptions: { padding: 24 } }}
      mapStyle={style}
      onMove={e => onZoom(e.viewState.zoom)}
      attributionControl={{ compact: true, customAttribution: 'Natural Earth' }}
      dragRotate={false}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Overlay onOverlay={onOverlay} onView={onView} />
    </Map>
  );
}
