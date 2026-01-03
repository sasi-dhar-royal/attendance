const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['student', 'admin'], required: true, default: 'student' },
    assignedShift: { type: String, enum: ['morning', 'afternoon'], default: 'morning' },
    fullName: { type: String, required: true },
    feeStatus: { type: String, default: 'No Dues' },
    dueDate: { type: String, default: '' }, // e.g. "2023-12-25"
    paidFees: { type: Number, default: 0 },
    feeRemarks: { type: String, default: '' },
    recordStatus: { type: String, default: 'All Clear' },
    pendingDocs: { type: String, default: '' } // e.g. "Aadhar, Photo"
});

module.exports = mongoose.models.User || mongoose.model('User', UserSchema);
