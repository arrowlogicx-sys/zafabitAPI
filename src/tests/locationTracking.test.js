jest.mock('axios', () => ({
  get: jest.fn(),
}));

const axios = require('axios');
const { getTrackingMetrics, TRACKING_ROUTE_REFRESH_MS } = require('../utils/location');

describe('tracking route metrics', () => {
  const destination = { lat: 9.98, lng: 76.32 };
  const googleDirectionsResponse = ({
    distanceMeters,
    durationSeconds,
    routePolyline = 'encoded_polyline',
  }) => ({
    data: {
      status: 'OK',
      routes: [
        {
          overview_polyline: { points: routePolyline },
          legs: [
            {
              distance: { value: distanceMeters },
              duration: { value: durationSeconds },
            },
          ],
        },
      ],
    },
  });

  const googleDistanceMatrixResponse = ({ distanceMeters, durationSeconds }) => ({
    data: {
      status: 'OK',
      rows: [
        {
          elements: [
            {
              status: 'OK',
              distance: { value: distanceMeters },
              duration: { value: durationSeconds },
            },
          ],
        },
      ],
    },
  });

  beforeEach(() => {
    axios.get.mockReset();
    process.env.GOOGLE_MAPS_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  it('reuses cached Google route data until the maid moves more than 100 meters', async () => {
    axios.get
      .mockResolvedValueOnce(
        googleDirectionsResponse({ distanceMeters: 1500, durationSeconds: 420 }),
      )
      .mockResolvedValueOnce(
        googleDirectionsResponse({
          distanceMeters: 1300,
          durationSeconds: 360,
          routePolyline: 'new_encoded_polyline',
        }),
      );

    const first = await getTrackingMetrics({
      origin: { lat: 9.97, lng: 76.3 },
      destination,
      forceRefresh: true,
    });
    expect(first.refreshed).toBe(true);
    expect(first.distanceMeters).toBe(1500);
    expect(first.etaMinutes).toBe(7);
    expect(first.routePolyline).toBe('encoded_polyline');
    expect(first.routeSource).toBe('google_directions');
    expect(axios.get).toHaveBeenCalledTimes(1);

    const cached = await getTrackingMetrics({
      origin: { lat: 9.9703, lng: 76.3003 },
      destination,
      cacheEntry: first.cacheEntry,
    });
    expect(cached.refreshed).toBe(false);
    expect(cached.distanceMeters).toBe(1500);
    expect(cached.etaMinutes).toBe(7);
    expect(cached.routePolyline).toBe('encoded_polyline');
    expect(axios.get).toHaveBeenCalledTimes(1);

    const movedFarEnough = await getTrackingMetrics({
      origin: { lat: 9.972, lng: 76.302 },
      destination,
      cacheEntry: first.cacheEntry,
    });
    expect(movedFarEnough.refreshed).toBe(true);
    expect(movedFarEnough.distanceMeters).toBe(1300);
    expect(movedFarEnough.etaMinutes).toBe(6);
    expect(movedFarEnough.routePolyline).toBe('new_encoded_polyline');
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('refreshes cached Google route data after 60 seconds even if the maid barely moved', async () => {
    axios.get
      .mockResolvedValueOnce(
        googleDirectionsResponse({ distanceMeters: 1700, durationSeconds: 540 }),
      )
      .mockResolvedValueOnce(
        googleDirectionsResponse({ distanceMeters: 1600, durationSeconds: 480 }),
      );

    const first = await getTrackingMetrics({
      origin: { lat: 9.97, lng: 76.3 },
      destination,
      forceRefresh: true,
    });
    expect(axios.get).toHaveBeenCalledTimes(1);

    const staleCache = {
      ...first.cacheEntry,
      lastRouteLookupAt: new Date(Date.now() - TRACKING_ROUTE_REFRESH_MS - 1000),
    };

    const refreshed = await getTrackingMetrics({
      origin: { lat: 9.9701, lng: 76.3001 },
      destination,
      cacheEntry: staleCache,
    });
    expect(refreshed.refreshed).toBe(true);
    expect(refreshed.distanceMeters).toBe(1600);
    expect(refreshed.etaMinutes).toBe(8);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('falls back to Distance Matrix when Google Directions route geometry fails', async () => {
    axios.get
      .mockRejectedValueOnce(new Error('directions unavailable'))
      .mockResolvedValueOnce(
        googleDistanceMatrixResponse({ distanceMeters: 1400, durationSeconds: 300 }),
      );
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const metrics = await getTrackingMetrics({
      origin: { lat: 9.97, lng: 76.3 },
      destination,
      forceRefresh: true,
    });

    expect(metrics.refreshed).toBe(true);
    expect(metrics.distanceMeters).toBe(1400);
    expect(metrics.etaMinutes).toBe(5);
    expect(metrics.routePolyline).toBeNull();
    expect(metrics.routeSource).toBe('google');
    expect(axios.get).toHaveBeenCalledTimes(2);
    consoleSpy.mockRestore();
  });
});
