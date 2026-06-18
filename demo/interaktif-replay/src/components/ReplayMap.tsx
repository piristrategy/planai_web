import { useEffect, useRef, useMemo, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import { MapboxOverlay } from '@deck.gl/mapbox';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { FieldReport } from '../types/report';
import type { TimelineEvent } from '../types/report';
import { getMapCenter, getTrack, slicePath } from '../utils/geo';

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const DARK_STYLE = 'mapbox://styles/mapbox/dark-v11';

type Props = {
  report: FieldReport;
  timeline: TimelineEvent[];
  progress: number;
  position: { lat: number; lon: number } | null;
  activeEventIndex: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  cinematic: boolean;
};

export function ReplayMap({
  report,
  timeline,
  progress,
  position,
  activeEventIndex,
  selectedId,
  onSelect,
  cinematic,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  const track = getTrack(report);
  const fullPath = useMemo(
    () => track?.path.map((p) => [p.lon, p.lat] as [number, number]) ?? [],
    [track],
  );
  const activePath = useMemo(() => slicePath(track?.path ?? [], progress), [track, progress]);

  const eventPoints = useMemo(
    () =>
      timeline
        .filter((e) => e.kind === 'photo' || e.kind === 'note')
        .map((e) => ({
          id: e.id,
          position: [e.lon, e.lat] as [number, number],
          kind: e.kind,
          selected: e.id === selectedId,
          active: timeline[activeEventIndex]?.id === e.id,
          preview: e.previewUrl,
        })),
    [timeline, selectedId, activeEventIndex],
  );

  const updateLayers = useCallback(() => {
    if (!overlayRef.current) return;
    overlayRef.current.setProps({
      layers: [
        new PathLayer({
          id: 'route-full',
          data: fullPath.length ? [{ path: fullPath }] : [],
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: [77, 217, 240, 40],
          getWidth: 4,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
        }),
        new PathLayer({
          id: 'route-active',
          data: activePath.length ? [{ path: activePath }] : [],
          getPath: (d: { path: [number, number][] }) => d.path,
          getColor: [94, 232, 154, 220],
          getWidth: 5,
          widthUnits: 'pixels',
          capRounded: true,
          jointRounded: true,
        }),
        new ScatterplotLayer({
          id: 'events',
          data: eventPoints,
          getPosition: (d) => d.position,
          getRadius: (d) => (d.selected || d.active ? 14 : 10),
          getFillColor: (d) =>
            d.kind === 'photo'
              ? d.active
                ? [212, 168, 83, 255]
                : [77, 217, 240, 200]
              : [167, 139, 250, 200],
          pickable: true,
          radiusUnits: 'pixels',
          onClick: (info) => {
            const obj = info.object as (typeof eventPoints)[0] | undefined;
            if (obj) onSelect(obj.id);
          },
        }),
        ...(position
          ? [
              new ScatterplotLayer({
                id: 'inspector',
                data: [{ position: [position.lon, position.lat] }],
                getPosition: (d: { position: [number, number] }) => d.position,
                getRadius: 12,
                getFillColor: [255, 255, 255, 255],
                getLineColor: [94, 232, 154, 255],
                lineWidthMinPixels: 3,
                stroked: true,
                radiusUnits: 'pixels',
              }),
            ]
          : []),
      ],
    });
  }, [activePath, eventPoints, fullPath, onSelect, position]);

  useEffect(() => {
    updateLayers();
  }, [updateLayers]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    if (!MAPBOX_TOKEN) {
      console.warn('VITE_MAPBOX_TOKEN missing — map tiles may not load');
    } else {
      mapboxgl.accessToken = MAPBOX_TOKEN;
    }

    const center = getMapCenter(report.bounds);
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: DARK_STYLE,
      center: [center.lon, center.lat],
      zoom: 15,
      pitch: cinematic ? 55 : 45,
      bearing: -20,
      antialias: true,
    });

    const overlay = new MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay as unknown as mapboxgl.IControl);
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    mapRef.current = map;
    overlayRef.current = overlay;

    map.on('load', () => {
      map.setFog({
        color: 'rgb(5, 10, 20)',
        'high-color': 'rgb(15, 31, 56)',
        'horizon-blend': 0.1,
        'space-color': 'rgb(5, 10, 20)',
        'star-intensity': 0.15,
      });
      updateLayers();
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, [cinematic, report.bounds, updateLayers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position || !cinematic) return;
    map.easeTo({
      center: [position.lon, position.lat],
      duration: 800,
      easing: (t) => t * (2 - t),
    });
  }, [position, cinematic]);

  useEffect(() => {
    const map = mapRef.current;
    const ev = timeline[activeEventIndex];
    if (!map || !ev || cinematic) return;
    map.flyTo({
      center: [ev.lon, ev.lat],
      zoom: 17,
      duration: 1200,
      essential: true,
    });
  }, [activeEventIndex, cinematic, timeline]);

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {!MAPBOX_TOKEN && (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
          <div className="glass rounded-lg px-4 py-2 text-xs text-gold">
            Mapbox token gerekli — .env dosyasına VITE_MAPBOX_TOKEN ekleyin
          </div>
        </div>
      )}
    </div>
  );
}
