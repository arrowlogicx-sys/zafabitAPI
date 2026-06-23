/**
 * Cancellation & Refund Policy Rules
 */
const CANCELLATION_POLICY = {
  WINDOW_HOURS: 12, // 12-hour window for free cancellation
  REFUND_PERCENTAGE_BEFORE_WINDOW: 100, // 100% refund if > 12h
  REFUND_PERCENTAGE_AFTER_WINDOW: 50, // 50% refund if < 12h
  REFUND_PERCENTAGE_ONGOING: 0, // 0% refund if the job is already ongoing
  INSTANT_BOOKING_REFUND_PERCENTAGE: 0, // No free cancellation for instant bookings

  POLICY_TEXT: `
# Cancellation & Refund Policy

We understand that plans change. Here is our policy regarding cancellations and refunds:

### 1. Free Cancellation
You can cancel your booking for a **full 100% refund** to your wallet if you cancel at least **12 hours** before the scheduled start time.

### 2. Late Cancellation
Cancellations made **within 12 hours** of the scheduled start time will incur a **50% cancellation fee**. The remaining 50% will be refunded to your wallet.

### 3. Cancellation of Ongoing Jobs
If a job is already **ongoing** (the maid has started), you can still cancel it if needed. In this case, a **75% fee** applies, and **25%** of the booking amount will be refunded to your wallet.

### 4. Completed Jobs
Completed jobs are **not eligible for refunds** via the app. If there is an issue with the service, please contact our support team.

---
*Note: All refunds are credited directly to your CleanApp Wallet and can be used for future bookings.*
`,
};

const TERMS_AND_CONDITIONS = {
  title: 'Terms & Conditions',
  paragraphs: [
    'Welcome to Zaffabit. By downloading, installing, or using our mobile application, you agree to comply with and be bound by these Terms and Conditions. If you do not agree, please do not use the application.',
    'Zaffabit provides a platform that connects customers with independent service providers (maids and cleaners). We act as a booking platform and do not employ the service providers directly.',
    'Bookings must be scheduled and paid for through the app. All transactions are securely processed via Razorpay or your wallet balance. Any payments made outside the platform are not covered by our policies.',
    'Cancellations and refunds are governed by our Cancellation Policy. Eligible refunds are credited directly to your Zaffabit Wallet and cannot be redeemed for cash unless specified.',
    'Customers must provide a safe, cooperative, and respectful environment for the assigned service providers. We reserve the right to suspend accounts of users who violate this code of conduct.',
    'Zaffabit shall not be held liable for any damages, losses, or disputes arising directly from the services provided by independent cleaning professionals.',
  ],
};

const PRIVACY_POLICY = {
  title: 'Privacy Policy',
  paragraphs: [
    'Your privacy is important to us. This Privacy Policy explains how Zaffabit collects, uses, discloses, and safeguards your information when you use our mobile application.',
    'We collect personal details such as your name, phone number, email address, physical address, and precise location coordinates to facilitate booking, dispatching, and service tracking.',
    'Your location data and address are shared only with the assigned service provider to enable them to locate your premises. We do not share or sell your data to third-party advertisers.',
    'We use industry-standard security protocols to protect your personal information. Account credentials and payments are encrypted and stored securely.',
    'You have the right to update your profile details or request deletion of your account at any time. Account deletion can be performed directly through the profile settings in the app.',
    'We may update this policy periodically to reflect changes in our service. Continued use of the application signifies your acceptance of any updates.',
  ],
};

module.exports = { CANCELLATION_POLICY, TERMS_AND_CONDITIONS, PRIVACY_POLICY };
