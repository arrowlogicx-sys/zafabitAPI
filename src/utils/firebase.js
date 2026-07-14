const admin = require('firebase-admin');
const User = require('../models/User');

// Service account credentials must be supplied via FIREBASE_SERVICE_ACCOUNT
// (the full service-account JSON, minified to one line) as an environment
// variable, never committed to the repo.
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable is required');
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Initialize Firebase Admin App
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

/**
 * Utility to send a push notification to specific users
 * @param {Array<String>} userIds - Array of MongoDB User ObjectIds
 * @param {String} title - Notification Title
 * @param {String} body - Notification Body
 * @param {Object} data - Optional payload data (e.g. { bookingId: "xyz" })
 */
const sendPushNotification = async (userIds, title, body, data = {}) => {
  try {
    // 1. Fetch the user documents to grab their push tokens
    const users = await User.find({ _id: { $in: userIds } }).select('pushToken');

    // 2. Extract valid tokens
    const tokens = users
      .map((user) => user.pushToken)
      .filter((token) => token && token.trim() !== '');

    if (tokens.length === 0) {
      console.log('No valid push tokens found for users:', userIds);
      return;
    }

    // 3. Construct the message payload
    const message = {
      notification: {
        title,
        body,
      },
      data, // Custom data sent to the app
      tokens, // Multicast allows sending to multiple tokens at once
    };

    // 4. Send via Firebase Admin
    const response = await admin.messaging().sendEachForMulticast(message);

    console.log(`Successfully sent ${response.successCount} push notifications.`);
    if (response.failureCount > 0) {
      console.error(
        `Failed to send ${response.failureCount} push notifications.`,
        response.responses,
      );
    }

    return response;
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
};

module.exports = {
  admin,
  sendPushNotification,
};
