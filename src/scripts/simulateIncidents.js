/**
 * SOS & Incidents Simulation & Integration Test
 *
 * This script runs a complete end-to-end verification of the admin safety incidents API endpoints.
 * It simulates the actions of an operations officer:
 * 1. Fetching the global incident log (and triggering seeding if empty).
 * 2. Selecting an active incident log.
 * 3. Resolving the active incident log.
 */

// Force Dev Authentication Fallback
process.env.ENABLE_DEV_AUTH_FALLBACK = 'true';

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const Incident = require('../models/Incident');

async function runSimulation() {
  console.log('=== STARTING SAFETY INCIDENT SIMULATION ===');

  // 1. Connect to Database
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cleaningService';
  console.log(`Connecting to MongoDB at: ${MONGO_URI.split('@').pop()}`);
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB.');

  try {
    // 2. Retrieve Safety Incidents Log Queue
    console.log('\n--- Step 1: Retrieving Global Safety & SOS Log ---');
    const getRes = await request(app).get('/api/v1/admin/incidents');

    if (getRes.status !== 200) {
      throw new Error(
        `Failed to fetch incidents. Status: ${getRes.status}, Body: ${JSON.stringify(getRes.body)}`,
      );
    }

    const incidents = getRes.body.data.incidents;
    console.log(`✅ Success: Fetched ${incidents.length} incident log(s) from MongoDB.`);

    incidents.forEach((inc) => {
      console.log(
        `   - [${inc.incidentId}] (${inc.status}) Priority: ${inc.priority} | Reporter: ${inc.user} (${inc.userRole}) | Type: "${inc.type}"`,
      );
    });

    if (incidents.length === 0) {
      throw new Error('Database returned empty list of incidents even after auto-seeding.');
    }

    // 3. Find an active incident to resolve
    let activeIncident = incidents.find((inc) => inc.status === 'active');
    if (!activeIncident) {
      console.log('⚠️ No active incidents found. Re-opening one for simulation...');
      const closedIncident = incidents[0];
      await Incident.findByIdAndUpdate(closedIncident._id, {
        status: 'active',
        $unset: { resolvedBy: 1 },
      });
      const refreshRes = await request(app).get('/api/v1/admin/incidents');
      const refreshedList = refreshRes.body.data.incidents;
      activeIncident = refreshedList.find((inc) => inc.status === 'active');
    }

    const incidentIdToTest = activeIncident._id;
    console.log(
      `\nSelected Active Incident for Simulation: ${activeIncident.incidentId} (_id: ${incidentIdToTest})`,
    );

    // 4. Resolve the incident
    console.log('\n--- Step 2: Resolving Active Incident ---');
    const resolveRes = await request(app).patch(
      `/api/v1/admin/incidents/${incidentIdToTest}/resolve`,
    );

    if (resolveRes.status !== 200) {
      throw new Error(
        `Failed to resolve incident. Status: ${resolveRes.status}, Body: ${JSON.stringify(resolveRes.body)}`,
      );
    }

    const resolvedIncident = resolveRes.body.data.incident;
    if (resolvedIncident.status !== 'resolved') {
      throw new Error(
        `Incident status is not resolved after patch. Got: ${resolvedIncident.status}`,
      );
    }

    console.log('✅ Success: Safety incident marked as resolved.');
    console.log(`   Final status: ${resolvedIncident.status}`);
    console.log(`   Resolved by: ${resolvedIncident.resolvedBy || 'Admin'}`);

    console.log('\n🎉 ALL SAFETY INCIDENT LIFE-CYCLE TESTS PASSED SUCCESSFULLY! 🎉');
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
