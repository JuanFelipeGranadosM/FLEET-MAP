import type { MapboxOverlay } from '@deck.gl/mapbox';

export interface ViewApi { flyTo(o: { center: [number, number]; zoom: number; padding: { top: number; right: number; bottom: number; left: number }; duration: number }): void; getZoom(): number }
export interface BaseMapProps {
  bounds: [[number, number], [number, number]];
  kind: 'light' | 'satellite';
  onOverlay(o: MapboxOverlay): void;
  onView(v: ViewApi): void;
  onZoom(z: number): void;
  onFail?(): void;
}
