require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { message } = require('telegraf/filters');
const axios = require('axios');
const http = require('http');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream');
const { promisify } = require('util');
const streamPipeline = promisify(pipeline);

// ==================== DUMMY HTTP SERVER FOR RENDER ====================
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
const MAX_FILE_SIZE = 2000 * 1024 * 1024; // 2GB (Telegram limit)

// ==================== SCRAPER ====================
class MovieScraper {
  constructor() {
    this.client = axios.create({
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 30000
    });
  }

  // Search for movie on multiple sites
  async searchMovie(query) {
    // Try various sources for direct download links
    const sources = [
      this.searchMovieWeb(query),
      this.searchDlMovie(query),
      this.searchMkvCinema(query)
    ];
    
    for (const source of sources) {
      const result = await source;
      if (result) return result;
    }
    return null;
  }

  // Source 1: movie-web.app
  async searchMovieWeb(query) {
    try {
      const searchUrl = `https://movie-web.app/search?q=${encodeURIComponent(query)}`;
      const response = await this.client.get(searchUrl, { responseType: 'text' });
      const $ = cheerio.load(response.data);
      
      // Find the first movie result and get its embed URL
      const movieLink = $('.movie-card a').first();
      if (movieLink.length) {
        const movieId = movieLink.attr('href');
        if (movieId) {
          return {
            title: movieLink.find('.title').text().trim() || query,
            embedUrl: `https://movie-web.app${movieId}`,
            source: 'movie-web'
          };
        }
      }
    } catch (error) {
      console.error('Movie-web error:', error.message);
    }
    return null;
  }

  // Source 2: dlmovie.com
  async searchDlMovie(query) {
    try {
      const searchUrl = `https://dlmovie.com/search/${encodeURIComponent(query)}`;
      const response = await this.client.get(searchUrl, { responseType: 'text' });
      const $ = cheerio.load(response.data);
      
      const result = $('.movie-item').first();
      if (result.length) {
        const link = result.find('a').first();
        if (link.length) {
          const href = link.attr('href');
          return {
            title: result.find('.title').text().trim() || query,
            embedUrl: href.startsWith('http') ? href : `https://dlmovie.com${href}`,
            source: 'dlmovie'
          };
        }
      }
    } catch (error) {
      console.error('Dlmovie error:', error.message);
    }
    return null;
  }

  // Source 3: mkvcinema.com
  async searchMkvCinema(query) {
    try {
      const searchUrl = `https://mkvcinema.com/?s=${encodeURIComponent(query)}`;
      const response = await this.client.get(searchUrl, { responseType: 'text' });
      const $ = cheerio.load(response.data);
      
      const result = $('.post').first();
      if (result.length) {
        const link = result.find('a').first();
        if (link.length) {
          const href = link.attr('href');
          return {
            title: result.find('h2').text().trim() || query,
            embedUrl: href,
            source: 'mkvcinema'
          };
        }
      }
    } catch (error) {
      console.error('Mkvcinema error:', error.message);
    }
    return null;
  }

  // Get actual video download URL from embed page
  async getVideoUrl(embedUrl) {
    try {
      const response = await this.client.get(embedUrl, { responseType: 'text' });
      const $ = cheerio.load(response.data);
      
      // Try to find video source
      // Method 1: Check for video tag
      const videoSrc = $('video source').attr('src');
      if (videoSrc) return videoSrc;
      
      // Method 2: Check for iframe
      const iframeSrc = $('iframe').first().attr('src');
      if (iframeSrc) {
        // Recurse into iframe
        return await this.getVideoUrl(iframeSrc);
      }
      
      // Method 3: Check for direct links in script or a tags
      const downloadLink = $('a[download], a[href*=".mp4"], a[href*=".mkv"]').first().attr('href');
      if (downloadLink) return downloadLink;
      
      // Method 4: Check data attributes
      const dataSrc = $('[data-src*=".mp4"], [data-video]').attr('data-src');
      if (dataSrc) return dataSrc;
      
      return null;
    } catch (error) {
      console.error('Get video URL error:', error.message);
      return null;
    }
  }

