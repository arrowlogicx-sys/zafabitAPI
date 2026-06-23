const axios = require('axios');

const TRACKING_ROUTE_REFRESH_MS = 60000;
const TRACKING_ROUTE_REFRESH_DISPLACEMENT_METERS = 100;

/**
 * Calculates the straight-line distance between two points on Earth in meters using the Haversine formula.
 */
const getDistance = (lat1, lon1, lat2, lon2) => {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined)
    return Infinity;

  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
};

/**
 * Calculates the recommended next update interval based on distance to destination.
 * This helps save battery on the Maid's device.
 */
const getAdaptiveInterval = (distanceInMeters) => {
  if (distanceInMeters > 5000) return 60000; // > 5km: every 60s
  if (distanceInMeters > 2000) return 30000; // 2km - 5km: every 30s
  if (distanceInMeters > 500) return 15000; // 500m - 2km: every 15s
  return 5000; // < 500m: every 5s
};

const normalizePoint = (point) => {
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return { lat, lng };
};

const getEtaMinutes = (durationSeconds) => {
  if (!Number.isFinite(durationSeconds)) return null;
  return Math.max(1, Math.ceil(durationSeconds / 60));
};

const shouldRefreshTrackingRoute = (cacheEntry = {}, origin, options = {}) => {
  const currentOrigin = normalizePoint(origin);
  if (!currentOrigin) {
    return false;
  }

  const now = options.now || Date.now();
  const refreshMs = options.refreshMs || TRACKING_ROUTE_REFRESH_MS;
  const displacementMeters =
    options.displacementMeters || TRACKING_ROUTE_REFRESH_DISPLACEMENT_METERS;
  const previousOrigin = normalizePoint(cacheEntry.lastRouteOrigin);
  const lastLookupAt = cacheEntry.lastRouteLookupAt
    ? new Date(cacheEntry.lastRouteLookupAt).getTime()
    : 0;

  if (
    !cacheEntry.lastRouteMetrics ||
    !previousOrigin ||
    !lastLookupAt ||
    Number.isNaN(lastLookupAt)
  ) {
    return true;
  }

  if (now - lastLookupAt >= refreshMs) {
    return true;
  }

  return (
    getDistance(previousOrigin.lat, previousOrigin.lng, currentOrigin.lat, currentOrigin.lng) >=
    displacementMeters
  );
};

/**
 * Calculates the real-world road distance and travel duration between two coordinates using Google Distance Matrix API.
 * Falls back to Haversine straight-line calculations if the API fails or key is missing.
 *
 * @param {number} lat1 Origin latitude
 * @param {number} lon1 Origin longitude
 * @param {number} lat2 Destination latitude
 * @param {number} lon2 Destination longitude
 * @returns {Promise<{ distanceMeters: number, durationSeconds: number, source: 'google' | 'haversine' }>}
 */
