require('dotenv').config();
const dns = require('dns');
// Set Google DNS to fix Atlas SRV resolution issues
dns.setServers(['8.8.8.8', '8.8.4.4']);

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const geolib = require('geolib');
const User = require('./models/User');
const Attendance = require('./models/Attendance');
const path = require('path');
const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// MongoDB Connection Strategy for Serverless
let cachedDb = null;

async function connectToDatabase() {
    if (cachedDb) {
        return cachedDb;
    }

    if (!process.env.MONGODB_URI) {
        throw new Error('MONGODB_URI environment variable is missing');
    }

    try {
        const db = await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 15000,
            socketTimeoutMS: 45000,
        });
        console.log('Connected to MongoDB');
        cachedDb = db;
        return db;
    } catch (err) {
        console.error('MongoDB connection error:', err);
        throw err;
    }
}

// Middleware to ensure DB is connected
app.use(async (req, res, next) => {
    try {
        await connectToDatabase();
        next();
    } catch (error) {
        console.error('Database connection failed handling request:', error);
        res.status(500).json({ error: 'Database connection failed', details: error.message });
    }
});

// Attendance Constants
const OFFICE_LOCATION = { latitude: 13.274497, longitude: 79.121317 };
const RADIUS_METERS = 100;
const QR_SECRET = "VINNAR_INSTITUTION_2026";

// Shift Timing Check
// Shift timing removed - unrestricted attendance

// Routes

// Login Route
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' });

        res.json({
            userId: user._id,
            username: user.username,
            role: user.role,
            fullName: user.fullName,
            assignedShift: user.assignedShift
        });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Change Password Route
app.post('/api/change-password', async (req, res) => {
    console.log('Change password request received for:', req.body.userId);
    const { userId, currentPassword, newPassword } = req.body;
    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) return res.status(401).json({ message: 'Current password incorrect' });

        user.password = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.json({ message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error changing password', error: error.message });
    }
});

// Register Student (Admin)
app.post('/api/students', async (req, res) => {
    const { fullName, username, password, feeStatus, recordStatus, assignedShift, dueDate, dueAmount, paidFees, feeRemarks, pendingDocs } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            fullName,
            username,
            password: hashedPassword,
            role: 'student',
            assignedShift: assignedShift || 'morning',
            feeStatus: feeStatus || 'No Dues',
            recordStatus: recordStatus || 'All Clear',
            recordStatus: recordStatus || 'All Clear',
            dueDate: dueDate || '',
            dueAmount: dueAmount || 0,
            paidFees: paidFees || 0,
            feeRemarks: feeRemarks || '',
            pendingDocs: pendingDocs || ''
        });
        await newUser.save();
        res.status(201).json({ message: 'Student registered successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error registering student', error: error.message });
    }
});

// Update Student Status (Admin)
app.patch('/api/students/:id', async (req, res) => {
    const { feeStatus, recordStatus, fullName, dueDate, dueAmount, paidFees, feeRemarks, pendingDocs, assignedShift, password } = req.body;
    try {
        const updateData = {};
        if (feeStatus !== undefined) updateData.feeStatus = feeStatus;
        if (recordStatus !== undefined) updateData.recordStatus = recordStatus;
        if (fullName !== undefined) updateData.fullName = fullName;
        if (dueDate !== undefined) updateData.dueDate = dueDate;
        if (dueAmount !== undefined) updateData.dueAmount = dueAmount;
        if (paidFees !== undefined) updateData.paidFees = paidFees;
        if (feeRemarks !== undefined) updateData.feeRemarks = feeRemarks;
        if (pendingDocs !== undefined) updateData.pendingDocs = pendingDocs;
        if (assignedShift !== undefined) updateData.assignedShift = assignedShift;

        if (password) {
            updateData.password = await bcrypt.hash(password, 10);
        }

        const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true });
        if (!user) return res.status(404).json({ message: 'Student not found' });
        res.json({ message: 'Student updated successfully', user });
    } catch (error) {
        res.status(500).json({ message: 'Error updating student', error: error.message });
    }
});

// Delete Student (Admin)
app.delete('/api/students/:id', async (req, res) => {
    try {
        const user = await User.findByIdAndDelete(req.params.id);
        if (!user) return res.status(404).json({ message: 'Student not found' });
        // Delete associated attendance records as well
        await Attendance.deleteMany({ studentId: req.params.id });
        res.json({ message: 'Student and attendance records deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting student', error: error.message });
    }
});

