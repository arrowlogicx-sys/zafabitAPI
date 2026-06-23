const Booking = require('../models/Booking');

async function transitionBooking(bookingId, options) {
  const { from, to, actor, note, set = {}, unset = {}, allowSameStatus = false } = options;

  const allowedFrom = Array.isArray(from) ? from : [from];
  const query = { _id: bookingId };
  if (allowedFrom.length && !allowedFrom.includes('*')) {
    query.status = allowSameStatus
      ? { $in: [...new Set([...allowedFrom, to])] }
      : { $in: allowedFrom };
  }

  const update = {
    $set: {
      ...set,
      status: to,
    },
    $push: {
      statusHistory: {
        status: to,
        timestamp: new Date(),
        updatedBy: actor,
        note,
      },
    },
  };

  if (Object.keys(unset).length) {
    update.$unset = unset;
  }

  const booking = await Booking.findOneAndUpdate(query, update, { returnDocument: 'after' });
  if (!booking) {
    return {
      transitioned: false,
      message: `Booking cannot transition to ${to}`,
    };
  }

  return {
    transitioned: true,
    booking,
  };
}

module.exports = {
  transitionBooking,
};
