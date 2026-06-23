const mongoose = require('mongoose');
const User = require('../src/models/User');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/test';

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');

    let admin = await User.findOne({ email: 'admin@zaffabit.com' });
    if (!admin) {
      admin = await User.create({
        firstName: 'Super',
        lastName: 'Admin',
        name: 'Super Admin',
        email: 'admin@zaffabit.com',
        phone: '+919999999999',
        role: 'admin',
        adminRole: 'super_admin',
        password: 'password123',
        isVerified: true,
      });
      console.log('Admin user created successfully:', admin.email, 'password: password123');
    } else {
      console.log('Admin user already exists:', admin.email);
      // Let's reset the password to password123 just in case
      admin.password = 'password123';
      admin.role = 'admin';
      admin.adminRole = 'super_admin';
      await admin.save();
      console.log('Admin user password reset to password123.');
    }
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await mongoose.disconnect();
  }
}

run();
