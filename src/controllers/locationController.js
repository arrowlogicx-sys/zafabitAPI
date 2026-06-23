const axios = require('axios');
const { sendResponse } = require('../utils/apiResponse');

// Standard bounding box for Kochi service area
const KOCHI_MIN_LAT = 9.85;
const KOCHI_MAX_LAT = 10.15;
const KOCHI_MIN_LNG = 76.15;
const KOCHI_MAX_LNG = 76.45;

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

// ─── Helper: try Google Places Autocomplete ──────────────────────────────────
async function searchViaGooglePlaces(query) {
  const url = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
  const acRes = await axios.get(url, {
    params: {
      input: query,
      key: GOOGLE_MAPS_API_KEY,
      components: 'country:in',
      location: '9.9816,76.3213',
      radius: 50000,
      types: 'geocode',
      language: 'en',
    },
    timeout: 6000,
  });

  if (acRes.data?.status !== 'OK') {
    throw new Error(`Google Places status: ${acRes.data?.status}`);
  }

  const predictions = acRes.data.predictions || [];

  const results = await Promise.all(
    predictions.slice(0, 5).map(async (p) => {
      try {
        const detailsRes = await axios.get(
          'https://maps.googleapis.com/maps/api/place/details/json',
          {
            params: {
              place_id: p.place_id,
              key: GOOGLE_MAPS_API_KEY,
              fields: 'geometry,address_components,formatted_address',
              language: 'en',
            },
            timeout: 5000,
          },
        );
        const place = detailsRes.data?.result;
        if (!place?.geometry) return null;

        const comps = place.address_components || [];
        const get = (type) => comps.find((c) => c.types.includes(type))?.long_name || '';

        const lat = place.geometry.location.lat;
        const lng = place.geometry.location.lng;

        // Filter to Kochi service area only (with a small 5 km buffer)
        if (
          lat < KOCHI_MIN_LAT - 0.05 ||
          lat > KOCHI_MAX_LAT + 0.05 ||
          lng < KOCHI_MIN_LNG - 0.05 ||
          lng > KOCHI_MAX_LNG + 0.05
        ) {
          return null;
        }

        return {
          place_id: p.place_id,
          label: place.formatted_address || p.description,
          area:
            get('sublocality_level_1') ||
            get('sublocality') ||
            get('neighborhood') ||
            get('locality') ||
            p.structured_formatting?.main_text ||
            '',
          city: get('locality') || get('administrative_area_level_2') || '',
          pincode: get('postal_code') || '',
          lat,
          lon: lng,
        };
      } catch {
        return null;
      }
    }),
  );

  return results.filter(Boolean);
}

// ─── Helper: Nominatim (OpenStreetMap) — no API key needed ───────────────────
async function searchViaNominatim(query) {
  const url = 'https://nominatim.openstreetmap.org/search';
  const res = await axios.get(url, {
    params: {
      q: `${query}, Kerala, India`,
      format: 'json',
      addressdetails: 1,
      limit: 6,
      countrycodes: 'in',
      'accept-language': 'en',
    },
    headers: { 'User-Agent': 'ZaffabitApp/1.0 (contact@zaffabit.com)' },
    timeout: 6000,
  });

  return (res.data || [])
    .filter((item) => {
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      // Only return results inside or near Kochi service area (with small buffer)
      return (
        lat >= KOCHI_MIN_LAT - 0.1 &&
        lat <= KOCHI_MAX_LAT + 0.1 &&
        lon >= KOCHI_MIN_LNG - 0.1 &&
        lon <= KOCHI_MAX_LNG + 0.1
      );
    })
    .map((item) => {
      const addr = item.address || {};
      const area =
        addr.suburb ||
        addr.neighbourhood ||
        addr.quarter ||
        addr.city_district ||
        addr.town ||
        addr.village ||
        addr.city ||
        '';
      const city = addr.city || addr.town || addr.county || 'Kochi';
      const pincode = addr.postcode || '';

      return {
        place_id: item.place_id,
        label: item.display_name,
        area,
        city,
        pincode,
        lat: parseFloat(item.lat),
        lon: parseFloat(item.lon),
      };
    });
}

// ─── Helper: reverse geocode via Nominatim ───────────────────────────────────
async function reverseGeocodeNominatim(lat, lon) {
  const url = 'https://nominatim.openstreetmap.org/reverse';
  const res = await axios.get(url, {
    params: { lat, lon, format: 'json', addressdetails: 1 },
    headers: { 'User-Agent': 'ZaffabitApp/1.0 (contact@zaffabit.com)' },
    timeout: 5000,
  });
  const addr = res.data?.address || {};
  return {
    area:
      addr.suburb ||
      addr.neighbourhood ||
      addr.quarter ||
      addr.city_district ||
      addr.town ||
      addr.village ||
      addr.city ||
      'Kochi',
    city: addr.city || addr.town || addr.county || 'Kochi',
    pincode: addr.postcode || '',
  };
}