  // Download video file
  async downloadVideo(videoUrl) {
    try {
      // Validate URL
      if (!videoUrl) throw new Error('No video URL found');
      
      // Create a new axios instance for downloading
      const downloadClient = axios.create({
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.google.com/'
        },
        responseType: 'stream',
        timeout: 120000, // 2 minutes
        maxContentLength: MAX_FILE_SIZE,
        maxBodyLength: MAX_FILE_SIZE
      });
      
      const response = await downloadClient.get(videoUrl);
      
      // Check file size
      const contentLength = response.headers['content-length'];
      if (contentLength && parseInt(contentLength) > MAX_FILE_SIZE) {
        throw new Error(`File too large (${(parseInt(contentLength) / 1024 / 1024).toFixed(0)}MB > 2GB)`);
      }
      
      // Collect chunks
      const chunks = [];
      let size = 0;
      
      for await (const chunk of response.data) {
        chunks.push(chunk);
        size += chunk.length;
        if (size > MAX_FILE_SIZE) {
          throw new Error('File exceeds 2GB limit');
        }
      }
      
      return Buffer.concat(chunks);
    } catch (error) {
      console.error('Download error:', error.message);
      throw error;
    }
  }
}

// ==================== BOT ====================
const bot = new Telegraf(BOT_TOKEN);
const scraper = new MovieScraper();

// ---------- START ----------
bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    `🎬 *CineverseAI Bot - Direct Download*\n\n` +
    `Send me a movie name and I'll send it to you!\n\n` +
    `Examples:\n` +
    `\`Inception\`\n` +
    `\`The Dark Knight\`\n` +
    `\`Avengers 2012\`\n\n` +
    `⚡ Files up to 2GB\n` +
    `⏱️ Large files may take 3-5 minutes\n` +
    `📱 Works on any device`
  );
});

// ---------- HELP ----------
bot.command('help', async (ctx) => {
  await ctx.replyWithMarkdown(
    `📖 *How to use:*\n\n` +
    `1. Send any movie name\n` +
    `2. I'll search for direct download links\n` +
    `3. I download the movie\n` +
    `4. You receive the video file directly\n\n` +
    `⚠️ *Keep the chat open during download*\n` +
    `⚠️ *Large files take 3-5 minutes*\n` +
    `⚠️ *Make sure you have enough storage*`
  );
});

// ---------- AUTO-SEARCH ANY TEXT ----------
bot.on(message('text'), async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  await handleSearch(ctx, ctx.message.text);
});

// ---------- CORE SEARCH LOGIC ----------
async function handleSearch(ctx, query) {
  const statusMsg = await ctx.reply(`🔍 Searching for *${query}*...`, { parse_mode: 'Markdown' });
  
  try {
    // Step 1: Search for movie
    const movieInfo = await scraper.searchMovie(query);
    
    if (!movieInfo) {
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
    
    // Step 2: Get video URL
    await ctx.reply(`📡 Found: *${movieInfo.title}*\n🔗 Getting download link...`, { parse_mode: 'Markdown' });
    
    const videoUrl = await scraper.getVideoUrl(movieInfo.embedUrl);
    if (!videoUrl) {
      await ctx.reply(
        `❌ Could not find a direct download link for *${movieInfo.title}*.\n\n` +
        `The movie may be on a platform that doesn't allow direct downloads.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Step 3: Download video
    await ctx.reply(
      `📥 Downloading *${movieInfo.title}*\n` +
      `⏳ This may take 3-5 minutes...\n` +
      `📦 Max size: 2GB`,
      { parse_mode: 'Markdown' }
    );
    
    const videoBuffer = await scraper.downloadVideo(videoUrl);
    
    // Step 4: Send video
    const fileName = `${movieInfo.title}.mp4`;
    await ctx.replyWithVideo(
      { source: videoBuffer, filename: fileName },
      { 
        caption: `🎬 *${movieInfo.title}*\n✅ Download complete!`,
        parse_mode: 'Markdown',
        supports_streaming: true
      }
    );
    
    await ctx.reply('✅ Movie sent successfully! Enjoy watching 🎥');
    
  } catch (error) {
    console.error('Search/Download error:', error.message);
    await ctx.reply(
      `❌ Error: ${error.message}\n\n` +
      `Try:\n` +
      `• A different movie\n` +
      `• A smaller file size\n` +
      `• Using the English title`
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

// Graceful shutdown
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  process.exit(0);
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