const getRoadDistance = async (lat1, lon1, lat2, lon2) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey || apiKey.trim() === '' || apiKey.includes('YOUR_')) {
    const straightDistance = Math.round(getDistance(lat1, lon1, lat2, lon2));
    return {
      distanceMeters: straightDistance,
      durationSeconds: Math.max(180, Math.round(straightDistance / 8)), // ~30 km/h average speed in city
      source: 'haversine',
    };
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${lat1},${lon1}&destinations=${lat2},${lon2}&mode=driving&key=${apiKey}`;
    const response = await axios.get(url);

    if (
      response.data &&
      response.data.status === 'OK' &&
      response.data.rows[0]?.elements[0]?.status === 'OK'
    ) {
      const element = response.data.rows[0].elements[0];
      return {
        distanceMeters: element.distance.value, // distance in meters
        durationSeconds: element.duration.value, // duration in seconds
        source: 'google',
      };
    }
    throw new Error(response.data.status || 'No route found');
  } catch (error) {
    console.error('Google Distance Matrix API error, falling back to Haversine:', error.message);
    const straightDistance = Math.round(getDistance(lat1, lon1, lat2, lon2));
    return {
      distanceMeters: straightDistance,
      durationSeconds: Math.max(180, Math.round(straightDistance / 8)),
      source: 'haversine',
    };
  }
};

const sumRouteLegValues = (legs, field, nestedField = 'value') => {
  if (!Array.isArray(legs)) return null;

  const values = legs.map((leg) => Number(leg?.[field]?.[nestedField])).filter(Number.isFinite);

  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0);
};

const getDirectionsRoute = async (origin, destination) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const normalizedOrigin = normalizePoint(origin);
  const normalizedDestination = normalizePoint(destination);

  if (
    !normalizedOrigin ||
    !normalizedDestination ||
    !apiKey ||
    apiKey.trim() === '' ||
    apiKey.includes('YOUR_')
  ) {
    return null;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${normalizedOrigin.lat},${normalizedOrigin.lng}&destination=${normalizedDestination.lat},${normalizedDestination.lng}&mode=driving&departure_time=now&key=${apiKey}`;
    const response = await axios.get(url);
    const route = response.data?.routes?.[0];

    if (response.data?.status !== 'OK' || !route) {
      throw new Error(response.data?.status || 'No route found');
    }

    const legs = route.legs || [];
    const distanceMeters = sumRouteLegValues(legs, 'distance');
    const durationSeconds =
      sumRouteLegValues(legs, 'duration_in_traffic') || sumRouteLegValues(legs, 'duration');
    const routePolyline = route.overview_polyline?.points || null;

    if (!routePolyline || !Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) {
      throw new Error('Incomplete route geometry');
    }

    return {
      distanceMeters,
      durationSeconds,
      routePolyline,
      source: 'google_directions',
      routeSource: 'google_directions',
    };
  } catch (error) {
    console.error('Google Directions API error, falling back to Distance Matrix:', error.message);
    return null;
  }
};

/**
 * Batch gets the real-world road distance and durations for multiple origins to a single destination.
 * This performs a single request to the Google API which is highly cost-effective and faster.
 *
 * @param {Array<{lat: number, lng: number}>} origins Array of origin coordinates
 * @param {{lat: number, lng: number}} destination Destination coordinate
 * @returns {Promise<Array<{ distanceMeters: number, durationSeconds: number, source: 'google' | 'haversine' }>>}
 */
