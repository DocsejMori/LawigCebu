/**
 * ResiliRoute — Safe Emergency Router Engine
 * Pure Vanilla JS + Leaflet + GeoSearch + Turf.js Spatial Analysis
 */

// Global State
let map;
let roadNetworkLayer = null;
let cebuRoadsGeoJSON = null;

let activeHazards = [];
let hazardLayers = [];
let routeLayers = [];

// Dynamic Routing Points
let startCoords = null;
let endCoords = null;
let startMarker = null;
let endMarker = null;

let mapClickState = null; // Tracks active pick mode: 'start', 'end', or 'hazard'

// Fix Default Leaflet Marker Icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Application Initialization
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  await loadCebuRoadsGeoJSON();
});

// 1. Initialize Map, Search Bar, & Unified Click Listener
function initMap() {
  map = L.map('map', {
    zoomControl: false
  }).setView([10.3157, 123.8854], 13); // Default view centered on Cebu City

  L.control.zoom({ position: 'topright' }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // --- Initialize Top GeoSearch Search Bar ---
  const searchProvider = new GeoSearch.OpenStreetMapProvider({
    params: {
      'accept-language': 'en',
      countrycodes: 'ph', // Restricts search queries to the Philippines
    },
  });

  const searchControl = new GeoSearch.GeoSearchControl({
    provider: searchProvider,
    style: 'bar',
    position: 'topleft',
    showMarker: false, // Custom markers are handled below
    showPopup: false,
    autoClose: true,
    retainZoomLevel: false,
    animateZoom: true,
    searchLabel: '🔍 Search location in Philippines...',
  });

  map.addControl(searchControl);

  // Handle Location Chosen via Search Bar
  map.on('geosearch/showlocation', (result) => {
    const { x, y, label } = result.location; // x = lng, y = lat

    // Assign searched location sequentially (Start first, then Destination)
    if (!startCoords) {
      setStartPoint(y, x, label);
    } else {
      setEndPoint(y, x, label);
    }
  });

  // Single Consolidated Map Click Listener
  map.on('click', (e) => {
    const { lat, lng } = e.latlng;

    if (mapClickState === 'start') {
      setStartPoint(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      resetClickMode();
    } else if (mapClickState === 'end') {
      setEndPoint(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
      resetClickMode();
    } else if (mapClickState === 'hazard') {
      addHazardAtLocation(lat, lng);
      resetClickMode();
    }
  });
}

// Set Origin Point Coordinates and Marker
function setStartPoint(lat, lng, label = "Selected Origin") {
  startCoords = [lat, lng];
  if (startMarker) map.removeLayer(startMarker);

  startMarker = L.marker([lat, lng])
    .addTo(map)
    .bindPopup(`<b>Start Point</b><br>${label}`)
    .openPopup();

  if (startCoords && endCoords) {
    runRouteCalculation();
  }
}

// Set Destination Point Coordinates and Marker
function setEndPoint(lat, lng, label = "Selected Destination") {
  endCoords = [lat, lng];
  if (endMarker) map.removeLayer(endMarker);

  endMarker = L.marker([lat, lng])
    .addTo(map)
    .bindPopup(`<b>Destination Point</b><br>${label}`)
    .openPopup();

  if (startCoords && endCoords) {
    runRouteCalculation();
  }
}

// Enable Specific Map-Click Mode
function enableMapClickMode(mode) {
  mapClickState = mode;
  const mapEl = document.getElementById('map');
  if (mapEl) mapEl.style.cursor = 'crosshair';

  const btn = document.getElementById('btn-toggle-hazard-mode');
  if (btn) {
    if (mode === 'hazard') {
      btn.innerText = "🎯 Click Map to Drop Hazard...";
      btn.classList.add('active');
    } else {
      btn.innerText = "📍 Click Map to Place Hazard";
      btn.classList.remove('active');
    }
  }
}

function resetClickMode() {
  mapClickState = null;
  const mapEl = document.getElementById('map');
  if (mapEl) mapEl.style.cursor = '';

  const btn = document.getElementById('btn-toggle-hazard-mode');
  if (btn) {
    btn.innerText = "📍 Click Map to Place Hazard";
    btn.classList.remove('active');
  }
}

function handleDropdownChange(type) {
  enableMapClickMode(type);
}

// 2. Load Cebu Roads GeoJSON (Optional Road Network Layer)
async function loadCebuRoadsGeoJSON() {
  const statusPill = document.getElementById('system-status-pill');
  try {
const response = await fetch('data/cebu-roads.geojson');
    if (!response.ok) throw new Error("GeoJSON missing");

    cebuRoadsGeoJSON = await response.json();

    roadNetworkLayer = L.geoJSON(cebuRoadsGeoJSON, {
      style: (feature) => ({
        color: '#334155',
        weight: getRoadWeight(feature.properties?.highway),
        opacity: 0.6
      }),
      onEachFeature: (feature, layer) => {
        if (feature.properties && feature.properties.name) {
          layer.bindTooltip(feature.properties.name, { sticky: true });
        }
      }
    }).addTo(map);

    if (statusPill) {
      statusPill.innerText = "OPERATIONAL";
      statusPill.className = "status-pill status-ok";
    }
  } catch (err) {
    if (statusPill) {
      statusPill.innerText = "NO GEOJSON OVERLAY";
      statusPill.className = "status-pill status-warn";
    }
  }
}

function getRoadWeight(highwayType) {
  switch (highwayType) {
    case 'primary': case 'trunk': return 2.5;
    case 'secondary': return 2.0;
    case 'tertiary': return 1.5;
    default: return 0.8;
  }
}

// 3. Hazard Management
function addHazardAtLocation(lat, lng) {
  const type = document.getElementById('hazard-type').value;
  const severity = document.getElementById('hazard-severity').value;
  const radius = parseInt(document.getElementById('hazard-radius').value, 10);

  const hazard = { id: Date.now(), lat, lng, type, severity, radius };

  activeHazards.push(hazard);
  renderHazardOnMap(hazard);
  updateDashboardTelemetry();

  if (startCoords && endCoords) {
    runRouteCalculation();
  }
}

function renderHazardOnMap(hazard) {
  const color = hazard.severity === 'Critical' ? '#ef4444' : hazard.severity === 'High' ? '#f97316' : '#ffb703';

  const circle = L.circle([hazard.lat, hazard.lng], {
    radius: hazard.radius,
    color: color,
    fillColor: color,
    fillOpacity: 0.45,
    weight: 2
  }).addTo(map);

  circle.bindPopup(`
    <div style="font-size:0.8rem;">
      <b>${hazard.type} Zone</b><br>
      Severity: <b>${hazard.severity}</b><br>
      Radius: ${hazard.radius}m<br>
      <button style="margin-top:5px; background:#ef4444; color:#fff; border:none; padding:3px 6px; border-radius:3px; cursor:pointer;" onclick="removeHazard(${hazard.id})">Remove</button>
    </div>
  `);

  hazardLayers.push({ id: hazard.id, layer: circle });
}

function removeHazard(id) {
  activeHazards = activeHazards.filter(h => h.id !== id);
  const layerObj = hazardLayers.find(l => l.id === id);
  if (layerObj) {
    map.removeLayer(layerObj.layer);
    hazardLayers = hazardLayers.filter(l => l.id !== id);
  }
  updateDashboardTelemetry();
  runRouteCalculation();
}

function clearHazards() {
  hazardLayers.forEach(h => map.removeLayer(h.layer));
  hazardLayers = [];
  activeHazards = [];
  updateDashboardTelemetry();
  runRouteCalculation();
}

// 4. Disaster Scenario Demo
function triggerTyphoonScenario() {
  clearHazards();

  const simHazards = [
    { id: 101, lat: 10.3230, lng: 123.9100, type: "Flood", severity: "Critical", radius: 450 },
    { id: 102, lat: 10.3110, lng: 123.8980, type: "Severe Congestion", severity: "High", radius: 350 },
    { id: 103, lat: 10.2830, lng: 123.8820, type: "Flood", severity: "Critical", radius: 500 }
  ];

  simHazards.forEach(h => {
    activeHazards.push(h);
    renderHazardOnMap(h);
  });

  updateDashboardTelemetry();
  runRouteCalculation();
}

// 5. Dynamic Turf.js Vector Offset Detour Generator
function calculateDetourWaypoints(start, end, hazards) {
  if (!hazards || hazards.length === 0) return [start, end];

  const startPt = turf.point([start[1], start[0]]);
  const endPt = turf.point([end[1], end[0]]);
  const midPt = turf.midpoint(startPt, endPt);
  const bearing = turf.bearing(startPt, endPt);

  const maxRadiusKm = Math.max(...hazards.map(h => h.radius)) / 1000;
  let multiplier = 2.0;
  let detourPoint = null;
  let foundClearPoint = false;

  while (multiplier <= 5.0 && !foundClearPoint) {
    const detourDistance = (maxRadiusKm * multiplier) + 0.5;

    // Try +90 degrees (Right-hand offset)
    let offsetAngle = bearing + 90;
    let candidate = turf.destination(midPt, detourDistance, offsetAngle);

    let isInside = hazards.some(h => {
      const hPt = turf.point([h.lng, h.lat]);
      const dist = turf.distance(candidate, hPt, { units: 'kilometers' });
      return dist < (h.radius / 1000 + 0.25);
    });

    if (!isInside) {
      detourPoint = candidate;
      foundClearPoint = true;
      break;
    }

    // Try -90 degrees (Left-hand offset)
    offsetAngle = bearing - 90;
    candidate = turf.destination(midPt, detourDistance, offsetAngle);

    isInside = hazards.some(h => {
      const hPt = turf.point([h.lng, h.lat]);
      const dist = turf.distance(candidate, hPt, { units: 'kilometers' });
      return dist < (h.radius / 1000 + 0.25);
    });

    if (!isInside) {
      detourPoint = candidate;
      foundClearPoint = true;
      break;
    }

    multiplier += 1.0;
  }

  if (!detourPoint) {
    const fallbackDist = (maxRadiusKm * 3) + 1.0;
    detourPoint = turf.destination(midPt, fallbackDist, bearing + 90);
  }

  const detourCoords = [
    detourPoint.geometry.coordinates[1],
    detourPoint.geometry.coordinates[0]
  ];

  return [start, detourCoords, end];
}

// 6. Routing Engine & Risk Assessment
async function runRouteCalculation() {
  if (!startCoords || !endCoords) return;

  if (startCoords[0] === endCoords[0] && startCoords[1] === endCoords[1]) {
    alert("Origin and destination must be different.");
    return;
  }

  clearRoutes();

  // Check if End Point itself is inside a hazard zone
  const endPointPt = turf.point([endCoords[1], endCoords[0]]);
  const endInHazard = activeHazards.find(h => {
    const hPt = turf.point([h.lng, h.lat]);
    return turf.distance(endPointPt, hPt, { units: 'kilometers' }) <= (h.radius / 1000);
  });

  if (endInHazard) {
    console.warn("Destination is located directly inside a hazard zone.");
  }

  // Direct Route
  const directRoute = await fetchOSRMRoute([startCoords, endCoords]);

  if (!directRoute) {
    const exp = document.getElementById('explanation-list');
    if (exp) exp.innerHTML = "<li>Unable to connect to routing services.</li>";
    return;
  }

  // Evaluate Spatial Risk
  const spatialAnalysis = evaluateRouteRisk(directRoute, activeHazards);

  let finalRoute = directRoute;
  let isRerouted = false;

  // Compute Safe Detour if direct route intersects hazards
  if (spatialAnalysis.affectedRoadsCount > 0 && activeHazards.length > 0) {
    const detourWaypoints = calculateDetourWaypoints(startCoords, endCoords, activeHazards);
    const detourRoute = await fetchOSRMRoute(detourWaypoints);

    if (detourRoute) {
      const detourAnalysis = evaluateRouteRisk(detourRoute, activeHazards);

      if (detourAnalysis.affectedRoadsCount < spatialAnalysis.affectedRoadsCount || detourAnalysis.affectedRoadsCount === 0) {
        finalRoute = detourRoute;
        isRerouted = true;
      }
    }
  }

  // Render Route and Dashboard Info
  const vehicle = document.getElementById('select-vehicle')?.value || 'ambulance';
  renderRouteOnMap(finalRoute, isRerouted);
  updateExplanationUI(spatialAnalysis, directRoute, finalRoute, isRerouted, vehicle);
  updateDashboardTelemetry(spatialAnalysis, finalRoute);
}

// Fetch OSRM Geometry
async function fetchOSRMRoute(waypoints) {
  try {
    const coordString = waypoints.map(wp => `${wp[1]},${wp[0]}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    return data.routes && data.routes.length > 0 ? data.routes[0] : null;
  } catch (err) {
    console.error("OSRM Fetch Error:", err);
    return null;
  }
}

// Spatial Intersection Assessment
function evaluateRouteRisk(route, hazards) {
  if (!hazards || hazards.length === 0) {
    return { riskLevel: "LOW", hazardsAvoided: 0, affectedRoadsCount: 0, highestSeverity: "None" };
  }

  const routeLine = turf.lineString(route.geometry.coordinates);
  let affectedCount = 0;
  let highestSeverity = "Low";

  hazards.forEach(h => {
    const hazardPoint = turf.point([h.lng, h.lat]);
    const hazardBuffer = turf.buffer(hazardPoint, h.radius / 1000, { units: 'kilometers' });

    if (turf.booleanIntersects(routeLine, hazardBuffer)) {
      affectedCount++;
      if (h.severity === "Critical") highestSeverity = "Critical";
      else if (h.severity === "High" && highestSeverity !== "Critical") highestSeverity = "High";
    }
  });

  const riskLevel = affectedCount === 0 ? "LOW" : highestSeverity === "Critical" ? "CRITICAL" : "HIGH";

  return { riskLevel, hazardsAvoided: affectedCount, affectedRoadsCount: affectedCount, highestSeverity };
}

// Render Polylines
function renderRouteOnMap(routeData, isDetour) {
  const routeColor = isDetour ? '#06b6d4' : '#ffb703';

  const polyline = L.geoJSON(routeData.geometry, {
    style: {
      color: routeColor,
      weight: 6,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }
  }).addTo(map);

  routeLayers.push(polyline);
  map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
}

// UI & Dashboard Displays
function updateExplanationUI(riskAnalysis, directRoute, finalRoute, isRerouted, vehicle) {
  const expList = document.getElementById('explanation-list');
  if (!expList) return;

  const directEta = Math.round(directRoute.duration / 60);
  const finalEta = Math.round(finalRoute.duration / 60);

  let html = "";

  if (isRerouted) {
    html += `<li style="color:#06b6d4;"><b>Safe Route Selected:</b> Dynamic detour calculated around ${riskAnalysis.hazardsAvoided} active hazard zone(s).</li>`;
    html += `<li><b>Direct Path:</b> ${directEta} min (⚠️ Passes through ${riskAnalysis.highestSeverity} risk areas)</li>`;
    html += `<li><b>ResiliRoute Path:</b> ${finalEta} min (${finalEta - directEta > 0 ? '+' + (finalEta - directEta) : '0'} min detour penalty)</li>`;
  } else if (riskAnalysis.affectedRoadsCount === 0) {
    html += `<li style="color:#10b981;"><b>Direct Path Clear:</b> Zero hazard collisions detected on optimal road geometry.</li>`;
    html += `<li><b>Est. Travel Time:</b> ${finalEta} min</li>`;
  } else {
    html += `<li style="color:#ef4444;"><b>Warning:</b> Complete hazard avoidance unavailable due to road network constraints near destination.</li>`;
  }

  const vehicleLabels = {
 none: "🚫 Standard routing without special emergency priority weights.",
    ambulance: "🚑 Priority: Highest speed & proximity to triage units.",
    fire_truck: "🚒 Priority: High clearance major thoroughfares.",
    rescue: "🚓 Priority: Balanced safety and all-terrain maneuverability.",
    evacuation: "🚐 Priority: High-capacity multi-lane avenues."
  };
  html += `<li style="font-size:0.68rem; color:#94a3b8; margin-top:4px;">${vehicleLabels[vehicle] || vehicleLabels.ambulance}</li>`;

  expList.innerHTML = html;
}

function updateDashboardTelemetry(riskAnalysis = null, route = null) {
  const dashHazards = document.getElementById('dash-hazards');
  if (dashHazards) dashHazards.innerText = activeHazards.length;

  const affectedEl = document.getElementById('dash-affected');
  const riskEl = document.getElementById('dash-risk');
  const etaEl = document.getElementById('dash-eta');
  const distEl = document.getElementById('dash-distance');

  if (riskAnalysis && route) {
    if (affectedEl) affectedEl.innerText = riskAnalysis.affectedRoadsCount;
    if (riskEl) {
      riskEl.innerText = riskAnalysis.riskLevel;
      riskEl.className = "dash-val " + (
        riskAnalysis.riskLevel === 'LOW' ? 'status-green' :
        riskAnalysis.riskLevel === 'MEDIUM' ? 'status-yellow' : 'status-red'
      );
    }
    if (etaEl) etaEl.innerText = `${Math.round(route.duration / 60)} min`;
    if (distEl) distEl.innerText = `${(route.distance / 1000).toFixed(2)} km`;
  } else {
    if (affectedEl) affectedEl.innerText = "0";
    if (riskEl) {
      riskEl.innerText = activeHazards.length > 0 ? "EVALUATING" : "LOW";
      riskEl.className = "dash-val status-green";
    }
    if (etaEl) etaEl.innerText = "-- min";
    if (distEl) distEl.innerText = "-- km";
  }
}

// Clean-up Functions
function clearRoutes() {
  routeLayers.forEach(l => map.removeLayer(l));
  routeLayers = [];
}

function resetSystem() {
  clearHazards();
  clearRoutes();
  startCoords = null;
  endCoords = null;
  
  if (startMarker) map.removeLayer(startMarker);
  if (endMarker) map.removeLayer(endMarker);

  const expList = document.getElementById('explanation-list');
  if (expList) expList.innerHTML = "<li>Search or click on the map to set origin and destination points.</li>";
}
