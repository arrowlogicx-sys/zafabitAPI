 
require('dotenv').config();
const mongoose = require('mongoose');
const { assertSafePerformanceDatabase } = require('./config');

const main = async () => {
  const uri = process.env.PERF_MONGODB_URI;
  const databaseName = assertSafePerformanceDatabase(uri, 'drop synthetic data');
  if (process.env.PERF_ALLOW_DROP !== 'true') {
    throw new Error(
      'Refusing to drop database: set PERF_ALLOW_DROP=true in addition to PERF_ALLOW_SEED=true.',
    );
  }
  await mongoose.connect(uri);
  await mongoose.connection.db.dropDatabase();
  console.log(`Dropped dedicated synthetic performance database ${databaseName}.`);
};

main()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