// Image Storage Helper (ImgBB Integration)
async function uploadToImgBB(base64Image) {
    if (!base64Image) return null;
    try {
        const apiKey = process.env.IMGBB_API_KEY;
        if (!apiKey || apiKey === 'YOUR_FREE_IMGBB_KEY') return base64Image; // Fallback to base64 if no key

        const formData = new URLSearchParams();
        // Remove the 'data:image/jpeg;base64,' prefix for ImgBB
        const cleanedImage = base64Image.replace(/^data:image\/\w+;base64,/, "");
        formData.append("image", cleanedImage);

        const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
            method: "POST",
            body: formData,
        });

        const result = await response.json();
        return result.success ? result.data.url : base64Image;
    } catch (err) {
        console.error("ImgBB Upload Failed:", err);
        return base64Image;
    }
}

// Mark Attendance
app.post('/api/mark-attendance', async (req, res) => {
    const { userId, type, userLat, userLng, qrCodeData, photo } = req.body;

    try {
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });

        // 1. QR Verification (Relaxed for Custom Code)
        if (!qrCodeData) {
            return res.status(403).json({ message: 'No QR Code detected.' });
        }
        // Strict check disabled to allow custom user QR code
        // if (qrCodeData !== QR_SECRET) { ... }

        // 2. Geofencing 
        if (userLat && userLng) {
            const distance = geolib.getDistance(
                { latitude: userLat, longitude: userLng },
                OFFICE_LOCATION
            );

            if (distance > RADIUS_METERS) {
                return res.status(403).json({ message: `Location mismatch (${distance}m). Please stay at the office.` });
            }
        } else {
            return res.status(400).json({ message: 'GPS data required.' });
        }

        // 3. Image Upload to External Platform (ImgBB)
        const imageUrl = await uploadToImgBB(photo);

        // 4. Time Check (Optional removed per user request)
        // Restricted shifts are now disabled. 

        const todayStr = new Date().toISOString().split('T')[0];
        let record = await Attendance.findOne({ studentId: userId, date: todayStr });

        if (type === 'checkin') {
            if (record && record.checkInTime) {
                return res.status(400).json({ message: 'Already checked in for today.' });
            }
            if (!record) {
                record = new Attendance({
                    studentId: userId,
                    date: todayStr,
                    checkInTime: new Date(),
                    locationVerified: true,
                    checkInPhoto: imageUrl // Store the cloud URL for check-in
                });
            } else {
                record.checkInTime = new Date();
                record.locationVerified = true;
                record.checkInPhoto = imageUrl;
            }
        }
        else if (type === 'checkout') {
            if (!record || !record.checkInTime) {
                return res.status(400).json({ message: 'Must check in before checking out.' });
            }
            if (record.checkOutTime) {
                return res.status(400).json({ message: 'Already checked out for today.' });
            }
            record.checkOutTime = new Date();
            record.checkOutPhoto = imageUrl; // Store the cloud URL for check-out
        }

        await record.save();
        res.json({ message: `${type === 'checkin' ? 'Checked In' : 'Checked Out'} successfully!` });

    } catch (error) {
        res.status(500).json({ message: 'Error marking attendance', error: error.message });
    }
});

// Get Today's Attendance (Admin)
app.get('/api/attendance/today', async (req, res) => {
    const todayStr = new Date().toISOString().split('T')[0];
    try {
        const records = await Attendance.find({ date: todayStr }).populate('studentId', 'fullName assignedShift');
        res.json(records);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching attendance', error: error.message });
    }
});

// Get All Attendance Records (Report)
app.get('/api/attendance/report', async (req, res) => {
    try {
        const records = await Attendance.find().populate('studentId', 'fullName username assignedShift').sort({ date: -1, checkInTime: -1 });
        res.json(records);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching report', error: error.message });
    }
});

// Get Attendance Records by Date Range (Report)
app.get('/api/attendance/range-report', async (req, res) => {
    const { startDate, endDate, studentId } = req.query; // YYYY-MM-DD
    try {
        const query = {
            date: { $gte: startDate, $lte: endDate }
        };

        if (studentId) {
            query.studentId = studentId;
        }

        const records = await Attendance.find(query).populate('studentId', 'fullName username assignedShift').sort({ date: 1, checkInTime: 1 });

        res.json(records);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching range report', error: error.message });
    }
});

// Get All Students (Admin)
app.get('/api/all-students', async (req, res) => {
    try {
        const students = await User.find({ role: 'student' });
        res.json(students);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching students', error: error.message });
    }
});

// Get Single Student details
app.get('/api/students/:id', async (req, res) => {
    try {
        const student = await User.findById(req.params.id);
        if (!student) return res.status(404).json({ message: 'Not found' });
        res.json(student);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching details' });
    }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}

module.exports = app;
