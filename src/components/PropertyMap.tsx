"use client"

import { useEffect } from "react"
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet"
import type { PropertyRow } from "./PropertyTable"
import "leaflet/dist/leaflet.css"

// NYC bounds
const NYC_CENTER: [number, number] = [40.7128, -74.006]
const NYC_ZOOM = 11

interface MapProperty extends PropertyRow {
  latitude: number | null
  longitude: number | null
}

interface PropertyMapProps {
  data: MapProperty[]
  onSelect?: (bbl: string) => void
}

function scoreColor(score: number): string {
  if (score >= 75) return "#ef4444"   // red-500
  if (score >= 50) return "#f59e0b"   // amber-500
  return "#22c55e"                    // green-500
}

function fmt$(n: number | null | undefined): string {
  if (!n) return "—"
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(n)
}

// Fit map to markers when data changes
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0], 15)
      return
    }
    const lats = points.map((p) => p[0])
    const lngs = points.map((p) => p[1])
    map.fitBounds([
      [Math.min(...lats), Math.min(...lngs)],
      [Math.max(...lats), Math.max(...lngs)],
    ], { padding: [40, 40] })
  }, [points, map])
  return null
}

export function PropertyMap({ data, onSelect }: PropertyMapProps) {
  const mappable = data.filter(
    (p): p is MapProperty & { latitude: number; longitude: number } =>
      p.latitude != null && p.longitude != null &&
      p.latitude > 40 && p.latitude < 42 &&
      p.longitude > -75 && p.longitude < -73
  )

  const points: [number, number][] = mappable.map((p) => [p.latitude, p.longitude])

  return (
    <MapContainer
      center={NYC_CENTER}
      zoom={NYC_ZOOM}
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds points={points} />

      {mappable.map((p) => (
        <CircleMarker
          key={p.bbl}
          center={[p.latitude, p.longitude]}
          radius={7}
          pathOptions={{
            fillColor: scoreColor(p.distress_score),
            fillOpacity: 0.85,
            color: "#fff",
            weight: 1.5,
          }}
          eventHandlers={{ click: () => onSelect?.(p.bbl) }}
        >
          <Popup className="property-popup" maxWidth={260}>
            <div className="space-y-1 text-xs leading-snug">
              <div className="font-semibold text-sm">{p.address || p.bbl}</div>
              <div className="text-muted-foreground">{p.borough} · {p.building_class}</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pt-1">
                <span className="text-muted-foreground">Score</span>
                <span className="font-medium">{p.distress_score.toFixed(0)}</span>
                <span className="text-muted-foreground">Expires</span>
                <span>{p.expiration_year ?? "—"}</span>
                <span className="text-muted-foreground">Annual exempt</span>
                <span>{fmt$(p.annual_exempt_amount)}</span>
                <span className="text-muted-foreground">Units</span>
                <span>{p.total_units ?? "—"}</span>
              </div>
              {onSelect && (
                <button
                  onClick={() => onSelect(p.bbl)}
                  className="mt-2 text-blue-600 hover:underline text-xs"
                >
                  View detail →
                </button>
              )}
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {mappable.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center z-[1000] pointer-events-none">
          <div className="bg-white/90 rounded-lg px-4 py-2 text-sm text-muted-foreground shadow">
            No geocoded properties to display
          </div>
        </div>
      )}
    </MapContainer>
  )
}
