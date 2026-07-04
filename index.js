require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const http = require('http');
const fs = require('fs');
const { spawn } = require('child_process');

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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_FILE_SIZE = 2000 * 1024 * 1024; // 2GB

// ==================== GEMINI API ====================
class GeminiAPI {
  constructor() {
    this.apiKey = GEMINI_API_KEY;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
  }

  async searchMovie(query) {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY not set');
    }

    try {
      const prompt = `
        Search for the movie/TV series: "${query}".
        
        IMPORTANT: You MUST return ONLY valid JSON. No other text.
        
        Return this exact JSON structure:
        {
          "title": "Full title with year",
          "year": "Release year",
          "synopsis": "2-3 sentence summary",
          "rating": "IMDB rating if available",
          "poster": "Poster image URL if available",
          "downloadUrl": "Direct download URL for the video file (MP4) - ONLY if you can find a direct link",
          "alternativeTitles": ["Alternative title 1", "Alternative title 2"]
        }
        
        If you cannot find a direct download URL, set downloadUrl to null.
        If the movie doesn't exist, return {"error": "Movie not found"}.
      `;

      const response = await axios.post(
        `${this.baseUrl}?key=${this.apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
        }
      );

      const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        if (!result.error) {
          return result;
        }
      }
    } catch (error) {
      console.error('Gemini error:', error.message);
    }
    return null;
  }

  async getDirectLink(query) {
    try {
      const prompt = `
        Find a direct download link for "${query}".
        
        Search for sites like:
        - Archive.org
        - Public domain movie sites
        - Official streaming platforms with download option
        
        Return ONLY the direct URL as plain text.
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
      console.error('Direct link error:', error.message);
    }
    return null;
  }
}

// ==================== DIRECT DOWNLOADER ====================
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
        timeout: 300000, // 5 minutes
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

  async downloadWithYtDlp(url, filename) {
    return new Promise((resolve, reject) => {
      const ytdlp = spawn('yt-dlp', [
        '-o', filename,
        '-f', 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]',
        '--no-playlist',
        '--limit-rate', '5M',
        '--no-progress',
        url
      ]);
      
      ytdlp.on('close', (code) => {
        if (code === 0) {
          resolve(filename);
        } else {
          reject(new Error(`yt-dlp failed with code ${code}`));
        }
      });
      
      ytdlp.on('error', reject);
    });
  }
}

// ==================== BOT ====================
const bot = new Telegraf(BOT_TOKEN);
const gemini = new GeminiAPI();
const downloader = new Downloader();

// ---------- START ----------
bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    `🎬 *CineverseAI - Direct Download*\n\n` +
    `Send me a movie or series name!\n\n` +
    `✅ *Features:*\n` +
    `• AI-powered search (Gemini)\n` +
    `• Direct download in Telegram\n` +
    `• Watch instantly\n` +
    `• No external apps needed\n\n` +
    `📦 *Max size:* 2GB\n` +
    `⏱️ *Download time:* 3-10 minutes\n\n` +
    `🔍 *Try:*\n` +
    `• Inception\n` +
    `• Eşref Rüya\n` +
    `• Squid Game\n` +
    `• Any movie from any country`
  );
});

// ---------- HELP ----------
bot.command('help', async (ctx) => {
  await ctx.replyWithMarkdown(
    `📖 *How to use:*\n\n` +
    `1️⃣ Send movie/series name\n` +
    `2️⃣ AI searches for download links\n` +
    `3️⃣ Bot downloads the video\n` +
    `4️⃣ You receive the file in Telegram\n\n` +
    `⚡ *Tips:*\n` +
    `• Use exact titles\n` +
    `• Add year for better results\n` +
    `• Keep chat open during download\n` +
    `• Use VPN for privacy`
  );
});

// ---------- SEARCH ----------
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  await handleSearch(ctx, ctx.message.text);
});

