const { MongoClient } = require('mongodb');

let client = null;
let db = null;

async function connectDB() {
  if (client && db) return db;
  
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  
  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  
  await client.connect();
  console.log('✅ Connected to MongoDB');
  
  db = client.db('cineverse');
  await initDatabase();
  return db;
}

async function initDatabase() {
  const collection = db.collection('movies');
  
  // Create indexes
  await collection.createIndex({ title: 'text' });
  await collection.createIndex({ tmdb_id: 1 }, { unique: true, sparse: true });
  await collection.createIndex({ added_at: -1 });
  
  console.log('✅ Database indexes created');
}

async function addMovie(title, year, tmdbId, fileId, quality, fileSize, addedBy) {
  const collection = db.collection('movies');
  
  const movie = {
    title,
    year,
    tmdb_id: tmdbId,
    file_id: fileId,
    quality: quality || '720p',
    file_size: fileSize || 0,
    added_by: addedBy,
    added_at: new Date()
  };
  
  // Update if exists, insert if not
  const result = await collection.updateOne(
    { tmdb_id: tmdbId },
    { $set: movie },
    { upsert: true }
  );
  
  return result.upsertedId || result.modifiedCount;
}

async function searchMovie(query) {
  const collection = db.collection('movies');
  
  const results = await collection.find(
    { $text: { $search: query } },
    { score: { $meta: 'textScore' } }
  )
  .sort({ score: { $meta: 'textScore' }, year: -1 })
  .limit(10)
  .toArray();
  
  return results;
}

async function getMovieByTmdb(tmdbId) {
  const collection = db.collection('movies');
  return await collection.findOne({ tmdb_id: tmdbId });
}

async function getAllMovies(limit = 50) {
  const collection = db.collection('movies');
  return await collection.find({})
    .sort({ added_at: -1 })
    .limit(limit)
    .toArray();
}

async function deleteMovie(tmdbId) {
  const collection = db.collection('movies');
  return await collection.deleteOne({ tmdb_id: tmdbId });
}

async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('✅ MongoDB connection closed');
  }
}

module.exports = {
  connectDB,
  initDatabase,
  addMovie,
  searchMovie,
  getMovieByTmdb,
  getAllMovies,
  deleteMovie,
  closeDB
};
