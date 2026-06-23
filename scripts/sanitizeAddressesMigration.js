const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../src/models/User');
const CustomerProfile = require('../src/models/CustomerProfile');

async function migrate() {
  try {
    console.log('Connecting to database...');
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI is not defined in the environment variables.');
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    const users = await User.find({ addresses: { $exists: true, $not: { $size: 0 } } });
    console.log(`Found ${users.length} users with addresses.`);

    let updatedUsersCount = 0;
    let totalAddressesSanitized = 0;
    let profilesMigrated = 0;

    for (const user of users) {
      let isModified = false;
      const defaults = user.addresses.filter((addr) => addr.isDefault === true);

      // 1. Enforce only one default address
      if (defaults.length > 1) {
        console.log(
          `User ${user.name || user.phone || user._id} has ${defaults.length} default addresses.`,
        );
        // Mark first default as true, others as false
        let firstDefaultFound = false;
        for (const addr of user.addresses) {
          if (addr.isDefault === true) {
            if (!firstDefaultFound) {
              firstDefaultFound = true;
            } else {
              addr.isDefault = false;
              totalAddressesSanitized++;
            }
          }
        }
        isModified = true;
      } else if (defaults.length === 0 && user.addresses.length > 0) {
        console.log(
          `User ${user.name || user.phone || user._id} has no default address. Setting first one to default.`,
        );
        user.addresses[0].isDefault = true;
        totalAddressesSanitized++;
        isModified = true;
      }

      // 2. Fetch global CustomerProfile propertyProfile and migrate to the default address if it is not already set
      const profile = await CustomerProfile.findOne({ user: user._id });
      if (profile && profile.propertyProfile) {
        const defaultAddress = user.addresses.find((addr) => addr.isDefault === true);
        if (defaultAddress) {
          const profileObj = profile.propertyProfile.toObject
            ? profile.propertyProfile.toObject()
            : profile.propertyProfile;

          // Let's check if the default address's propertyProfile has any fields configured
          const addrProfile = defaultAddress.propertyProfile;
          const hasExistingProfile =
            addrProfile &&
            (addrProfile.bhkType ||
              addrProfile.homeType ||
              addrProfile.memberCount ||
              addrProfile.hasPets ||
              addrProfile.floor);

          if (!hasExistingProfile && Object.keys(profileObj).length > 0) {
            console.log(
              `Migrating propertyProfile details to default address for user ${user.name || user._id}`,
            );
            defaultAddress.propertyProfile = {
              bhkType: profileObj.bhkType,
              homeType: profileObj.homeType,
              memberCount: profileObj.memberCount,
              hasPets: profileObj.hasPets,
              petTemperament: profileObj.petTemperament,
              floor: profileObj.floor,
              cleaningFrequency: profileObj.cleaningFrequency,
              surfaceType: profileObj.surfaceType,
              estimatedServiceTime: profileObj.estimatedServiceTime,
            };
            isModified = true;
            profilesMigrated++;
          }
        }
      }

      if (isModified) {
        await user.save();
        updatedUsersCount++;
      }
    }

    console.log(`\nMigration Summary:`);
    console.log(`- Total users updated: ${updatedUsersCount}`);
    console.log(`- Total addresses default state fixed: ${totalAddressesSanitized}`);
    console.log(`- Profiles migrated to address level: ${profilesMigrated}`);
    console.log(`\nAddress migration completed successfully!`);
  } catch (error) {
    console.error('Migration execution failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Database disconnected.');
  }
}

migrate();
