const axios = require('axios');

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:5001';

async function runSmokeTest() {
  console.log(`=== Starting Zaffabit API Smoke Test ===`);
  console.log(`Targeting URL: ${BASE_URL}\n`);

  let failures = 0;

  // Test 1: Root Health Check Endpoint
  try {
    console.log('[Test 1] Pinging Root Endpoint...');
    const res = await axios.get(`${BASE_URL}/`, { timeout: 5000 });
    if (
      res.status === 200 &&
      res.data.success &&
      res.data.message.includes('Backend API is running')
    ) {
      console.log('✅ PASS: Root endpoint is healthy.');
      console.log(`   Message: "${res.data.message}" | Version: ${res.data.data.version}\n`);
    } else {
      throw new Error(`Unexpected response structure: ${JSON.stringify(res.data)}`);
    }
  } catch (error) {
    failures++;
    console.error('❌ FAIL: Root endpoint unhealthy!');
    console.error(`   Error: ${error.message}\n`);
  }

  // Test 2: Database Connectivity via Services List
  try {
    console.log('[Test 2] Querying Services (DB Connectivity Check)...');
    const res = await axios.get(`${BASE_URL}/api/v1/services`, { timeout: 8000 });
    const services = res.data.data && (res.data.data.services || res.data.data);
    if (res.status === 200 && res.data.success && Array.isArray(services)) {
      console.log('✅ PASS: Database is connected and returning services.');
      console.log(`   Found: ${services.length} services configured.\n`);
    } else {
      throw new Error(`Unexpected services response structure: ${JSON.stringify(res.data)}`);
    }
  } catch (error) {
    failures++;
    console.error('❌ FAIL: Database query failed!');
    console.error(`   Error: ${error.message}\n`);
  }

  // Final status report
  console.log(`=== Smoke Test Complete ===`);
  if (failures === 0) {
    console.log('🎉 STATUS: 100% HEALTHY. Production environment verified successfully.');
    process.exit(0);
  } else {
    console.error(`🚨 STATUS: UNHEALTHY. ${failures} critical failure(s) detected.`);
    process.exit(1);
  }
}

runSmokeTest();
