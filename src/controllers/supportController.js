const SupportChatSession = require('../models/SupportChatSession');
const SupportTicket = require('../models/SupportTicket');
const { sendResponse, sendError } = require('../utils/apiResponse');
const { v4: uuidv4 } = require('uuid');

/**
 * @desc    Trigger SOS / Emergency Alert
 * @route   POST /api/v1/support/sos
 */
exports.handleSOS = async (req, res, next) => {
  try {
    const user = req.user;

    // In production, trigger immediate SMS/Push to admin and emergency contacts
    console.warn(
      `[EMERGENCY SOS] User ${user.phone || user.name || user._id} triggered an SOS alert!`,
    );

    return sendResponse(res, 200, 'SOS Alert triggered. Help is on the way.', {
      emergencyContacts: [
        { name: 'Police', number: '100' },
        { name: 'Ambulance', number: '102' },
        { name: 'CleanApp Safety Team', number: '999-888-7777' },
      ],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get Safety & Support Helplines
 * @route   GET /api/v1/support/helplines
 */
exports.getHelplines = async (req, res, next) => {
  try {
    return sendResponse(res, 200, 'Helpline numbers retrieved', {
      helplines: [
        { category: 'Emergency', numbers: ['100', '101', '102'] },
        { category: 'Women Helpline', numbers: ['1091'] },
        { category: 'CleanApp Support', numbers: ['0484-2345678'] },
      ],
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Contact Us / Submit Feedback
 * @route   POST /api/v1/support/contact
 */
exports.contactUs = async (req, res, next) => {
  try {
    const { subject, message } = req.body;
    if (!message || !String(message).trim()) {
      return sendError(res, 400, 'Message is required', 'VALIDATION_ERROR');
    }

    const user = req.user;
    const displayName = user.name || user.phone || user.email || 'Customer';
    const initials =
      String(displayName)
        .split(' ')
        .map((part) => part[0])
        .join('')
        .toUpperCase()
        .substring(0, 2) || 'CU';

    const ticket = await SupportTicket.create({
      ticketId: `#TK-${Date.now().toString().slice(-6)}`,
      user: displayName,
      email: user.email || `${user.phone || user._id}@zaffabit.local`,
      title: subject || 'Customer support request',
      priority: 'medium',
      status: 'open',
      messages: [
        {
          sender: displayName,
          senderRole: 'customer',
          avatarInitials: initials,
          content: String(message).trim(),
        },
      ],
    });

    console.log(
      `[CONTACT US] Support ticket ${ticket.ticketId} created from ${user.phone || user.name || user._id}: ${subject}`,
    );

    return sendResponse(res, 200, 'Message received. Our team will contact you shortly.', {
      ticket,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    AI Chat Assistant Response
 * @route   POST /api/v1/support/ai-chat
 * @access  Protected
 */
exports.handleAIChat = async (req, res, next) => {
  try {
    const { message, conversationId } = req.body;
    if (!message) {
      return sendError(res, 400, 'Message is required', 'VALIDATION_ERROR');
    }

    const query = String(message).toLowerCase();
    let response =
      'Hello! I am your Zaffabit AI Assistant. How can I help you with your cleaning bookings today?';

    if (query.includes('refund') || query.includes('cancel')) {
      response =
        'You can cancel any booking up to 2 hours before the start time for a full refund. Simply go to your Bookings tab and tap Cancel.';
    } else if (query.includes('price') || query.includes('cost') || query.includes('charge')) {
      response =
        'Our service pricing is transparent and calculated based on estimated duration and cleaning requirements. You can see the full breakdown on the Booking Summary screen.';
    } else if (query.includes('maid') || query.includes('cleaner') || query.includes('staff')) {
      response =
        'All our partners are police-verified, highly rated, and undergo rigorous cleaning quality training before servicing your home.';
    } else if (query.includes('contact') || query.includes('support') || query.includes('call')) {
      response =
        'You can call us at 0484-2345678. In case of emergency, please trigger the SOS option.';
    }

    const nextConversationId = conversationId || uuidv4();
    const session = await SupportChatSession.findOneAndUpdate(
      {
        conversationId: nextConversationId,
        user: req.user.id,
      },
      {
        $setOnInsert: {
          conversationId: nextConversationId,
          user: req.user.id,
        },
        $push: {
          messages: {
            $each: [
              { role: 'user', content: message },
              { role: 'assistant', content: response },
            ],
          },
        },
      },
      { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true },
    );

    return sendResponse(res, 200, 'AI response generated', {
      conversationId: session.conversationId,
      response,
      messages: session.messages,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Restore AI chat history
 * @route   GET /api/v1/support/ai-chat/:conversationId
 * @access  Protected
 */
exports.getAIChatHistory = async (req, res, next) => {
  try {
    const session = await SupportChatSession.findOne({
      conversationId: req.params.conversationId,
      user: req.user.id,
    });

    if (!session) {
      return sendError(res, 404, 'Conversation not found', 'NOT_FOUND');
    }

    return sendResponse(res, 200, 'AI chat history retrieved', {
      conversationId: session.conversationId,
      messages: session.messages,
    });
  } catch (error) {
    next(error);
  }
};
