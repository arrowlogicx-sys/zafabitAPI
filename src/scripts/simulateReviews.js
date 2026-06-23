/**
 * Reviews & Ratings Simulation & Integration Test
 *
 * This script runs a complete end-to-end verification of the admin reviews API endpoints.
 * It simulates:
 * 1. Fetching all customer reviews for the admin panel.
 * 2. Fetching the sentiment analysis report.
 * 3. Selecting a review with an open customer dispute (pending issue).
 * 4. Resolving the customer dispute using the resolve endpoint.
 */

// Force Dev Authentication Fallback
process.env.ENABLE_DEV_AUTH_FALLBACK = 'true';

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const Review = require('../models/Review');

async function runSimulation() {
  console.log('=== STARTING REVIEWS & RATINGS SIMULATION ===');

  // 1. Connect to Database
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cleaningService';
  console.log(`Connecting to MongoDB at: ${MONGO_URI.split('@').pop()}`);
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB.');

  try {
    // 2. Retrieve Reviews Log Queue
    console.log('\n--- Step 1: Retrieving All Reviews for Admin ---');
    const getReviewsRes = await request(app).get('/api/v1/reviews/admin');

    if (getReviewsRes.status !== 200) {
      throw new Error(
        `Failed to fetch reviews. Status: ${getReviewsRes.status}, Body: ${JSON.stringify(getReviewsRes.body)}`,
      );
    }

    const reviews = getReviewsRes.body.data.reviews;
    console.log(`✅ Success: Fetched ${reviews.length} reviews from MongoDB.`);

    reviews.forEach((rev) => {
      const custName = rev.customer ? rev.customer.name : 'Unknown';
      const maidName = rev.maid ? rev.maid.name : 'Unknown';
      console.log(
        `   - [Rating: ${rev.rating}★] Customer: ${custName} -> Maid: ${maidName} | Sentiment: ${rev.sentiment} | Issue Raised: ${rev.isIssueRaised} (Status: ${rev.issueStatus})`,
      );
    });

    if (reviews.length === 0) {
      throw new Error('Database returned empty list of reviews.');
    }

    // 3. Fetch Sentiment Report
    console.log('\n--- Step 2: Retrieving Sentiment Analysis Report ---');
    const getSentimentRes = await request(app).get('/api/v1/admin/reports/sentiment');

    if (getSentimentRes.status !== 200) {
      throw new Error(
        `Failed to fetch sentiment report. Status: ${getSentimentRes.status}, Body: ${JSON.stringify(getSentimentRes.body)}`,
      );
    }

    const report = getSentimentRes.body.data;
    console.log('✅ Success: Fetched sentiment aggregates.');
    console.log(JSON.stringify(report, null, 2));

    // 4. Find an active customer dispute to resolve
    let pendingIssue = reviews.find((rev) => rev.isIssueRaised && rev.issueStatus === 'pending');
    if (!pendingIssue) {
      console.log('⚠️ No pending customer disputes found. Creating a test one for simulation...');
      const firstReview = reviews[0];
      await Review.findByIdAndUpdate(firstReview._id, {
        isIssueRaised: true,
        issueStatus: 'pending',
        issueDescription: 'Simulated customer dispute details.',
      });
      const refreshRes = await request(app).get('/api/v1/reviews/admin');
      pendingIssue = refreshRes.body.data.reviews.find(
        (rev) => rev.isIssueRaised && rev.issueStatus === 'pending',
      );
    }

    const reviewIdToTest = pendingIssue._id;
    console.log(`\nSelected Pending Customer Issue for Resolution: _id: ${reviewIdToTest}`);

    // 5. Resolve the customer issue
    console.log('\n--- Step 3: Resolving Customer Dispute ---');
    const resolveRes = await request(app)
      .patch(`/api/v1/reviews/issue/${reviewIdToTest}/resolve`)
      .send({
        resolutionNotes:
          'Dispute investigated. Customer refunded 50% & warning issued to service provider.',
      });

    if (resolveRes.status !== 200) {
      throw new Error(
        `Failed to resolve dispute. Status: ${resolveRes.status}, Body: ${JSON.stringify(resolveRes.body)}`,
      );
    }

    const resolvedReview = resolveRes.body.data.review;
    if (resolvedReview.issueStatus !== 'resolved') {
      throw new Error(
        `Issue status is not resolved after patch. Got: ${resolvedReview.issueStatus}`,
      );
    }

    console.log('✅ Success: Customer issue marked as resolved.');
    console.log(`   Final Issue Status: ${resolvedReview.issueStatus}`);
    console.log(`   Admin Resolution Notes: "${resolvedReview.adminResolution}"`);

    console.log('\n🎉 ALL REVIEWS & DISPUTES LIFE-CYCLE TESTS PASSED SUCCESSFULLY! 🎉');
  } catch (error) {
    console.error('\n❌ SIMULATION FAILED!');
    console.error(error);
    process.exitCode = 1;
  } finally {
    console.log('\nDisconnecting from MongoDB...');
    await mongoose.disconnect();
    console.log('Disconnected. Bye!');
  }
}

runSimulation();
