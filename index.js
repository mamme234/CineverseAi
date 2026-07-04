require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { message } = require('telegraf/filters');
const axios = require('axios');
const http = require('http');
const { MovieScraper } = require('./scraper');
const { connectDB, addMovie, searchMovie } = require('./database');

// ==================== DUMMY HTTP SERVER FOR RENDER ====================
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Health check server listening on port ${PORT}`);
});

// ==================== CONFIG ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS?.split(',').map(id => parseInt(id.trim())) || [];
const STORAGE_CHANNEL_ID = parseInt(process.env.STORAGE_CHANNEL_ID);
const TMDB_API_KEY = process.env.TMDB_API_KEY;

// ==================== TMDB ====================
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
    await connectDB();
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
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  process.exit(0);
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