// ─── Helper: reverse geocode via Google Geocoding ───────────────────────────
async function reverseGeocodeGoogle(lat, lon) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json';
  const res = await axios.get(url, {
    params: {
      latlng: `${lat},${lon}`,
      key: GOOGLE_MAPS_API_KEY,
      language: 'en',
      result_type: 'sublocality|locality',
    },
    timeout: 5000,
  });

  if (res.data?.status !== 'OK') throw new Error(`Geocode status: ${res.data?.status}`);

  const comps = res.data.results?.[0]?.address_components || [];
  const get = (type) => comps.find((c) => c.types.includes(type))?.long_name || '';

  return {
    area:
      get('sublocality_level_1') ||
      get('sublocality') ||
      get('neighborhood') ||
      get('locality') ||
      'Kochi',
    city: get('locality') || get('administrative_area_level_2') || 'Kochi',
    pincode: get('postal_code') || '',
  };
}

/**
 * @desc    Search for location suggestions
 *          Primary:  Google Places Autocomplete API (if key has Places enabled)
 *          Fallback: Nominatim (OpenStreetMap) — works without API key
 * @route   GET /api/v1/locations/search?q=<query>
 * @access  Protected
 */
exports.searchLocations = async (req, res, next) => {
  try {
    const query = String(req.query.q || '').trim();

    if (!query) {
      return sendResponse(res, 200, 'Locations retrieved', []);
    }

    let results = [];

    // Try Google Places first (requires Places API enabled on the key)
    if (GOOGLE_MAPS_API_KEY) {
      try {
        results = await searchViaGooglePlaces(query);
        console.log(
          `[Location Search] Google Places returned ${results.length} results for "${query}"`,
        );
      } catch (googleErr) {
        console.warn(
          '[Location Search] Google Places failed, falling back to Nominatim:',
          googleErr.message,
        );
      }
    }

    // Fallback to Nominatim if Google returned nothing or errored
    if (results.length === 0) {
      try {
        results = await searchViaNominatim(query);
        console.log(
          `[Location Search] Nominatim returned ${results.length} results for "${query}"`,
        );
      } catch (nominatimErr) {
        console.warn('[Location Search] Nominatim also failed:', nominatimErr.message);
      }
    }

    return sendResponse(res, 200, 'Locations retrieved', results);
  } catch (error) {
    console.error('[Location Search] Unexpected error:', error.message);
    next(error);
  }
};

/**
 * @desc    Check if a coordinate or pincode is within Zaffabit service area.
 *          Reverse-geocodes the pin drop to get a real neighbourhood name.
 * @route   GET /api/v1/locations/serviceability?lat=&lon=&pincode=
 * @access  Protected
 */
exports.checkServiceability = async (req, res, next) => {
  try {
    const { lat, lon, pincode } = req.query;

    let serviceable = false;
    let detectedArea = 'Kochi';
    let detectedCity = 'Kochi';
    let detectedPincode = pincode || '';

    // ── Coordinate-based check ───────────────────────────────────────────────
    if (lat && lon) {
      const latitude = parseFloat(lat);
      const longitude = parseFloat(lon);

      if (
        latitude >= KOCHI_MIN_LAT &&
        latitude <= KOCHI_MAX_LAT &&
        longitude >= KOCHI_MIN_LNG &&
        longitude <= KOCHI_MAX_LNG
      ) {
        serviceable = true;

        // Try Google Geocoding first, then Nominatim as fallback
        if (GOOGLE_MAPS_API_KEY) {
          try {
            const geo = await reverseGeocodeGoogle(latitude, longitude);
            detectedArea = geo.area;
            detectedCity = geo.city;
            detectedPincode = geo.pincode || detectedPincode;
          } catch {
            try {
              const geo = await reverseGeocodeNominatim(latitude, longitude);
              detectedArea = geo.area;
              detectedCity = geo.city;
              detectedPincode = geo.pincode || detectedPincode;
            } catch (nominatimErr) {
              console.warn('[Serviceability] All reverse geocoding failed:', nominatimErr.message);
            }
          }
        } else {
          try {
            const geo = await reverseGeocodeNominatim(latitude, longitude);
            detectedArea = geo.area;
            detectedCity = geo.city;
            detectedPincode = geo.pincode || detectedPincode;
          } catch (nominatimErr) {
            console.warn(
              '[Serviceability] Nominatim reverse geocoding failed:',
              nominatimErr.message,
            );
          }
        }
      }

      // ── Pincode-based check ──────────────────────────────────────────────────
    } else if (pincode) {
      const pinStr = String(pincode).trim();
      if (pinStr.startsWith('682') || pinStr.startsWith('683')) {
        serviceable = true;
        detectedPincode = pinStr;

        // Geocode the pincode to get the area name
        try {
          const geoRes = await axios.get('https://nominatim.openstreetmap.org/search', {
            params: {
              postalcode: pinStr,
              country: 'India',
              format: 'json',
              addressdetails: 1,
              limit: 1,
            },
            headers: { 'User-Agent': 'ZaffabitApp/1.0 (contact@zaffabit.com)' },
            timeout: 5000,
          });

          const item = geoRes.data?.[0];
          if (item) {
            const addr = item.address || {};
            detectedArea =
              addr.suburb || addr.neighbourhood || addr.city_district || addr.city || 'Kochi';
            detectedCity = addr.city || addr.town || 'Kochi';
          }
        } catch (err) {
          console.warn('[Serviceability] Pincode geocode failed:', err.message);
        }
      }
    }

    return sendResponse(res, 200, 'Serviceability check complete', {
      serviceable,
      area: detectedArea,
      city: detectedCity,
      pincode: detectedPincode,
    });
  } catch (error) {
    console.error('[Serviceability] Unexpected error:', error.message);
    next(error);
  }
};
