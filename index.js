require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const http = require('http');
const fs = require('fs');

// ==================== HTTP SERVER FOR RENDER ====================
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Health check server listening on port ${PORT}`);
});

// ==================== CONFIG ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_FILE_SIZE = 2000 * 1024 * 1024; // 2GB

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set in .env file');
  process.exit(1);
}

if (!TMDB_API_KEY) {
  console.error('❌ TMDB_API_KEY not set in .env file');
  process.exit(1);
}

console.log('✅ Bot configuration loaded');

// ==================== TMDB API ====================
class TMDBAPI {
  constructor() {
    this.apiKey = TMDB_API_KEY;
    this.baseUrl = 'https://api.themoviedb.org/3';
    this.imageBase = 'https://image.tmdb.org/t/p/w500';
  }

  async searchMovie(query) {
    try {
      const url = `${this.baseUrl}/search/multi?api_key=${this.apiKey}&query=${encodeURIComponent(query)}`;
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.data.results && response.data.results.length > 0) {
        const results = [];
        for (const item of response.data.results.slice(0, 5)) {
          const isTV = item.media_type === 'tv';
          let details = null;
          try {
            const detailUrl = `${this.baseUrl}/${isTV ? 'tv' : 'movie'}/${item.id}?api_key=${this.apiKey}`;
            const detailResponse = await axios.get(detailUrl, { timeout: 10000 });
            details = detailResponse.data;
          } catch (e) {}
          
          results.push({
            id: item.id,
            title: item.title || item.name || 'Unknown',
            year: item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : ''),
            overview: item.overview || 'No synopsis available',
            rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A',
            poster: item.poster_path ? `${this.imageBase}${item.poster_path}` : null,
            mediaType: isTV ? 'TV Series' : 'Movie',
            genres: details?.genres ? details.genres.map(g => g.name).slice(0, 3) : [],
            runtime: details?.runtime || details?.episode_run_time?.[0] || 'N/A',
          });
        }
        return results;
      }
    } catch (error) {
      console.error('TMDB error:', error.message);
    }
    return [];
  }

  async getMovieDetails(id, mediaType) {
    try {
      const type = mediaType === 'TV Series' ? 'tv' : 'movie';
      const url = `${this.baseUrl}/${type}/${id}?api_key=${this.apiKey}`;
      const response = await axios.get(url, { timeout: 10000 });
      const data = response.data;
      
      return {
        title: data.title || data.name,
        year: data.release_date ? data.release_date.split('-')[0] : (data.first_air_date ? data.first_air_date.split('-')[0] : ''),
        overview: data.overview || 'No synopsis available',
        rating: data.vote_average ? data.vote_average.toFixed(1) : 'N/A',
        poster: data.poster_path ? `${this.imageBase}${data.poster_path}` : null,
        backdrop: data.backdrop_path ? `${this.imageBase}${data.backdrop_path}` : null,
        genres: data.genres ? data.genres.map(g => g.name) : [],
        runtime: data.runtime || data.episode_run_time?.[0] || 'N/A',
        status: data.status || 'Unknown',
        voteCount: data.vote_count || 0,
        imdbId: data.imdb_id || null,
      };
    } catch (error) {
      console.error('Movie details error:', error.message);
    }
    return null;
  }
}

// ==================== GEMINI API ====================
class GeminiAPI {
  constructor() {
    this.apiKey = GEMINI_API_KEY;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
  }

  async findDownloadLink(title, year) {
    if (!this.apiKey) return null;

    try {
      const prompt = `
        Find a direct download link for the movie: "${title} (${year})".
        
        Search these sources:
        - Archive.org
        - Public domain movie sites
        - Any direct MP4/MKV link
        
        Return ONLY the direct download URL as plain text.
        If no direct link exists, return "NONE".
      `;

      const response = await axios.post(
        `${this.baseUrl}?key=${this.apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 20000
        }
      );

      const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (text && text !== 'NONE' && text.startsWith('http')) {
        return text.trim();
      }
    } catch (error) {
      console.error('Gemini error:', error.message);
    }
    return null;
  }
}

// ==================== DOWNLOADER ====================
class Downloader {
  async downloadFile(url, filename) {
    try {
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.google.com/'
        },
        timeout: 300000,
        maxContentLength: MAX_FILE_SIZE,
        maxBodyLength: MAX_FILE_SIZE
      });

      const writer = fs.createWriteStream(filename);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          const stats = fs.statSync(filename);
          if (stats.size > MAX_FILE_SIZE) {
            fs.unlinkSync(filename);
            reject(new Error('File exceeds 2GB limit'));
          } else {
            resolve(filename);
          }
        });
        writer.on('error', reject);
      });
    } catch (error) {
      console.error('Download error:', error.message);
      throw error;
    }
  }
}

// ==================== BOT ====================
const bot = new Telegraf(BOT_TOKEN);
const tmdb = new TMDBAPI();
const gemini = new GeminiAPI();
const downloader = new Downloader();

