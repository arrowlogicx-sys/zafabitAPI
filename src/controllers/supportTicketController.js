const SupportTicket = require('../models/SupportTicket');
const { sendResponse, sendError } = require('../utils/apiResponse');

// Standard Seed Data to populate empty databases
const SEED_TICKETS = [
  {
    ticketId: '#TK-8821',
    user: 'Anu Mathew',
    email: 'anu.mathew@zaffabit.local',
    title: 'Customer app booking payment issue',
    priority: 'urgent',
    status: 'open',
    assignedTo: 'Support Team',
    messages: [
      {
        sender: 'Anu Mathew',
        senderRole: 'customer',
        avatarInitials: 'AM',
        content:
          'I tried to complete payment for my home cleaning booking, but the app returned to the summary screen and I am not sure if the booking is confirmed.',
      },
      {
        sender: 'Support Team',
        senderRole: 'support',
        avatarInitials: 'ST',
        content:
          'We are checking the payment status and booking record. Please do not retry payment until we confirm the latest transaction state.',
      },
      {
        sender: 'Anu Mathew',
        senderRole: 'customer',
        avatarInitials: 'AM',
        content: 'Okay, please update me. The maid is scheduled for today afternoon.',
      },
    ],
  },
  {
    ticketId: '#TK-8819',
    user: 'Rahul Nair',
    email: 'rahul.nair@zaffabit.local',
    title: 'Need to update service address',
    priority: 'high',
    status: 'open',
    assignedTo: 'Support Team',
    messages: [
      {
        sender: 'Rahul Nair',
        senderRole: 'customer',
        avatarInitials: 'RN',
        content:
          "I selected the wrong saved address for tomorrow's cleaning booking. Please help me update it before the maid starts travel.",
      },
    ],
  },
  {
    ticketId: '#TK-8817',
    user: 'Meera Joseph',
    email: 'meera.joseph@zaffabit.local',
    title: 'Coupon not applying during checkout',
    priority: 'medium',
    status: 'open',
    assignedTo: 'Support Team',
    messages: [
      {
        sender: 'Meera Joseph',
        senderRole: 'customer',
        avatarInitials: 'MJ',
        content:
          'The referral coupon is visible in my wallet but it is not applying on the bill details screen.',
      },
    ],
  },
  {
    ticketId: '#TK-8815',
    user: 'Nisha R',
    email: 'nisha.r@zaffabit.local',
    title: 'Service feedback after completed cleaning',
    priority: 'low',
    status: 'closed',
    assignedTo: 'Support Team',
    messages: [
      {
        sender: 'Nisha R',
        senderRole: 'customer',
        avatarInitials: 'NR',
        content:
          'The service was completed, but I want to share feedback about one missed kitchen shelf.',
      },
      {
        sender: 'Support Team',
        senderRole: 'support',
        avatarInitials: 'ST',
        content:
          'Thank you for reporting this. We have recorded the feedback and shared it with operations.',
      },
    ],
  },
];

const LEGACY_SEED_EMAILS = [
  'jordan.smith@enterprise.com',
  'marcus@rome.org',
  's.connor@cyberdyne.net',
  'j.lynch@glee.edu',
];

/**
 * @desc    Get support ticket list (Admin)
 * @route   GET /api/v1/admin/support/tickets
 */
exports.getTickets = async (req, res, next) => {
  try {
    let count = await SupportTicket.countDocuments();
    if (count === 0) {
      await SupportTicket.create(SEED_TICKETS);
    } else {
      const removedLegacySeeds = await SupportTicket.deleteMany({
        email: { $in: LEGACY_SEED_EMAILS },
      });
      if (removedLegacySeeds.deletedCount > 0) {
        await SupportTicket.create(SEED_TICKETS);
      }
    }

    const filter = {};
    if (req.query.status && req.query.status !== 'ALL') {
      filter.status = req.query.status.toLowerCase();
    }
    if (req.query.priority && req.query.priority !== 'ALL') {
      filter.priority = req.query.priority.toLowerCase();
    }

    const tickets = await SupportTicket.find(filter).sort('-updatedAt');
    return sendResponse(res, 200, 'Support tickets retrieved', { tickets });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reply to a support ticket thread (Admin)
 * @route   POST /api/v1/admin/support/tickets/:id/reply
 */
exports.replyToTicket = async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) {
      return sendError(res, 400, 'Reply content is required', 'VALIDATION_ERROR');
    }

    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
      return sendError(res, 404, 'Support ticket not found', 'NOT_FOUND');
    }

    const adminName = req.user ? req.user.name : 'Support Admin';
    const initials =
      adminName
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2) || 'SA';

    ticket.messages.push({
      sender: adminName,
      senderRole: 'support',
      avatarInitials: initials,
      content,
    });

    await ticket.save();
    return sendResponse(res, 200, 'Reply added successfully', { ticket });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Resolve/Close a support ticket (Admin)
 * @route   PATCH /api/v1/admin/support/tickets/:id/resolve
 */
exports.resolveTicket = async (req, res, next) => {
  try {
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) {
      return sendError(res, 404, 'Support ticket not found', 'NOT_FOUND');
    }

    const adminName = req.user ? req.user.name : 'administrator';

    ticket.status = 'closed';
    ticket.messages.push({
      sender: 'System Alert',
      senderRole: 'support',
      avatarInitials: 'SYS',
      content: `This support ticket was resolved and closed by ${adminName}.`,
    });

    await ticket.save();
    return sendResponse(res, 200, 'Ticket marked resolved successfully', { ticket });
  } catch (error) {
    next(error);
  }
};
