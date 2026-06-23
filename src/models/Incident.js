const mongoose = require('mongoose');

const IncidentSchema = new mongoose.Schema(
  {
    incidentId: { type: String, required: true, unique: true },
    user: { type: String, required: true },
    userRole: { type: String, enum: ['customer', 'maid', 'system', 'agent'], default: 'customer' },
    type: { type: String, required: true }, // SOS Alarm Triggered, Access Denied, Late Provider, Safety Alert
    location: { type: String, required: true },
    lastLocation: { type: String },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'high' },
    status: { type: String, enum: ['active', 'resolved'], default: 'active' },
    reporterPhone: { type: String },
    description: { type: String, required: true },
    resolvedBy: { type: String },
  },
  { timestamps: true },
);

module.exports = mongoose.model('Incident', IncidentSchema);
