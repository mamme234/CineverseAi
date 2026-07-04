const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create tables if they don't exist
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS movies (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        year INTEGER,
        tmdb_id INTEGER UNIQUE,
        file_id TEXT NOT NULL,
        quality TEXT DEFAULT '720p',
        file_size INTEGER,
        added_by INTEGER,
        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_movies_title ON movies(title);
      CREATE INDEX IF NOT EXISTS idx_movies_tmdb ON movies(tmdb_id);
    `);
    console.log('✅ Database initialized');
  } finally {
    client.release();
  }
}

async function addMovie(title, year, tmdbId, fileId, quality, fileSize, addedBy) {
  const query = `
    INSERT INTO movies (title, year, tmdb_id, file_id, quality, file_size, added_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (tmdb_id) DO UPDATE SET file_id = EXCLUDED.file_id
    RETURNING id
  `;
  const result = await pool.query(query, [title, year, tmdbId, fileId, quality, fileSize, addedBy]);
  return result.rows[0].id;
}

async function searchMovie(query) {
  const result = await pool.query(
    `SELECT title, year, file_id, quality, file_size 
     FROM movies 
     WHERE title ILIKE $1
     ORDER BY year DESC
     LIMIT 10`,
    [`%${query}%`]
  );
  return result.rows;
}

async function getMovieByTmdb(tmdbId) {
  const result = await pool.query(
    'SELECT * FROM movies WHERE tmdb_id = $1',
    [tmdbId]
  );
  return result.rows[0];
}

module.exports = {
  initDatabase,
  addMovie,
  searchMovie,
  getMovieByTmdb,
  pool,
};
