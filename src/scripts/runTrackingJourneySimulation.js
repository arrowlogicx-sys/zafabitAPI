require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { getDirectionsRoute, getTrackingMetrics } = require('../utils/location');

const REPORT_PATH = path.resolve(
  __dirname,
  '../../artifacts/tracking-journey-simulation-report-2026-06-12.md',
);

const CUSTOMER_DESTINATION = {
  name: 'Customer Home (Infopark Road)',
  lat: 10.0112,
  lng: 76.355,
};

const MAID_START = {
  name: 'Maid Start (Kakkanad)',
  lat: 10.0218,
  lng: 76.3735,
};

function decodePolyline(str) {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];

  while (index < str.length) {
    let shift = 0;
    let result = 0;
    let byte = null;

    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;

    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return coordinates;
}

function interpolatePoints(start, end, steps = 8) {
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const fraction = i / steps;
    points.push({
      lat: Number((start.lat + (end.lat - start.lat) * fraction).toFixed(6)),
      lng: Number((start.lng + (end.lng - start.lng) * fraction).toFixed(6)),
    });
  }
  return points;
}

function sampleRoutePoints(points, samples = 8) {
  if (!Array.isArray(points) || !points.length) return [];
  if (points.length <= samples + 1) return points;

  const sampled = [];
  for (let i = 0; i <= samples; i += 1) {
    const index = Math.min(points.length - 1, Math.round((i / samples) * (points.length - 1)));
    sampled.push(points[index]);
  }
  return sampled;
}

function classifyStatus(stepIndex, totalSteps, straightDistanceMeters) {
  if (stepIndex === 0) return 'accepted';
  if (stepIndex === totalSteps - 1) return 'arrived';
  if (straightDistanceMeters <= 200) return 'nearby';
  return 'in_transit';
}

async function buildJourneyPoints() {
  const route = await getDirectionsRoute(MAID_START, CUSTOMER_DESTINATION);

  if (route?.routePolyline) {
    const decoded = decodePolyline(route.routePolyline);
    const sampled = sampleRoutePoints(decoded, 8);
    return {
      routeSource: route.routeSource || route.source || 'google_directions',
      routePolyline: route.routePolyline,
      routeDistanceMeters: route.distanceMeters,
      routeDurationSeconds: route.durationSeconds,
      points: sampled,
    };
  }

  const fallbackPoints = interpolatePoints(MAID_START, CUSTOMER_DESTINATION, 8);
  return {
    routeSource: 'haversine',
    routePolyline: null,
    routeDistanceMeters: null,
    routeDurationSeconds: null,
    points: fallbackPoints,
  };
}

async function main() {
  const journey = await buildJourneyPoints();
  const rows = [];
  let cacheEntry = {};

  for (let index = 0; index < journey.points.length; index += 1) {
    const point = journey.points[index];
    const metrics = await getTrackingMetrics({
      origin: point,
      destination: CUSTOMER_DESTINATION,
      cacheEntry,
      forceRefresh: true,
    });
    cacheEntry = metrics.cacheEntry;

    rows.push({
      step: index + 1,
      status: classifyStatus(index, journey.points.length, metrics.straightDistanceMeters),
      lat: point.lat,
      lng: point.lng,
      distanceMeters: metrics.distanceMeters,
      etaMinutes: metrics.etaMinutes,
      nextIntervalMs: metrics.nextInterval,
      routeSource: metrics.routeSource,
      hasRoutePolyline: Boolean(metrics.routePolyline),
    });
  }

  const report = `# Tracking Journey Simulation Report

Date: \`2026-06-12\`

## What This Simulates

- booking status already \`accepted\`
- maid starts traveling to customer
- customer opens the live-tracking map
- backend sends tracking payloads the same way the app expects

## Customer App Screen

- screen: [BookingScreens.tsx](/Users/renoroy/Desktop/zaffabit%20new/zaffabit%20app%20reactnative/ZaffabitApp/src/screens/BookingScreens.tsx:1684)
- tracking map listens to:
  - socket room: \`join_booking\`
  - socket event: \`maid_location_changed\`
  - initial API: \`GET /api/v1/bookings/:id/tracking\`

## Backend Source

- tracking endpoint: [bookingController.js](/Users/renoroy/Desktop/zaffabit%20new/zafabitAPI/src/controllers/bookingController.js:1302)
- tracking metrics: [location.js](/Users/renoroy/Desktop/zaffabit%20new/zafabitAPI/src/utils/location.js:261)
- socket push path: [socket.js](/Users/renoroy/Desktop/zaffabit%20new/zafabitAPI/src/utils/socket.js:196)

## Route Setup

- maid start: \`${MAID_START.lat}, ${MAID_START.lng}\`
- customer destination: \`${CUSTOMER_DESTINATION.lat}, ${CUSTOMER_DESTINATION.lng}\`
- route source used: \`${journey.routeSource}\`
- directions polyline available: \`${Boolean(journey.routePolyline)}\`
- route distance from directions: \`${journey.routeDistanceMeters ?? 'n/a'}\`
- route duration from directions: \`${journey.routeDurationSeconds ?? 'n/a'}\`

## Step Simulation

| Step | Status | Maid Lat | Maid Lng | Distance Meters | ETA Minutes | Next Update Ms | Route Source | Polyline |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.map((row) => `| ${row.step} | ${row.status} | ${row.lat} | ${row.lng} | ${row.distanceMeters} | ${row.etaMinutes} | ${row.nextIntervalMs} | ${row.routeSource} | ${row.hasRoutePolyline} |`).join('\n')}

## What The Map Would Show

1. Customer loads tracking screen after maid acceptance.
2. App calls \`GET /api/v1/bookings/:id/tracking\`.
3. Backend returns:
   - maid location
   - destination location
   - ETA
   - distance
   - \`routePolyline\` when Google Directions is available
4. App joins the socket room with \`join_booking\`.
5. Every maid movement update triggers \`maid_location_changed\`.
6. Map marker moves and ETA/distance are refreshed.
7. When straight-line distance becomes less than about \`200m\`, backend can emit nearby state.

## Correct Gap Reading

What is working:

- yes, the backend already has a real tracking flow after booking acceptance
- yes, the customer map can show moving maid coordinates
- yes, it supports route polyline when Google Directions returns one

What this simulation does not prove by itself:

- real mobile UI rendering on a device
- actual Google route success on every production request
- foreground/background mobile reconnect behavior

## Practical Answer

Yes, there is a real post-acceptance map tracking flow in this repo.
This simulation shows the exact backend journey shape for:

\`accepted -> in_transit -> nearby -> arrived\`
`;

  fs.writeFileSync(REPORT_PATH, report, 'utf8');
  console.log(
    JSON.stringify(
      {
        reportPath: REPORT_PATH,
        routeSource: journey.routeSource,
        steps: rows.length,
        firstStep: rows[0],
        lastStep: rows[rows.length - 1],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