// ---------- START ----------
bot.start(async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎬 Search Movie', 'search_movie')],
    [Markup.button.callback('📺 Search TV Series', 'search_tv')],
    [Markup.button.callback('🔥 Popular', 'popular')],
    [Markup.button.callback('❓ Help', 'help')]
  ]);

  await ctx.replyWithMarkdown(
    `🎬 *CineverseAI - Movie Download Bot*\n\n` +
    `Welcome! Choose an option below:`,
    keyboard
  );
});

// ---------- BUTTON: SEARCH MOVIE ----------
bot.action('search_movie', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(
    `🎬 *Search Movie*\n\n` +
    `Send me a movie name:\n` +
    `Example: \`Inception\``,
    Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back', 'back_to_menu')]
    ])
  );
  ctx.session = { searchType: 'movie' };
});

// ---------- BUTTON: SEARCH TV ----------
bot.action('search_tv', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(
    `📺 *Search TV Series*\n\n` +
    `Send me a series name:\n` +
    `Example: \`Breaking Bad\``,
    Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back', 'back_to_menu')]
    ])
  );
  ctx.session = { searchType: 'tv' };
});

// ---------- BUTTON: POPULAR ----------
bot.action('popular', async (ctx) => {
  await ctx.answerCbQuery('Loading popular movies...');
  await handlePopular(ctx);
});

// ---------- BUTTON: HELP ----------
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(
    `📖 *How to use CineverseAI:*\n\n` +
    `1️⃣ Click "Search Movie" or "Search TV"\n` +
    `2️⃣ Type the name of what you want\n` +
    `3️⃣ Select from the search results\n` +
    `4️⃣ Click "Download" to get the file\n\n` +
    `⚡ *Tips:*\n` +
    `• Use exact titles for better results\n` +
    `• Add year (e.g., "Inception 2010")\n` +
    `• Keep chat open during download\n` +
    `• Files up to 2GB\n\n` +
    `📦 *Max size:* 2GB\n` +
    `⏱️ *Download time:* 3-10 minutes`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Back', 'back_to_menu')]
    ])
  );
});

// ---------- BUTTON: BACK TO MENU ----------
bot.action('back_to_menu', async (ctx) => {
  await ctx.answerCbQuery();
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎬 Search Movie', 'search_movie')],
    [Markup.button.callback('📺 Search TV Series', 'search_tv')],
    [Markup.button.callback('🔥 Popular', 'popular')],
    [Markup.button.callback('❓ Help', 'help')]
  ]);
  await ctx.replyWithMarkdown(`🎬 *Main Menu*\n\nChoose an option:`, keyboard);
});

// ---------- HANDLE SEARCH RESULTS ----------
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  const query = ctx.message.text.trim();
  const searchType = ctx.session?.searchType || 'movie';
  
  await handleSearch(ctx, query, searchType);
});

