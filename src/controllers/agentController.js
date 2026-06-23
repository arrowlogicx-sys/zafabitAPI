const Agent = require('../models/Agent');
const User = require('../models/User');
const MaidProfile = require('../models/MaidProfile');
const { sendResponse, sendError } = require('../utils/apiResponse');

/**
 * @desc    Get Agent Profile & Performance
 * @route   GET /api/v1/agents/me
 */
exports.getAgentProfile = async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ user: req.user.id }).populate(
      'referredMaids',
      'name email activeStatus',
    );

    if (!agent) {
      return sendError(res, 404, 'Agent profile not found', 'NOT_FOUND');
    }

    return sendResponse(res, 200, 'Agent profile retrieved', agent);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create/Register a new Agent (Admin)
 */
exports.registerAgent = async (req, res, next) => {
  try {
    const { userId, name, email, phone, agentCode, zone, commissionRate } = req.body;

    const agent = await Agent.create({
      user: userId, // Link to existing user
      name,
      email,
      phone,
      agentCode,
      zone,
      commissionRate,
    });

    // Update User ref
    if (userId) {
      await User.findByIdAndUpdate(userId, { agentProfile: agent._id });
    }

    return sendResponse(res, 201, 'Agent registered successfully', agent);
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Track Maid referrals for an agent
 * @route   GET /api/v1/agents/referrals
 */
exports.getAgentReferrals = async (req, res, next) => {
  try {
    const agent = await Agent.findOne({ user: req.user.id });
    if (!agent) return sendError(res, 404, 'Agent not found', 'NOT_FOUND');

    // Finding maids referred by this agent code
    // Assuming MaidProfile stores the referredByAgent code
    const referredMaids = await MaidProfile.find({ referredByAgent: agent.agentCode }).populate(
      'user',
      'name email',
    );

    return sendResponse(res, 200, 'Referred maids retrieved', {
      count: referredMaids.length,
      referredMaids,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get All Agents (Admin)
 * @route   GET /api/v1/agents
 */
exports.getAgents = async (req, res, next) => {
  try {
    const agents = await Agent.find().populate('referredMaids', 'name email');
    return sendResponse(res, 200, 'All agents retrieved', { agents });
  } catch (error) {
    next(error);
  }
};
