require('dotenv').config();
const { getJwtSecret } = require('./utils/authToken');
getJwtSecret();
const http = require('http');
const app = require('./app');
const mongoose = require('mongoose');

const PORT = process.env.PORT || 5001;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/cleaningService';

const server = http.createServer(app);
const { init: initSocket } = require('./utils/socket');
const { startDispatchWorker } = require('./utils/dispatchQueue');

initSocket(server);

mongoose
  .connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    startDispatchWorker();
    server.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Database connection error:', err);
    process.exit(1);
  });
