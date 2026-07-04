require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { message } = require('telegraf/filters');
const { Pool } = require('pg');
const axios = require('axios');
const cheerio = require('cheerio');

// ==================== CONFIG ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS?.split(',').map(id => parseInt(id.trim())) || [];
const STORAGE_CHANNEL_ID = parseInt(process.env.STORAGE_CHANNEL_ID);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// ==================== DATABASE ====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

// ==================== TMDB (Direct API Call) ====================
async function searchTMDB(query) {
  if (!TMDB_API_KEY) {
    console.warn('⚠️ TMDB_API_KEY not set. Skipping TMDb search.');
    return [];
  }
  try {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
    const response = await axios.get(url);
    return response.data.results || [];
  } catch (error) {
    console.error('TMDB error:', error.message);
    return [];
  }
}

// ==================== SCRAPER ====================
class MovieScraper {
  constructor() {
    this.client = axios.create({
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000
    });
  }

  async searchYts(query) {
    try {
      const searchUrl = `https://yts.mx/browse-movies/${encodeURIComponent(query)}/all/all/0/latest`;
      const response = await this.client.get(searchUrl);
      const $ = cheerio.load(response.data);
      
      const movieTile = $('.movie-tile').first();
      if (!movieTile.length) return null;
      
      const link = movieTile.find('a').first();
      if (!link.attr('href')) return null;
      
      const detailUrl = `https://yts.mx${link.attr('href')}`;
      const detailResponse = await this.client.get(detailUrl);
      const $$ = cheerio.load(detailResponse.data);
      
      const magnetTag = $$('a[href^="magnet:?"]').first();
      if (magnetTag.length) {
        return {
          title: link.text().trim() || query,
          magnet: magnetTag.attr('href'),
          quality: '720p'
        };
      }
    } catch (error) {
      console.error('YTS error:', error.message);
    }
    return null;
  }

  async search1337x(query) {
    try {
      const searchUrl = `https://1337x.to/search/${encodeURIComponent(query)}/1/`;
      const response = await this.client.get(searchUrl);
      const $ = cheerio.load(response.data);
      
      const row = $('tr').first();
      if (!row.length) return null;
      
      const nameTag = row.find('a.name').first();
      if (!nameTag.length) return null;
      
      const magnetLink = row.find('a[href^="magnet:?"]').first();
      if (magnetLink.length) {
        return {
          title: nameTag.text().trim(),
          magnet: magnetLink.attr('href'),
          quality: '1080p'
        };
      }
    } catch (error) {
      console.error('1337x error:', error.message);
    }
    return null;
  }

  async getDownloadLink(query) {
    let result = await this.searchYts(query);
    if (result) return result;
    result = await this.search1337x(query);
    if (result) return result;
    return null;
  }
}

// ==================== BOT ====================
const bot = new Telegraf(BOT_TOKEN);
const scraper = new MovieScraper();

// ---------- START ----------
bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    `🎬 *CineverseAI Bot*\n\n` +
    `Send me a movie name to search.\n` +
    `Use: /search Inception or just type the name.\n\n` +
    `👑 *Admins:* Use /upload to add movies.`
  );
});

// ---------- SEARCH COMMAND ----------
bot.command('search', async (ctx) => {
  const query = ctx.message.text.replace('/search', '').trim();
  if (!query) {
    return ctx.reply('Please provide a movie name. Example: `/search Inception`');
  }
  await handleSearch(ctx, query);
});

// ---------- UPLOAD COMMAND (ADMIN ONLY) ----------
bot.command('upload', async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) {
    return ctx.reply('⛔ Admin only.');
  }

  const args = ctx.message.text.replace('/upload', '').trim().split('|');
  if (args.length < 3) {
    return ctx.reply(
      'Usage: `/upload Movie Title | 2024 | file_id`\n' +
      'Forward a movie file to @ChannelBot to get its file_id.'
    );
  }

  const title = args[0].trim();
  const year = parseInt(args[1].trim());
  const fileId = args[2].trim();

  // Get TMDb info
  let tmdbId = null;
  const results = await searchTMDB(title);
  if (results.length > 0) {
    tmdbId = results[0].id;
  }

  await addMovie(title, year, tmdbId, fileId, '720p', 0, ctx.from.id);
  await ctx.reply(`✅ Added: *${title} (${year})*`, { parse_mode: 'Markdown' });
});

// ---------- AUTO-SEARCH ANY TEXT ----------
bot.on(message('text'), async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  await handleSearch(ctx, ctx.message.text);
});

// ---------- CORE SEARCH LOGIC ----------
async function handleSearch(ctx, query) {
  // 1. Check cache
  const cached = await searchMovie(query);
  if (cached.length > 0) {
    await sendCachedMovie(ctx, cached);
    return;
  }

  // 2. Scrape online
  await ctx.reply('🔍 Searching online sources... (this may take 20-30s)');
  
  const result = await scraper.getDownloadLink(query);
  if (!result) {
    return ctx.reply('❌ No sources found. Try a different title.');
  }

  // 3. Send magnet link
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.url('🧲 Magnet Link', result.magnet)],
    [Markup.button.callback('📥 Download Torrent', `torrent_${query}`)]
  ]);

  await ctx.replyWithMarkdown(
    `🎬 *${result.title}*\n` +
    `Quality: \`${result.quality}\`\n` +
    `Source: YTS\n\n` +
    `⚠️ *Use a VPN and antivirus software.*`,
    keyboard
  );

  // 4. Admin hint
  if (ADMIN_IDS.includes(ctx.from.id)) {
    await ctx.reply(
      '💡 *Admin:* To cache this movie, upload to storage channel and use:\n' +
      `/upload ${result.title} | 2024 | file_id_here`,
      { parse_mode: 'Markdown' }
    );
  }
}

// ---------- SEND CACHED MOVIE ----------
async function sendCachedMovie(ctx, movies) {
  for (const movie of movies.slice(0, 3)) {
    try {
      await ctx.telegram.copyMessage(
        ctx.chat.id,
        STORAGE_CHANNEL_ID,
        parseInt(movie.file_id)
      );
      await ctx.replyWithMarkdown(
        `✅ *${movie.title} (${movie.year})*\n` +
        `Quality: \`${movie.quality}\``
      );
    } catch (error) {
      console.error('Failed to send cached movie:', error.message);
      await ctx.reply('❌ This file is no longer available on Telegram.');
    }
  }
}

// ---------- CALLBACK HANDLER ----------
bot.action(/torrent_.+/, async (ctx) => {
  await ctx.answerCbQuery('Magnet link sent above. Use a torrent client.');
});

// ---------- ERROR HANDLING ----------
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('⚠️ An error occurred. Please try again.');
});

// ==================== START ====================
async function startBot() {
  try {
    await initDatabase();
    await bot.launch();
    console.log('✅ Bot is running!');
    console.log(`📡 Bot username: @${bot.botInfo.username}`);
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

startBot();

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
