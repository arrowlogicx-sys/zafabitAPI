const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema(
  {
    sender: { type: String, required: true },
    senderRole: { type: String, enum: ['customer', 'support'], required: true },
    avatarInitials: { type: String, required: true },
    content: { type: String, required: true },
  },
  { timestamps: true },
);

const SupportTicketSchema = new mongoose.Schema(
  {
    ticketId: { type: String, required: true, unique: true },
    user: { type: String, required: true },
    email: { type: String, required: true },
    title: { type: String, required: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' },
    status: { type: String, enum: ['open', 'closed'], default: 'open' },
    assignedTo: { type: String, default: 'Alex Rivera' },
    messages: [MessageSchema],
  },
  { timestamps: true },
);

module.exports = mongoose.model('SupportTicket', SupportTicketSchema);
