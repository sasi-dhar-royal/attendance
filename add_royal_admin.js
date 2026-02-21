require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

async function addAdmin() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to database...');

        const username = 'royal';
        const password = 'royal123';

        const exists = await User.findOne({ username });
        if (exists) {
            console.log(`Admin user "${username}" already exists.`);
            process.exit(0);
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({
            username,
            password: hashedPassword,
            role: 'admin',
            fullName: 'Royal Admin'
        });

        console.log(`✅ Admin user created successfully!`);
        console.log(`Username: ${username}`);
        console.log(`Password: ${password}`);

        process.exit(0);
    } catch (err) {
        console.error('❌ Error creating admin:', err.message);
        if (err.errors) {
            Object.keys(err.errors).forEach(key => {
                console.error(`- ${key}: ${err.errors[key].message}`);
            });
        }
        process.exit(1);
    }
}

addAdmin();
