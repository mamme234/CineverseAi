require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const http = require('http');

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
const MAX_FILE_SIZE = 2000 * 1024 * 1024; // 2GB

// ==================== MOVIE SCRAPER ====================
class MovieScraper {
  constructor() {
    // Use rotating headers to avoid blocking
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
  }

  getHeaders() {
    const randomAgent = this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    return {
      'User-Agent': randomAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    };
  }

  // ---------- SOURCE 1: YTS (Most Reliable) ----------
  async searchYts(query) {
    try {
      const url = `https://yts.mx/browse-movies/${encodeURIComponent(query)}/all/all/0/latest`;
      const response = await axios.get(url, { headers: this.getHeaders(), timeout: 15000 });
      const $ = cheerio.load(response.data);
      
      const movieTile = $('.movie-tile').first();
      if (!movieTile.length) return null;
      
      const link = movieTile.find('a').first();
      if (!link.attr('href')) return null;
      
      const title = link.text().trim() || query;
      const year = $('.year', movieTile).text().trim() || '';
      
      // Get detail page for download link
      const detailUrl = `https://yts.mx${link.attr('href')}`;
      const detailResponse = await axios.get(detailUrl, { headers: this.getHeaders(), timeout: 15000 });
      const $$ = cheerio.load(detailResponse.data);
      
      // Find magnet link
      const magnet = $$('a[href^="magnet:?"]').first().attr('href');
      
      if (magnet) {
        return {
          title: `${title} ${year}`.trim(),
          magnet: magnet,
          source: 'YTS',
          quality: '720p'
        };
      }
    } catch (error) {
      console.error('YTS error:', error.message);
    }
    return null;
  }

  // ---------- SOURCE 2: 1337x (Fallback) ----------
  async search1337x(query) {
    try {
      const url = `https://1337x.to/search/${encodeURIComponent(query)}/1/`;
      const response = await axios.get(url, { headers: this.getHeaders(), timeout: 15000 });
      const $ = cheerio.load(response.data);
      
      const row = $('tr').first();
      if (!row.length) return null;
      
      const nameTag = row.find('a.name').first();
      const magnetLink = row.find('a[href^="magnet:?"]').first();
      
      if (nameTag.length && magnetLink.length) {
        return {
          title: nameTag.text().trim(),
          magnet: magnetLink.attr('href'),
          source: '1337x',
          quality: '1080p'
        };
      }
    } catch (error) {
      console.error('1337x error:', error.message);
    }
    return null;
  }

  // ---------- SOURCE 3: The Movie Database (For metadata only) ----------
  async searchTmdb(query) {
    try {
      const apiKey = process.env.TMDB_API_KEY;
      if (!apiKey) return null;
      
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(query)}`;
      const response = await axios.get(url);
      
      if (response.data.results && response.data.results.length > 0) {
        const movie = response.data.results[0];
        return {
          title: movie.title,
          year: movie.release_date ? movie.release_date.split('-')[0] : '',
          poster: `https://image.tmdb.org/t/p/w200${movie.poster_path}`,
          rating: movie.vote_average,
          overview: movie.overview
        };
      }
    } catch (error) {
      console.error('TMDb error:', error.message);
    }
    return null;
  }

  // ---------- MAIN SEARCH ----------
  async searchMovie(query) {
    // Try TMDb for metadata first
    const metadata = await this.searchTmdb(query);
    
    // Try YTS for download
    let result = await this.searchYts(query);
    if (result) {
      if (metadata) {
        result.title = metadata.title;
        result.year = metadata.year;
        result.poster = metadata.poster;
        result.rating = metadata.rating;
        result.overview = metadata.overview;
      }
      return result;
    }
    
    // Try 1337x as fallback
    result = await this.search1337x(query);
    if (result) return result;
    
    return null;
  }

  // ---------- DOWNLOAD FROM MAGNET (For actual file) ----------
  // Note: Magnet links need a torrent client to download
  // We'll send the magnet link and let user download via torrent client
  async getDownloadInfo(movieInfo) {
    if (movieInfo.magnet) {
      return {
        type: 'magnet',
        url: movieInfo.magnet,
        title: movieInfo.title,
        quality: movieInfo.quality
      };
    }
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
    `Send me a movie name and I'll find download links!\n\n` +
    `Examples:\n` +
    `\`Inception\`\n` +
    `\`The Dark Knight\`\n` +
    `\`Turkish series\`\n` +
    `\`Kdrama\`\n\n` +
    `📡 Results from YTS and 1337x\n` +
    `⚡ Magnet links provided for downloading`
  );
});

// ---------- HELP ----------
bot.command('help', async (ctx) => {
  await ctx.replyWithMarkdown(
    `📖 *How to use:*\n\n` +
    `1. Send any movie name\n` +
    `2. I'll search for download sources\n` +
    `3. Click the magnet link\n` +
    `4. Open in your torrent client\n\n` +
    `⚠️ *Use a VPN for privacy*\n` +
    `⚠️ *Large files may take time to download*`
  );
});

// ---------- AUTO-SEARCH ----------
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  await handleSearch(ctx, ctx.message.text);
});

// ---------- SEARCH LOGIC ----------
async function handleSearch(ctx, query) {
  const statusMsg = await ctx.reply(`🔍 Searching for *${query}*...`, { parse_mode: 'Markdown' });
  
  try {
    // Search for movie
    const result = await scraper.searchMovie(query);
    
    if (!result) {
      await ctx.reply(
        `❌ No results found for *${query}*.\n\n` +
        `Try:\n` +
        `• Using the English title\n` +
        `• Adding the year (e.g., "Inception 2010")\n` +
        `• A different movie`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Build response message
    let message = `🎬 *${result.title}*`;
    if (result.year) message += ` (${result.year})`;
    if (result.rating) message += `\n⭐ Rating: ${result.rating}/10`;
    if (result.overview) message += `\n\n📝 ${result.overview.substring(0, 200)}...`;
    message += `\n\n📡 Source: ${result.source}`;
    message += `\n📦 Quality: ${result.quality}`;
    
    if (result.poster) {
      await ctx.replyWithPhoto(result.poster, { caption: message, parse_mode: 'Markdown' });
    } else {
      await ctx.replyWithMarkdown(message);
    }
    
    // Send magnet link
    if (result.magnet) {
      await ctx.replyWithMarkdown(
        `🧲 *Download Link*\n\n` +
        `Click below to get the magnet link:\n\n` +
        `\`${result.magnet}\`\n\n` +
        `📌 *How to use:*\n` +
        `1. Copy the magnet link\n` +
        `2. Open your torrent client (uTorrent, qBittorrent, etc.)\n` +
        `3. Add the magnet link\n` +
        `4. Download the movie\n\n` +
        `⚠️ *Use a VPN for privacy*`
      );
      
      // Also provide as inline button for easy copy
      await ctx.replyWithMarkdown(
        `📋 *Copy this magnet link to download:*\n` +
        `\`${result.magnet}\``,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply('❌ No download link found for this movie.');
    }
    
  } catch (error) {
    console.error('Search error:', error.message);
    await ctx.reply(
      `❌ Error: ${error.message}\n\n` +
      `Try a different movie or search term.`
    );
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
    await bot.launch();
    console.log('✅ Bot is running!');
    console.log(`📡 Bot username: @${bot.botInfo.username}`);
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

startBot();