// ---------- SEARCH LOGIC ----------
async function handleSearch(ctx, query) {
  const statusMsg = await ctx.reply(`🔍 Searching for *${query}*...`, { parse_mode: 'Markdown' });
  
  try {
    // Step 1: Search with Gemini
    const movieInfo = await gemini.searchMovie(query);
    
    if (!movieInfo) {
      await ctx.reply(
        `❌ No results found for *${query}*.\n\n` +
        `💡 *Try:*\n` +
        `• Using the English title\n` +
        `• Adding the year (e.g., "Inception 2010")\n` +
        `• A different spelling\n` +
        `• For Turkish: "Kurtlar Vadisi"\n` +
        `• For K-Dramas: "Squid Game"`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Step 2: Show movie info
    let message = `🎬 *${movieInfo.title}*`;
    if (movieInfo.year) message += ` (${movieInfo.year})`;
    if (movieInfo.rating) message += `\n⭐ Rating: ${movieInfo.rating}`;
    if (movieInfo.synopsis) message += `\n\n📝 ${movieInfo.synopsis}`;
    
    if (movieInfo.poster) {
      try {
        await ctx.replyWithPhoto(movieInfo.poster, { 
          caption: message, 
          parse_mode: 'Markdown' 
        });
      } catch (e) {
        await ctx.replyWithMarkdown(message);
      }
    } else {
      await ctx.replyWithMarkdown(message);
    }

    // Step 3: Find download URL
    let downloadUrl = movieInfo.downloadUrl;
    
    if (!downloadUrl) {
      await ctx.reply(`🔍 Looking for download link...`);
      downloadUrl = await gemini.getDirectLink(query);
    }

    if (!downloadUrl) {
      await ctx.reply(
        `⚠️ No direct download link found for *${movieInfo.title}*.\n\n` +
        `💡 *Why this happens:*\n` +
        `• Movie may be too large (>2GB)\n` +
        `• Not available for direct download\n` +
        `• Copyright restrictions\n\n` +
        `🔍 *Try:*\n` +
        `• A different movie\n` +
        `• A smaller file (720p instead of 1080p)`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Step 4: Download the file
    await ctx.reply(
      `📥 *Downloading ${movieInfo.title}...*\n` +
      `⏳ This takes 3-10 minutes\n` +
      `💡 Keep this chat open!\n` +
      `📦 Max size: 2GB`,
      { parse_mode: 'Markdown' }
    );

    const filename = `/tmp/${movieInfo.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`;
    let downloadedFile = null;

    try {
      downloadedFile = await downloader.downloadFile(downloadUrl, filename);
    } catch (error) {
      // Try yt-dlp as fallback
      try {
        await ctx.reply(`🔄 Trying alternative download method...`);
        downloadedFile = await downloader.downloadWithYtDlp(downloadUrl, filename);
      } catch (ytError) {
        console.error('yt-dlp error:', ytError.message);
      }
    }

    // Step 5: Send the file
    if (downloadedFile && fs.existsSync(downloadedFile)) {
      const stats = fs.statSync(downloadedFile);
      const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
      
      await ctx.replyWithVideo(
        { source: downloadedFile },
        { 
          caption: `🎬 *${movieInfo.title}*\n📦 Size: ${fileSizeMB}MB\n✅ Download complete!`,
          parse_mode: 'Markdown',
          supports_streaming: true
        }
      );
      
      // Cleanup
      fs.unlinkSync(downloadedFile);
      await ctx.reply('✅ Movie sent! Enjoy watching 🎥');
      
    } else {
      await ctx.reply(
        `❌ Download failed.\n\n` +
        `💡 *Try:*\n` +
        `• A different movie\n` +
        `• A smaller version\n` +
        `• Check if the movie exists`,
        { parse_mode: 'Markdown' }
      );
    }
    
  } catch (error) {
    console.error('Search error:', error.message);
    await ctx.reply(
      `❌ Error: ${error.message}\n\n` +
      `Try a different movie or search term.`,
      { parse_mode: 'Markdown' }
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
