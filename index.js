require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { message } = require('telegraf/filters');
const { initDatabase, searchMovie, addMovie } = require('./database');
const { MovieScraper } = require('./scraper');

// Config
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = process.env.ADMIN_IDS?.split(',').map(id => parseInt(id.trim())) || [];
const STORAGE_CHANNEL_ID = parseInt(process.env.STORAGE_CHANNEL_ID);

// Initialize
const bot = new Telegraf(BOT_TOKEN);
const scraper = new MovieScraper();

// Start
bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    `🎬 *Movie Download Bot*\n\n` +
    `Send me a movie name to search.\n` +
    `Use: /search Inception or just type the name.\n\n` +
    `👑 *Admins:* Use /upload to add movies.`
  );
});

// Search command
bot.command('search', async (ctx) => {
  const query = ctx.message.text.replace('/search', '').trim();
  if (!query) {
    return ctx.reply('Please provide a movie name. Example: `/search Inception`');
  }
  await handleSearch(ctx, query);
});

// Upload command (admin only)
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

  // Try TMDb lookup
  let tmdbId = null;
  try {
    const tmdb = require('tmdb-api');
    tmdb.apiKey = process.env.TMDB_API_KEY;
    const results = await tmdb.searchMovies({ query: title });
    if (results.results && results.results.length > 0) {
      tmdbId = results.results[0].id;
    }
  } catch (error) {
    console.error('TMDb lookup failed:', error.message);
  }

  await addMovie(title, year, tmdbId, fileId, '720p', 0, ctx.from.id);
  await ctx.reply(`✅ Added: *${title} (${year})*`, { parse_mode: 'Markdown' });
});

// Auto-search any text message
bot.on(message('text'), async (ctx) => {
  // Ignore commands
  if (ctx.message.text.startsWith('/')) return;
  await handleSearch(ctx, ctx.message.text);
});

// Core search logic
async function handleSearch(ctx, query) {
  // 1. Check cache
  const cached = await searchMovie(query);
  if (cached.length > 0) {
    await sendCachedMovie(ctx, cached);
    return;
  }

  // 2. Scrape online sources
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

// Callback handlers
bot.action(/torrent_.+/, async (ctx) => {
  await ctx.answerCbQuery('Magnet link sent above. Use a torrent client.');
});

// Error handling
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('⚠️ An error occurred. Please try again.');
});

// Start the bot
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
