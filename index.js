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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MAX_FILE_SIZE = 2000 * 1024 * 1024; // 2GB

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN not set in .env file');
  process.exit(1);
}

if (!GEMINI_API_KEY) {
  console.error('❌ GEMINI_API_KEY not set in .env file');
  process.exit(1);
}

console.log('✅ Bot configuration loaded');

// ==================== GEMINI API ====================
class GeminiAPI {
  constructor() {
    this.apiKey = GEMINI_API_KEY;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
  }

  // ---------- SEARCH MOVIE ----------
  async searchMovie(query) {
    try {
      const prompt = `
        Search for the movie/TV series: "${query}".
        
        IMPORTANT: You MUST return ONLY valid JSON. No other text.
        
        Return this exact JSON structure:
        {
          "title": "Full title",
          "year": "Release year",
          "director": "Director name",
          "cast": ["Actor 1", "Actor 2"],
          "synopsis": "2-3 sentence summary",
          "rating": "IMDB rating",
          "poster": "Poster image URL",
          "genres": ["Genre 1", "Genre 2"],
          "downloadUrl": "Direct download URL (MP4) - find the best quality available",
          "quality": "720p or 1080p",
          "fileSize": "File size in GB",
          "alternativeTitles": ["Turkish title", "Korean title", "Other titles"]
        }
        
        If movie not found, return {"error": "Movie not found"}
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
      console.error('Gemini search error:', error.message);
    }
    return null;
  }

  // ---------- FIND DOWNLOAD URL ----------
  async findDownloadUrl(query) {
    try {
      const prompt = `
        Find a direct download link for the movie: "${query}".
        
        Search these sources:
        - Archive.org
        - Public domain movie sites
        - Official download pages
        - Any direct MP4 link
        
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
      console.error('Gemini download URL error:', error.message);
    }
    return null;
  }

  // ---------- FIND ALTERNATIVE TITLES ----------
  async findAlternativeTitles(query) {
    try {
      const prompt = `
        Find all alternative titles for: "${query}".
        
        Include:
        - Turkish title
        - Korean title  
        - Japanese title
        - Any other language titles
        
        Return as JSON: {"titles": ["Title 1", "Title 2", "Title 3"]}
      `;

      const response = await axios.post(
        `${this.baseUrl}?key=${this.apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }]
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        }
      );

      const text = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error('Gemini alternative titles error:', error.message);
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
const gemini = new GeminiAPI();
const downloader = new Downloader();

// ---------- START ----------
bot.start(async (ctx) => {
  await ctx.replyWithMarkdown(
    `🎬 *CineverseAI - Gemini Powered*\n\n` +
    `Send me any movie or series name!\n\n` +
    `✅ *Features:*\n` +
    `• AI search with Gemini\n` +
    `• Finds any movie (Hollywood, Turkish, K-Drama)\n` +
    `• Direct download in Telegram\n` +
    `• Watch instantly\n\n` +
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
    `2️⃣ Gemini searches for download links\n` +
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
  const statusMsg = await ctx.reply(`🔍 *Gemini is searching for:* ${query}...`, { parse_mode: 'Markdown' });
  
  try {
    // Step 1: Search with Gemini
    const movieInfo = await gemini.searchMovie(query);
    
    if (!movieInfo) {
      // Try alternative titles
      const altTitles = await gemini.findAlternativeTitles(query);
      if (altTitles?.titles) {
        for (const alt of altTitles.titles) {
          const result = await gemini.searchMovie(alt);
          if (result) {
            await ctx.reply(`💡 Found using alternative title: *${alt}*`, { parse_mode: 'Markdown' });
            movieInfo = result;
            break;
          }
        }
      }
    }
    
    if (!movieInfo) {
      await ctx.reply(
        `❌ No results found for *${query}*.\n\n` +
        `💡 *Try:*\n` +
        `• Using the English title\n` +
        `• Adding the year (e.g., "Inception 2010")\n` +
        `• For Turkish: "Kurtlar Vadisi"\n` +
        `• For K-Dramas: "Squid Game"`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Step 2: Show movie info
    let message = `🎬 *${movieInfo.title}*`;
    if (movieInfo.year) message += ` (${movieInfo.year})`;
    if (movieInfo.rating) message += `\n⭐ Rating: ${movieInfo.rating}/10`;
    if (movieInfo.director) message += `\n🎥 Director: ${movieInfo.director}`;
    if (movieInfo.genres) message += `\n🎭 ${movieInfo.genres.join(', ')}`;
    if (movieInfo.cast) message += `\n👥 ${movieInfo.cast.slice(0, 3).join(', ')}`;
    if (movieInfo.synopsis) message += `\n\n📝 ${movieInfo.synopsis}`;
    if (movieInfo.quality) message += `\n\n📦 Quality: ${movieInfo.quality}`;
    if (movieInfo.fileSize) message += `\n💾 Size: ${movieInfo.fileSize}`;
    
    // Send poster
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

    // Step 3: Get download URL
    let downloadUrl = movieInfo.downloadUrl;
    
    if (!downloadUrl) {
      await ctx.reply(`🔍 *Gemini is finding download link...*`, { parse_mode: 'Markdown' });
      downloadUrl = await gemini.findDownloadUrl(movieInfo.title);
    }

    if (!downloadUrl) {
      await ctx.reply(
        `⚠️ No download link found for *${movieInfo.title}*.\n\n` +
        `💡 *Why this happens:*\n` +
        `• Movie may be too large (>2GB)\n` +
        `• Not available for direct download\n` +
        `• Copyright restrictions\n\n` +
        `🔍 *Try:*\n` +
        `• A different movie\n` +
        `• A smaller quality (720p)`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Step 4: Download
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
      console.error('Download error:', error.message);
    }

    // Step 5: Send file
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
    const botInfo = await bot.telegram.getMe();
    console.log(`✅ Bot connected: @${botInfo.username}`);
    console.log(`✅ Gemini API loaded: ${GEMINI_API_KEY.substring(0, 10)}...`);
    
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
