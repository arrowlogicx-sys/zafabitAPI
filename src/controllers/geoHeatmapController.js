/**
 * geoHeatmapController.js
 * Aggregates booking location data into Uber H3 hexagonal cells
 * for geo heatmap visualization in the admin panel.
 */

const h3 = require('h3-js');
const Booking = require('../models/Booking');

/**
 * GET /api/v1/admin/geo-heatmap
 * Query params:
 *   resolution  : H3 resolution (default 7 = ~5km² neighborhood level)
 *   status      : filter by booking status (all | pending | completed | cancelled | ongoing)
 *   dateFrom    : ISO date string (inclusive)
 *   dateTo      : ISO date string (inclusive)
 *   serviceId   : filter by specific service ObjectId
 *   metric      : 'count' | 'revenue' (what to color by, default 'count')
 */
exports.getGeoHeatmap = async (req, res) => {
  try {
    const { resolution = '7', status, dateFrom, dateTo, serviceId, metric = 'count' } = req.query;

    const res_int = Math.min(Math.max(parseInt(resolution) || 7, 5), 9);

    // ─── Build MongoDB filter ────────────────────────────────────────────────
    const match = {
      'location.lat': { $exists: true, $ne: null },
      'location.lng': { $exists: true, $ne: null },
    };

    if (status && status !== 'all') {
      match.status = status;
    }
    if (serviceId) {
      match.service = serviceId;
    }
    if (dateFrom || dateTo) {
      match.scheduleDate = {};
      if (dateFrom) match.scheduleDate.$gte = new Date(dateFrom);
      if (dateTo) match.scheduleDate.$lte = new Date(dateTo);
    }

    // ─── Fetch raw bookings ──────────────────────────────────────────────────
    const bookings = await Booking.find(match)
      .select('location totalAmount status scheduleDate service')
      .lean();

    // ─── Aggregate into H3 cells ─────────────────────────────────────────────
    const cellMap = {};

    for (const b of bookings) {
      if (!b.location) continue;
      const { lat, lng } = b.location;
      if (!lat || !lng) continue;

      let h3Index;
      try {
        h3Index = h3.latLngToCell(lat, lng, res_int);
      } catch (err) {
        // Skip invalid coordinates
        continue;
      }

      if (!cellMap[h3Index]) {
        cellMap[h3Index] = {
          h3Index,
          count: 0,
          revenue: 0,
          statuses: {
            pending: 0,
            completed: 0,
            cancelled: 0,
            ongoing: 0,
            accepted: 0,
            refunded: 0,
          },
        };
      }

      cellMap[h3Index].count++;
      cellMap[h3Index].revenue += b.totalAmount || 0;

      const st = b.status || 'pending';
      if (cellMap[h3Index].statuses[st] !== undefined) {
        cellMap[h3Index].statuses[st]++;
      }
    }

    // ─── Enrich with center lat/lng for client rendering ────────────────────
    const cells = Object.values(cellMap).map((cell) => {
      let centerLat = 0,
        centerLng = 0;
      try {
        [centerLat, centerLng] = h3.cellToLatLng(cell.h3Index);
      } catch (_) {}

      return {
        ...cell,
        revenue: Math.round(cell.revenue * 100) / 100,
        centerLat,
        centerLng,
        // Dominant status in this cell
        dominantStatus:
          Object.entries(cell.statuses).sort((a, b) => b[1] - a[1])[0]?.[0] || 'pending',
      };
    });

    // Sort by the requested metric descending
    cells.sort((a, b) => (metric === 'revenue' ? b.revenue - a.revenue : b.count - a.count));

    // ─── Top-level summary stats ─────────────────────────────────────────────
    const maxCount = cells.length ? cells[0].count : 0;
    const maxRevenue = cells.reduce((m, c) => Math.max(m, c.revenue), 0);
    const totalCells = cells.length;
    const topZone = cells[0] || null;

    // ─── Response ────────────────────────────────────────────────────────────
    return res.json({
      success: true,
      data: {
        cells,
        resolution: res_int,
        metric,
        summary: {
          totalBookings: bookings.length,
          totalCells,
          maxCount,
          maxRevenue,
          topZone: topZone
            ? {
                h3Index: topZone.h3Index,
                count: topZone.count,
                revenue: topZone.revenue,
                centerLat: topZone.centerLat,
                centerLng: topZone.centerLng,
              }
            : null,
        },
      },
    });
  } catch (err) {
    console.error('[GeoHeatmap] Controller error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to compute geo heatmap data',
      error: err.message,
    });
  }
};
