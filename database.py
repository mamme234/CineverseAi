import psycopg2
from psycopg2.extras import RealDictCursor
from config import DATABASE_URL

class Database:
    def __init__(self):
        self.conn = psycopg2.connect(DATABASE_URL)
        self._create_tables()
    
    def _create_tables(self):
        with self.conn.cursor() as cur:
            cur.execute("""
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
            """)
            self.conn.commit()
    
    def add_movie(self, title, year, tmdb_id, file_id, quality, file_size, added_by):
        with self.conn.cursor() as cur:
            cur.execute("""
                INSERT INTO movies (title, year, tmdb_id, file_id, quality, file_size, added_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (tmdb_id) DO UPDATE SET file_id = EXCLUDED.file_id
                RETURNING id
            """, (title, year, tmdb_id, file_id, quality, file_size, added_by))
            self.conn.commit()
            return cur.fetchone()[0]
    
    def search_movie(self, query):
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("""
                SELECT title, year, file_id, quality, file_size 
                FROM movies 
                WHERE title ILIKE %s
                ORDER BY year DESC
                LIMIT 10
            """, (f"%{query}%",))
            return cur.fetchall()
    
    def get_movie_by_tmdb(self, tmdb_id):
        with self.conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT * FROM movies WHERE tmdb_id = %s", (tmdb_id,))
            return cur.fetchone()
    
    def close(self):
        self.conn.close()
