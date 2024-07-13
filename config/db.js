const mongoose = require('mongoose');
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
});

const connectDB = async () => {
  try {
    // Connect the MongoClient to the server
    await client.connect();

    // Connect Mongoose to the MongoDB Atlas
    await mongoose.connect(uri, {
      dbName: 'testdb' // Ensure we're using the correct database
    });
    console.log('Mongoose connected');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit process with failure
  }
};

module.exports = connectDB;
