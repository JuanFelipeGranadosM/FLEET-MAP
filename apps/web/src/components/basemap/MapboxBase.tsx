/* Mapa base Mapbox GL v3 con el estilo Standard (preset de luz "day", edificios 3D).
 * Requiere VITE_MAPBOX_TOKEN (token público pk.* restringido por URL). */
import { useEffect } from 'react';
import { Map, useControl, useMap } from 'react-map-gl/mapbox';
import { MapboxOverlay } from '@deck.gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import type { BaseMapProps, ViewApi } from './types';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

function Overlay({ onOverlay, onView }: Pick<BaseMapProps, 'onOverlay' | 'onView'>) {
  const overlay = useControl(() => new MapboxOverlay({ interleaved: false }));
  const { current } = useMap();
  useEffect(() => onOverlay(overlay), [overlay, onOverlay]);
  useEffect(() => { if (current) onView(current as unknown as ViewApi); }, [current, onView]);
  return null;
}

export default function MapboxBase({ bounds, kind, onOverlay, onView, onZoom }: BaseMapProps) {
  return (
    <Map
      mapboxAccessToken={TOKEN}
      initialViewState={{ bounds, fitBoundsOptions: { padding: 24 }, pitch: 35 }}
      mapStyle={kind === 'satellite' ? 'mapbox://styles/mapbox/standard-satellite' : 'mapbox://styles/mapbox/standard'}
      onLoad={e => {
        const m = e.target;
        try { m.setConfigProperty('basemap', 'lightPreset', 'day'); m.setConfigProperty('basemap', 'showPointOfInterestLabels', false); } catch { /* estilo sin config */ }
      }}
      onMove={e => onZoom(e.viewState.zoom)}
      maxPitch={60}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Overlay onOverlay={onOverlay} onView={onView} />
    </Map>
  );
}