const getBatchRoadDistance = async (origins, destination) => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!origins || origins.length === 0 || !destination) {
    return [];
  }

  const generateFallbacks = () => {
    return origins.map((orig) => {
      const straightDistance = Math.round(
        getDistance(orig.lat, orig.lng, destination.lat, destination.lng),
      );
      return {
        distanceMeters: straightDistance,
        durationSeconds: Math.max(180, Math.round(straightDistance / 8)),
        source: 'haversine',
      };
    });
  };

  if (!apiKey || apiKey.trim() === '' || apiKey.includes('YOUR_')) {
    return generateFallbacks();
  }

  try {
    const originsParam = origins.map((o) => `${o.lat},${o.lng}`).join('|');
    const destinationParam = `${destination.lat},${destination.lng}`;

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originsParam}&destinations=${destinationParam}&mode=driving&key=${apiKey}`;
    const response = await axios.get(url);

    if (response.data && response.data.status === 'OK') {
      const results = [];
      const row = response.data.rows; // google returns a row for each origin

      for (let i = 0; i < origins.length; i++) {
        const element = row[i]?.elements[0];
        if (element && element.status === 'OK') {
          results.push({
            distanceMeters: element.distance.value,
            durationSeconds: element.duration.value,
            source: 'google',
          });
        } else {
          // Individual coordinate routing error
          const straightDistance = Math.round(
            getDistance(origins[i].lat, origins[i].lng, destination.lat, destination.lng),
          );
          results.push({
            distanceMeters: straightDistance,
            durationSeconds: Math.max(180, Math.round(straightDistance / 8)),
            source: 'haversine',
          });
        }
      }
      return results;
    }
    throw new Error(response.data.status || 'Response not OK');
  } catch (error) {
    console.error('Google Batch Distance Matrix error, using Haversine fallbacks:', error.message);
    return generateFallbacks();
  }
};

/**
 * Returns tracking metrics for a moving maid and refreshes Google route data
 * only when the previous lookup is stale or the maid has moved enough.
 */
const getTrackingMetrics = async ({
  origin,
  destination,
  cacheEntry = {},
  forceRefresh = false,
  refreshMs = TRACKING_ROUTE_REFRESH_MS,
  displacementMeters = TRACKING_ROUTE_REFRESH_DISPLACEMENT_METERS,
} = {}) => {
  const normalizedOrigin = normalizePoint(origin);
  const normalizedDestination = normalizePoint(destination);

  if (!normalizedOrigin || !normalizedDestination) {
    return {
      distanceMeters: null,
      durationSeconds: null,
      etaMinutes: null,
      nextInterval: getAdaptiveInterval(Number.POSITIVE_INFINITY),
      source: 'unavailable',
      routeSource: 'unavailable',
      routePolyline: null,
      straightDistanceMeters: null,
      refreshed: false,
      cacheEntry,
    };
  }

  const straightDistanceMeters = Math.round(
    getDistance(
      normalizedOrigin.lat,
      normalizedOrigin.lng,
      normalizedDestination.lat,
      normalizedDestination.lng,
    ),
  );

  let routeMetrics = cacheEntry.lastRouteMetrics || null;
  let refreshed = false;

  if (
    forceRefresh ||
    shouldRefreshTrackingRoute(cacheEntry, normalizedOrigin, {
      refreshMs,
      displacementMeters,
    })
  ) {
    routeMetrics = await getDirectionsRoute(normalizedOrigin, normalizedDestination);

    if (!routeMetrics) {
      const fallbackMetrics = await getRoadDistance(
        normalizedOrigin.lat,
        normalizedOrigin.lng,
        normalizedDestination.lat,
        normalizedDestination.lng,
      );
      routeMetrics = {
        ...fallbackMetrics,
        routePolyline: null,
        routeSource: fallbackMetrics.source,
      };
    }
    refreshed = true;
  }

  if (!routeMetrics) {
    routeMetrics = {
      distanceMeters: straightDistanceMeters,
      durationSeconds: Math.max(180, Math.round(straightDistanceMeters / 8)),
      routePolyline: null,
      source: 'haversine',
      routeSource: 'haversine',
    };
  }

  const distanceMeters = Number.isFinite(routeMetrics.distanceMeters)
    ? routeMetrics.distanceMeters
    : straightDistanceMeters;
  const durationSeconds = Number.isFinite(routeMetrics.durationSeconds)
    ? routeMetrics.durationSeconds
    : Math.max(180, Math.round(distanceMeters / 8));

  return {
    distanceMeters,
    durationSeconds,
    etaMinutes: getEtaMinutes(durationSeconds),
    nextInterval: getAdaptiveInterval(distanceMeters),
    source: routeMetrics.source || 'haversine',
    routeSource: routeMetrics.routeSource || routeMetrics.source || 'haversine',
    routePolyline:
      routeMetrics.routeSource === 'google_directions' ? routeMetrics.routePolyline || null : null,
    straightDistanceMeters,
    refreshed,
    cacheEntry: refreshed
      ? {
          ...cacheEntry,
          lastRouteMetrics: routeMetrics,
          lastRouteLookupAt: new Date(),
          lastRouteOrigin: normalizedOrigin,
        }
      : cacheEntry,
  };
};

module.exports = {
  getDistance,
  getAdaptiveInterval,
  getRoadDistance,
  getDirectionsRoute,
  getBatchRoadDistance,
  getTrackingMetrics,
  shouldRefreshTrackingRoute,
  TRACKING_ROUTE_REFRESH_MS,
  TRACKING_ROUTE_REFRESH_DISPLACEMENT_METERS,
};
