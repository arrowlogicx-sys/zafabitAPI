/**
 * Support Ticket Simulation & Integration Test
 *
 * This script runs a complete end-to-end verification of the admin support ticket API endpoints.
 * It simulates the actions of a support agent:
 * 1. Fetching the support queue (and triggering seeding if empty).
 * 2. Posting a reply to a specific support ticket.
 * 3. Resolving and closing the ticket.
 */

// Force Dev Authentication Fallback
process.env.ENABLE_DEV_AUTH_FALLBACK = 'true';

const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../app');
const SupportTicket = require('../models/SupportTicket');

async function runSimulation() {
  console.log('=== STARTING SUPPORT TICKET SIMULATION ===');

  // 1. Connect to Database
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cleaningService';
  console.log(`Connecting to MongoDB at: ${MONGO_URI.split('@').pop()}`);
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB.');

  try {
    // 2. Fetch all tickets
    console.log('\n--- Step 1: Retrieving Support Tickets Queue ---');
    const getRes = await request(app).get('/api/v1/admin/support/tickets');

    if (getRes.status !== 200) {
      throw new Error(
        `Failed to fetch tickets. Status: ${getRes.status}, Body: ${JSON.stringify(getRes.body)}`,
      );
    }

    const tickets = getRes.body.data.tickets;
    console.log(`✅ Success: Fetched ${tickets.length} support ticket(s) from MongoDB.`);

    if (tickets.length === 0) {
      throw new Error('Auto-seeding support tickets failed or returned empty array.');
    }

    // Print ticket summary
    tickets.forEach((ticket) => {
      console.log(
        `   - [${ticket.ticketId}] (${ticket.status}) Priority: ${ticket.priority} | User: ${ticket.user} | Title: "${ticket.title}"`,
      );
    });

    // Pick an open ticket for the simulation
    let openTicket = tickets.find((t) => t.status === 'open');
    if (!openTicket) {
      console.log('⚠️ No open tickets found. Re-seeding or updating one to open status...');
      // If all are closed, let's reopen the first one
      await SupportTicket.updateOne({ _id: tickets[0]._id }, { status: 'open' });
      openTicket = await SupportTicket.findById(tickets[0]._id);
    }

    const ticketIdToTest = openTicket._id;
    console.log(
      `\nSelected Ticket for Simulation: ${openTicket.ticketId} (_id: ${ticketIdToTest})`,
    );

    // 3. Post a reply
    console.log('\n--- Step 2: Posting Support Agent Reply ---');
    const replyText = `Simulated support reply at ${new Date().toISOString()}: Please verify your network request configuration.`;

    const replyRes = await request(app)
      .post(`/api/v1/admin/support/tickets/${ticketIdToTest}/reply`)
      .send({ content: replyText });

    if (replyRes.status !== 200) {
      throw new Error(
        `Failed to add reply. Status: ${replyRes.status}, Body: ${JSON.stringify(replyRes.body)}`,
      );
    }

    const updatedTicket = replyRes.body.data.ticket;
    const lastMessage = updatedTicket.messages[updatedTicket.messages.length - 1];

    if (lastMessage.content !== replyText || lastMessage.senderRole !== 'support') {
      throw new Error(
        `Reply verification failed. Last message content/role mismatch: ${JSON.stringify(lastMessage)}`,
      );
    }
    console.log(
      `✅ Success: Reply posted successfully. Thread length: ${updatedTicket.messages.length}`,
    );
    console.log(
      `   Last message: "${lastMessage.content}" from ${lastMessage.sender} (${lastMessage.senderRole})`,
    );

    // 4. Resolve the ticket
    console.log('\n--- Step 3: Resolving Support Ticket ---');
    const resolveRes = await request(app).patch(
      `/api/v1/admin/support/tickets/${ticketIdToTest}/resolve`,
    );

    if (resolveRes.status !== 200) {
      throw new Error(
        `Failed to resolve ticket. Status: ${resolveRes.status}, Body: ${JSON.stringify(resolveRes.body)}`,
      );
    }

    const resolvedTicket = resolveRes.body.data.ticket;
    if (resolvedTicket.status !== 'closed') {
      throw new Error(
        `Ticket status is not closed after resolve request. Got: ${resolvedTicket.status}`,
      );
    }

    const systemMsg = resolvedTicket.messages[resolvedTicket.messages.length - 1];
    if (systemMsg.sender !== 'System Alert' || !systemMsg.content.includes('resolved and closed')) {
      throw new Error(
        `Missing expected system closing alert message in thread: ${JSON.stringify(systemMsg)}`,
      );
    }

    console.log('✅ Success: Support ticket marked as closed.');
    console.log(`   Final status: ${resolvedTicket.status}`);
    console.log(`   System message added: "${systemMsg.content}"`);

    console.log('\n🎉 ALL SUPPORT TICKET LIFE-CYCLE TESTS PASSED SUCCESSFULLY! 🎉');
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
