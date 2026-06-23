const mongoose = require('mongoose');

const ChatMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
  },
  { timestamps: true },
);

const SupportChatSessionSchema = new mongoose.Schema(
  {
    conversationId: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    messages: [ChatMessageSchema],
  },
  { timestamps: true },
);

SupportChatSessionSchema.index({ user: 1, updatedAt: -1 });

module.exports = mongoose.model('SupportChatSession', SupportChatSessionSchema);
