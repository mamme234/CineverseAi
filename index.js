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
    this.client = axios.create({
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 30000
    });
  }

  // Search multiple sites for movies
  async searchMovie(query) {
    const sources = [
      this.searchDlMovie(query),
      this.searchMkvCinema(query),
      this.searchMovieWeb(query)
    ];
    
    for (const source of sources) {
      const result = await source;
      if (result) return result;
    }
    return null;
  }

  // Source 1: dlmovie.com
  async searchDlMovie(query) {
    try {
      const searchUrl = `https://dlmovie.com/search/${encodeURIComponent(query)}`;
      const response = await this.client.get(searchUrl);
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

  // Source 2: mkvcinema.com
  async searchMkvCinema(query) {
    try {
      const searchUrl = `https://mkvcinema.com/?s=${encodeURIComponent(query)}`;
      const response = await this.client.get(searchUrl);
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

  // Source 3: movie-web.app
  async searchMovieWeb(query) {
    try {
      const searchUrl = `https://movie-web.app/search?q=${encodeURIComponent(query)}`;
      const response = await this.client.get(searchUrl);
      const $ = cheerio.load(response.data);
      
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

  // Get actual video URL from embed page
  async getVideoUrl(embedUrl) {
    try {
      const response = await this.client.get(embedUrl);
      const $ = cheerio.load(response.data);
      
      // Try various patterns
      const patterns = [
        'video source',
        '[data-src*=".mp4"]',
        '[data-video]',
        'a[download]',
        'a[href*=".mp4"]',
        'a[href*=".mkv"]',
        'iframe'
      ];
      
      for (const pattern of patterns) {
        const element = $(pattern).first();
        if (element.length) {
          let src = element.attr('src') || element.attr('href') || element.attr('data-src');
          if (src) {
            if (src.startsWith('//')) src = 'https:' + src;
            if (!src.startsWith('http') && src.startsWith('/')) {
              const baseUrl = embedUrl.split('/').slice(0, 3).join('/');
              src = baseUrl + src;
            }
            if (src.startsWith('http')) {
              return src;
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      console.error('Get video URL error:', error.message);
      return null;
    }
  }

  // Download video file
  async downloadVideo(videoUrl) {
    try {
      const downloadClient = axios.create({
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://www.google.com/'
        },
        responseType: 'stream',
        timeout: 120000,
        maxContentLength: MAX_FILE_SIZE
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

// Start command
bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    `🎬 *CineverseAI Bot*\n\n` +
    `Send me a movie name and I'll download it for you!\n\n` +
    `Examples:\n` +
    `\`Inception\`\n` +
    `\`The Dark Knight\`\n` +
    `\`Turkish series\`\n` +
    `\`Kdrama\`\n\n` +
    `⏱️ Large files take 2-5 minutes\n` +
    `📱 Works on any device`
  );
});

// Help command
bot.command('help', async (ctx) => {
  await ctx.replyWithMarkdown(
    `📖 *How to use:*\n\n` +
    `1. Send any movie name\n` +
    `2. I'll search for download links\n` +
    `3. I download and send the file\n` +
    `4. Tap to watch\n\n` +
    `⚠️ Keep the chat open during download`
  );
});

// Auto-search any text message
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  await handleSearch(ctx, ctx.message.text);
});

// Core search logic
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
        `Try a different movie or site.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Step 3: Download
    await ctx.reply(
      `📥 Downloading *${movieInfo.title}*\n` +
      `⏳ Please wait 2-5 minutes...`,
      { parse_mode: 'Markdown' }
    );
    
    const videoBuffer = await scraper.downloadVideo(videoUrl);
    
    // Step 4: Send
    const fileName = `${movieInfo.title}.mp4`;
    await ctx.replyWithVideo(
      { source: videoBuffer, filename: fileName },
      { 
        caption: `🎬 *${movieInfo.title}*\n✅ Download complete!`,
        parse_mode: 'Markdown'
      }
    );
    
    await ctx.reply('✅ Movie sent! Enjoy watching 🎥');
    
  } catch (error) {
    console.error('Search/Download error:', error.message);
    await ctx.reply(
      `❌ Error: ${error.message}\n\n` +
      `Try:\n` +
      `• A different movie\n` +
      `• A smaller file\n` +
      `• Using the English title`
    );
  }
}

// Error handling
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('⚠️ An error occurred. Please try again.');
});

// Start bot
async function startBot() {
  try {
    await bot.launch();
    console.log('✅ Bot is running!');
  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    process.exit(1);
  }
}

startBot();
