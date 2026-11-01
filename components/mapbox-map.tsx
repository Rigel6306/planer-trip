"use client"

import { useEffect, useRef, useState } from "react"
import mapboxgl from "mapbox-gl"
import "mapbox-gl/dist/mapbox-gl.css"
import type { Location } from "@/lib/db-service"

// Initialize Mapbox access token
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || ""

type DirectionsResponse = {
  routes?: Array<{
    geometry?: {
      type: "LineString"
      coordinates: number[][]
    }
  }>
  message?: string
}

interface MapboxMapProps {
  startLocation: Location | null
  endLocation: Location | null
}

export function MapboxMap({ startLocation, endLocation }: MapboxMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const [mapInitialized, setMapInitialized] = useState(false)
  const [mapError, setMapError] = useState<string | null>(null)

  // Initialize map
  useEffect(() => {
    if (map.current || !mapContainer.current) return

    if (!mapboxgl.accessToken) {
      setMapError("Map unavailable: configure NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN and restart the app.")
      return
    }

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [-74.5, 40], // Default center (will be updated)
      zoom: 9,
    })

    // Add navigation controls
    map.current.addControl(new mapboxgl.NavigationControl(), "top-right")

    // Set map as initialized when it's loaded
    map.current.on("load", () => {
      setMapInitialized(true)
    })

    map.current.on("error", (event) => {
      console.error("Mapbox map error:", event.error)
      setMapError("Map tiles could not be loaded. Check your Mapbox token, its allowed URLs, and network access.")
    })

    // Clean up on unmount
    return () => {
      if (map.current) {
        map.current.remove()
        map.current = null
      }
    }
  }, [])

  // Update map when locations change
  useEffect(() => {
    if (!map.current || !mapInitialized) return

    // Clear existing markers using ref instead of state
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    const newMarkers: mapboxgl.Marker[] = []

    // Add markers and fit bounds
    if (startLocation && endLocation) {
      // Add start marker
      const startMarker = new mapboxgl.Marker({ color: "#3b82f6" })
        .setLngLat([startLocation.lng, startLocation.lat])
        .setPopup(new mapboxgl.Popup().setHTML(`<h3>${startLocation.name}</h3>`))
        .addTo(map.current)

      newMarkers.push(startMarker)

      // Add end marker
      const endMarker = new mapboxgl.Marker({ color: "#ef4444" })
        .setLngLat([endLocation.lng, endLocation.lat])
        .setPopup(new mapboxgl.Popup().setHTML(`<h3>${endLocation.name}</h3>`))
        .addTo(map.current)

      newMarkers.push(endMarker)

      // Fit bounds to include both markers
      const bounds = new mapboxgl.LngLatBounds()
      bounds.extend([startLocation.lng, startLocation.lat])
      bounds.extend([endLocation.lng, endLocation.lat])

      map.current.fitBounds(bounds, {
        padding: 60,
        maxZoom: 15,
      })

      // Add route line between points
      getRoute(map.current, [startLocation.lng, startLocation.lat], [endLocation.lng, endLocation.lat])
    } else if (startLocation) {
      // Add only start marker
      const marker = new mapboxgl.Marker({ color: "#3b82f6" })
        .setLngLat([startLocation.lng, startLocation.lat])
        .setPopup(new mapboxgl.Popup().setHTML(`<h3>${startLocation.name}</h3>`))
        .addTo(map.current)

      newMarkers.push(marker)

      // Center map on marker
      map.current.flyTo({
        center: [startLocation.lng, startLocation.lat],
        zoom: 13,
      })
    } else if (endLocation) {
      // Add only end marker
      const marker = new mapboxgl.Marker({ color: "#ef4444" })
        .setLngLat([endLocation.lng, endLocation.lat])
        .setPopup(new mapboxgl.Popup().setHTML(`<h3>${endLocation.name}</h3>`))
        .addTo(map.current)

      newMarkers.push(marker)

      // Center map on marker
      map.current.flyTo({
        center: [endLocation.lng, endLocation.lat],
        zoom: 13,
      })
    }

    // Update markers ref
    markersRef.current = newMarkers
  }, [startLocation, endLocation, mapInitialized])

  // Function to get route between two points with safety checks
  async function getRoute(map: mapboxgl.Map, start: [number, number], end: [number, number]) {
    try {
      // Make a request to the Mapbox Directions API
      const query = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${start[0]},${start[1]};${end[0]},${end[1]}?steps=true&geometries=geojson&access_token=${mapboxgl.accessToken}`,
      )
      if (!query.ok) {
        throw new Error(`Directions request failed with status ${query.status}`)
      }

      const json = (await query.json()) as DirectionsResponse
      const data = json.routes?.[0]
      if (!data?.geometry) {
        throw new Error(json.message || "Directions response did not contain a route")
      }

      // Safety check to ensure map is loaded
      if (!map.loaded()) {
        map.once("load", () => {
          addRouteToMap(map, data)
        })
        return
      }

      addRouteToMap(map, data)
    } catch (error) {
      console.error("Error fetching directions:", error)
    }
  }

  // Separate function to add route to map
  function addRouteToMap(map: mapboxgl.Map, data: NonNullable<DirectionsResponse["routes"]>[number]) {
    try {
      // Safety check - only proceed if we have route data
      if (!data || !data.geometry) {
        console.error("Invalid route data:", data)
        return
      }

      // Remove any existing route safely
      if (map.getStyle() && map.getSource("route")) {
        try {
          map.removeLayer("route")
          map.removeSource("route")
        } catch (e) {
          console.log("Error removing existing route:", e)
          // Continue anyway - the source might not exist yet
        }
      }

      // Add route to the map
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: data.geometry,
        },
      })

      map.addLayer({
        id: "route",
        type: "line",
        source: "route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#3887be",
          "line-width": 5,
          "line-opacity": 0.75,
        },
      })
    } catch (error) {
      console.error("Error adding route to map:", error)
    }
  }

  return (
    <div ref={mapContainer} className="relative h-full w-full">
      {mapError && (
        <div
          role="alert"
          className="absolute bottom-3 left-3 right-3 z-10 rounded-md border border-destructive/30 bg-background/95 p-3 text-center text-sm text-destructive shadow"
        >
          {mapError}
        </div>
      )}
    </div>
  )
}