// ---------- SEARCH LOGIC ----------
async function handleSearch(ctx, query, searchType) {
  const statusMsg = await ctx.reply(`🔍 Searching for *${query}*...`, { parse_mode: 'Markdown' });
  
  try {
    const results = await tmdb.searchMovie(query);
    
    if (!results || results.length === 0) {
      await ctx.reply(
        `❌ No results found for *${query}*.\n\n` +
        `💡 *Try:*\n` +
        `• Using the English title\n` +
        `• Adding the year (e.g., "Inception 2010")\n` +
        `• A different spelling`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Show results as buttons
    const buttons = results.map(movie => {
      let label = `${movie.title}`;
      if (movie.year) label += ` (${movie.year})`;
      if (movie.rating !== 'N/A') label += ` ⭐${movie.rating}`;
      return [Markup.button.callback(label, `details_${movie.id}_${movie.mediaType.replace(' ', '_')}`)];
    });
    
    buttons.push([Markup.button.callback('🔙 Back', 'back_to_menu')]);

    await ctx.replyWithMarkdown(
      `📋 *Search Results for:* ${query}\n\n` +
      `Click a button to see details:`,
      Markup.inlineKeyboard(buttons)
    );
    
  } catch (error) {
    console.error('Search error:', error.message);
    await ctx.reply(`❌ Error: ${error.message}`);
  }
}

// ---------- SHOW MOVIE DETAILS ----------
bot.action(/details_(\d+)_(Movie|TV_Series)/, async (ctx) => {
  await ctx.answerCbQuery('Loading details...');
  
  const id = parseInt(ctx.match[1]);
  const mediaType = ctx.match[2].replace('_', ' ');
  
  try {
    const details = await tmdb.getMovieDetails(id, mediaType);
    if (!details) {
      await ctx.reply('❌ Could not load details. Please try again.');
      return;
    }

    // Build message
    let message = `🎬 *${details.title}*`;
    if (details.year) message += ` (${details.year})`;
    message += `\n📺 Type: ${mediaType}`;
    if (details.rating !== 'N/A') message += `\n⭐ Rating: ${details.rating}/10 (${details.voteCount} votes)`;
    if (details.genres.length > 0) message += `\n🎭 ${details.genres.join(', ')}`;
    if (details.runtime !== 'N/A') message += `\n⏱️ Runtime: ${details.runtime} min`;
    if (details.status) message += `\n📌 Status: ${details.status}`;
    if (details.overview && details.overview !== 'No synopsis available') {
      message += `\n\n📝 ${details.overview.substring(0, 400)}...`;
    }

    // Buttons
    const buttons = [
      [Markup.button.callback('📥 Download', `download_${id}_${mediaType.replace(' ', '_')}`)],
      [Markup.button.callback('🔙 Back to Results', 'back_to_search')],
      [Markup.button.callback('🏠 Main Menu', 'back_to_menu')]
    ];

    // Send poster with details
    if (details.poster) {
      try {
        await ctx.replyWithPhoto(details.poster, {
          caption: message,
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        });
      } catch (e) {
        await ctx.replyWithMarkdown(message, Markup.inlineKeyboard(buttons));
      }
    } else {
      await ctx.replyWithMarkdown(message, Markup.inlineKeyboard(buttons));
    }
    
  } catch (error) {
    console.error('Details error:', error.message);
    await ctx.reply('❌ Error loading details. Please try again.');
  }
});

// ---------- DOWNLOAD ----------
bot.action(/download_(\d+)_(Movie|TV_Series)/, async (ctx) => {
  await ctx.answerCbQuery('Searching for download link...');
  
  const id = parseInt(ctx.match[1]);
  const mediaType = ctx.match[2].replace('_', ' ');
  
  try {
    const details = await tmdb.getMovieDetails(id, mediaType);
    if (!details) {
      await ctx.reply('❌ Could not load movie details.');
      return;
    }

    await ctx.reply(`🔍 *Searching for download link for:* ${details.title}...`, { parse_mode: 'Markdown' });

    const downloadUrl = await gemini.findDownloadLink(details.title, details.year);

    if (!downloadUrl) {
      await ctx.reply(
        `⚠️ No download link found for *${details.title}*.\n\n` +
        `💡 *Try:*\n` +
        `• A different movie\n` +
        `• A smaller quality (720p)`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await ctx.reply(
      `📥 *Downloading ${details.title}...*\n` +
      `⏳ This takes 3-10 minutes\n` +
      `💡 Keep this chat open!`,
      { parse_mode: 'Markdown' }
    );

    const filename = `/tmp/${details.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`;
    let downloadedFile = null;

    try {
      downloadedFile = await downloader.downloadFile(downloadUrl, filename);
    } catch (error) {
      console.error('Download error:', error.message);
    }

    if (downloadedFile && fs.existsSync(downloadedFile)) {
      const stats = fs.statSync(downloadedFile);
      const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
      
      await ctx.replyWithVideo(
        { source: downloadedFile },
        { 
          caption: `🎬 *${details.title}*\n📦 Size: ${fileSizeMB}MB\n✅ Download complete!`,
          parse_mode: 'Markdown',
          supports_streaming: true
        }
      );
      
      fs.unlinkSync(downloadedFile);
      await ctx.reply('✅ Movie sent! Enjoy watching 🎥');
      
    } else {
      await ctx.reply(
        `❌ Download failed.\n\n` +
        `💡 *Try:*\n` +
        `• A different movie\n` +
        `• A smaller version`,
        { parse_mode: 'Markdown' }
      );
    }
    
  } catch (error) {
    console.error('Download error:', error.message);
    await ctx.reply(`❌ Error: ${error.message}`);
  }
});

// ---------- BACK TO SEARCH ----------
bot.action('back_to_search', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(`🔍 *Send me a new movie name to search!*`, { parse_mode: 'Markdown' });
});

// ---------- POPULAR ----------
async function handlePopular(ctx) {
  try {
    const url = `${tmdb.baseUrl}/movie/popular?api_key=${tmdb.apiKey}`;
    const response = await axios.get(url, { timeout: 10000 });
    
    const movies = response.data.results.slice(0, 5);
    const buttons = movies.map(movie => {
      const title = `${movie.title} (${movie.release_date?.split('-')[0] || 'N/A'})`;
      return [Markup.button.callback(title, `details_${movie.id}_Movie`)];
    });
    
    buttons.push([Markup.button.callback('🔙 Back', 'back_to_menu')]);
    
    await ctx.replyWithMarkdown(
      `🔥 *Popular Movies*\n\n` +
      `Click a movie to see details:`,
      Markup.inlineKeyboard(buttons)
    );
    
  } catch (error) {
    console.error('Popular error:', error.message);
    await ctx.reply('❌ Error loading popular movies.');
  }
}

// ---------- ERROR HANDLING ----------
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('⚠️ An error occurred. Please try again.');
});

// ==================== START ====================
async function startBot() {
  try {
    const botInfo = await bot.telegram.getMe();
    console.log(`✅ Bot connected: @${botInfo.username}`);
    console.log(`✅ TMDb API loaded`);
    if (GEMINI_API_KEY) {
      console.log(`✅ Gemini API loaded`);
    }
    
    await bot.launch();
    console.log('✅ Bot is running!');
    console.log(`📡 Bot username: @${botInfo.username}`);
    console.log(`🔗 Bot link: https://t.me/${botInfo.username}`);
  } catch (error) {
    console.error('❌ Failed to start bot:', error.message);
    process.exit(1);
  }
}

startBot();
