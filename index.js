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
const REAL_DEBRID_API_KEY = process.env.REAL_DEBRID_API_KEY;

if (!REAL_DEBRID_API_KEY) {
  console.error('❌ REAL_DEBRID_API_KEY not set!');
  process.exit(1);
}

// ==================== TMDB ====================
class TMDB {
  constructor() {
    this.apiKey = TMDB_API_KEY;
    this.baseUrl = 'https://api.themoviedb.org/3';
    this.imageBase = 'https://image.tmdb.org/t/p/w500';
  }

  async search(query) {
    try {
      const url = `${this.baseUrl}/search/multi?api_key=${this.apiKey}&query=${encodeURIComponent(query)}`;
      const response = await axios.get(url, { timeout: 10000 });
      return response.data.results || [];
    } catch (e) {
      console.error('TMDB error:', e.message);
      return [];
    }
  }

  async details(id, type) {
    try {
      const url = `${this.baseUrl}/${type}/${id}?api_key=${this.apiKey}`;
      const response = await axios.get(url, { timeout: 10000 });
      return response.data;
    } catch (e) {
      console.error('TMDB error:', e.message);
      return null;
    }
  }
}

// ==================== REAL-DEBRID ====================
class RealDebrid {
  constructor() {
    this.apiKey = REAL_DEBRID_API_KEY;
    this.baseUrl = 'https://api.real-debrid.com/rest/1.0';
  }

  // Search torrents for a movie
  async searchTorrent(query) {
    try {
      const url = `${this.baseUrl}/torrents/search?query=${encodeURIComponent(query)}`;
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeout: 15000
      });
      return response.data;
    } catch (e) {
      console.error('Real-Debrid search error:', e.message);
      return [];
    }
  }

  // Add a magnet link to Real-Debrid
  async addMagnet(magnet) {
    try {
      const url = `${this.baseUrl}/torrents/addMagnet`;
      const params = new URLSearchParams();
      params.append('magnet', magnet);
      
      const response = await axios.post(url, params, {
        headers: { 
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000
      });
      return response.data.id;
    } catch (e) {
      console.error('Add magnet error:', e.message);
      return null;
    }
  }

  // Get torrent info
  async getTorrentInfo(id) {
    try {
      const url = `${this.baseUrl}/torrents/info/${id}`;
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        timeout: 10000
      });
      return response.data;
    } catch (e) {
      console.error('Get torrent info error:', e.message);
      return null;
    }
  }

  // Select files to download
  async selectFiles(id, fileIds) {
    try {
      const url = `${this.baseUrl}/torrents/selectFiles/${id}`;
      const params = new URLSearchParams();
      params.append('files', fileIds);
      
      const response = await axios.post(url, params, {
        headers: { 
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      });
      return response.data;
    } catch (e) {
      console.error('Select files error:', e.message);
      return null;
    }
  }

  // Get unrestricted link
  async unrestrictLink(link) {
    try {
      const url = `${this.baseUrl}/unrestrict/link`;
      const params = new URLSearchParams();
      params.append('link', link);
      
      const response = await axios.post(url, params, {
        headers: { 
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 10000
      });
      return response.data.download;
    } catch (e) {
      console.error('Unrestrict link error:', e.message);
      return null;
    }
  }
}

// ==================== TORRENT SCRAPER ====================
class TorrentScraper {
  async search1337x(query) {
    try {
      const url = `https://1337x.to/search/${encodeURIComponent(query)}/1/`;
      const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 15000
      });
      
      const $ = require('cheerio').load(response.data);
      const rows = $('tr');
      const results = [];
      
      rows.each((i, row) => {
        if (i === 0) return;
        const nameTag = $(row).find('a.name');
        const magnetLink = $(row).find('a[href^="magnet:?"]');
        const seeds = $(row).find('td').eq(4).text().trim() || '0';
        const size = $(row).find('td').eq(3).text().trim() || 'Unknown';
        
        if (nameTag.length && magnetLink.length) {
          results.push({
            title: nameTag.text().trim(),
            magnet: magnetLink.attr('href'),
            seeds: parseInt(seeds) || 0,
            size: size
          });
        }
      });
      
      results.sort((a, b) => b.seeds - a.seeds);
      return results.slice(0, 3);
    } catch (e) {
      console.error('1337x error:', e.message);
      return [];
    }
  }
}

// ==================== BOT ====================
const bot = new Telegraf(BOT_TOKEN);
const tmdb = new TMDB();
const rd = new RealDebrid();
const scraper = new TorrentScraper();

// ---------- START ----------
bot.start(async (ctx) => {
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎬 Search Movie', 'search')],
    [Markup.button.callback('🔥 Popular', 'popular')],
    [Markup.button.callback('❓ Help', 'help')]
  ]);

  await ctx.replyWithMarkdown(
    `🎬 *CineverseAI - Real Download Bot*\n\n` +
    `Click "Search Movie" to find and download any movie!\n\n` +
    `✅ *Real-Debrid powered*\n` +
    `✅ Direct download links\n` +
    `✅ Watch instantly in Telegram`,
    keyboard
  );
});

// ---------- SEARCH BUTTON ----------
bot.action('search', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(
    `🔍 *Send me a movie name*\n\n` +
    `Example: \`Inception\` or \`Vikings Valhalla\``
  );
  ctx.session = { waitingForSearch: true };
});

// ---------- POPULAR ----------
bot.action('popular', async (ctx) => {
  await ctx.answerCbQuery('Loading popular movies...');
  try {
    const url = `https://api.themoviedb.org/3/movie/popular?api_key=${TMDB_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });
    const movies = response.data.results.slice(0, 5);
    
    const buttons = movies.map(m => {
      const title = `${m.title} (${m.release_date?.split('-')[0] || 'N/A'})`;
      return [Markup.button.callback(title, `movie_${m.id}_movie`)];
    });
    buttons.push([Markup.button.callback('🔙 Back', 'back')]);
    
    await ctx.replyWithMarkdown('🔥 *Popular Movies*\n\nClick a movie:', Markup.inlineKeyboard(buttons));
  } catch (e) {
    await ctx.reply('❌ Error loading popular movies.');
  }
});

// ---------- HELP ----------
bot.action('help', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.replyWithMarkdown(
    `📖 *How to use:*\n\n` +
    `1️⃣ Click "Search Movie"\n` +
    `2️⃣ Type the movie name\n` +
    `3️⃣ Select from results\n` +
    `4️⃣ Click "Download"\n` +
    `5️⃣ Bot finds real links via Real-Debrid\n` +
    `6️⃣ You receive the file!\n\n` +
    `📦 Max size: 2GB\n` +
    `⏱️ First download may take 2-5 minutes`,
    Markup.inlineKeyboard([[Markup.button.callback('🔙 Back', 'back')]])
  );
});

// ---------- BACK ----------
bot.action('back', async (ctx) => {
  await ctx.answerCbQuery();
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🎬 Search Movie', 'search')],
    [Markup.button.callback('🔥 Popular', 'popular')],
    [Markup.button.callback('❓ Help', 'help')]
  ]);
  await ctx.replyWithMarkdown(`🎬 *Main Menu*`, keyboard);
});

// ---------- HANDLE TEXT SEARCH ----------
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  if (!ctx.session?.waitingForSearch) {
    await ctx.reply('🔍 Click "Search Movie" first!');
    return;
  }
  
  const query = ctx.message.text.trim();
  ctx.session.waitingForSearch = false;
  await handleSearch(ctx, query);
});

// ---------- SEARCH LOGIC ----------
async function handleSearch(ctx, query) {
  const status = await ctx.reply(`🔍 Searching for *${query}*...`, { parse_mode: 'Markdown' });
  
  try {
    // 1. Search TMDB
    const results = await tmdb.search(query);
    if (!results || results.length === 0) {
      await ctx.reply(`❌ No results found for "${query}"`);
      return;
    }
    
    // 2. Show results as buttons
    const buttons = results.slice(0, 5).map(item => {
      const title = item.title || item.name || 'Unknown';
      const year = item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : '');
      const label = `${title}${year ? ` (${year})` : ''}`;
      const type = item.media_type === 'tv' ? 'tv' : 'movie';
      return [Markup.button.callback(label, `movie_${item.id}_${type}`)];
    });
    buttons.push([Markup.button.callback('🔙 Back', 'back')]);
    
    await ctx.replyWithMarkdown(
      `📋 *Results for:* ${query}\n\nClick a movie:`,
      Markup.inlineKeyboard(buttons)
    );
    
  } catch (e) {
    console.error('Search error:', e.message);
    await ctx.reply(`❌ Error: ${e.message}`);
  }
}

// ---------- MOVIE DETAILS + DOWNLOAD ----------
bot.action(/movie_(\d+)_(movie|tv)/, async (ctx) => {
  await ctx.answerCbQuery('Loading...');
  
  const id = parseInt(ctx.match[1]);
  const type = ctx.match[2];
  
  try {
    const data = await tmdb.details(id, type);
    if (!data) {
      await ctx.reply('❌ Could not load details');
      return;
    }
    
    const title = data.title || data.name;
    const year = data.release_date ? data.release_date.split('-')[0] : (data.first_air_date ? data.first_air_date.split('-')[0] : '');
    const poster = data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null;
    
    let message = `🎬 *${title}*`;
    if (year) message += ` (${year})`;
    if (data.vote_average) message += `\n⭐ ${data.vote_average.toFixed(1)}/10`;
    if (data.overview) message += `\n\n📝 ${data.overview.substring(0, 300)}...`;
    
    const buttons = [
      [Markup.button.callback('📥 Download', `download_${id}_${type}_${encodeURIComponent(title)}`)],
      [Markup.button.callback('🔙 Back', 'back')]
    ];
    
    if (poster) {
      await ctx.replyWithPhoto(poster, {
        caption: message,
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard(buttons)
      });
    } else {
      await ctx.replyWithMarkdown(message, Markup.inlineKeyboard(buttons));
    }
    
  } catch (e) {
    console.error('Details error:', e.message);
    await ctx.reply('❌ Error loading details.');
  }
});

// ---------- DOWNLOAD ----------
bot.action(/download_(\d+)_(movie|tv)_(.+)/, async (ctx) => {
  await ctx.answerCbQuery('Searching for download links...');
  
  const id = parseInt(ctx.match[1]);
  const type = ctx.match[2];
  const title = decodeURIComponent(ctx.match[3]);
  
  await ctx.reply(`🔍 *Searching for:* ${title}...\n⏳ This may take 1-2 minutes`, { parse_mode: 'Markdown' });
  
  try {
    // 1. Search torrents on 1337x
    const torrents = await scraper.search1337x(title);
    
    if (!torrents || torrents.length === 0) {
      await ctx.reply(`❌ No torrents found for "${title}"`);
      return;
    }
    
    // 2. Try each torrent
    let downloadUrl = null;
    let selectedTorrent = null;
    
    for (const torrent of torrents) {
      await ctx.reply(`🔄 Trying: ${torrent.title.substring(0, 50)}... (${torrent.seeds} seeds)`);
      
      try {
        // Add magnet to Real-Debrid
        const torrentId = await rd.addMagnet(torrent.magnet);
        if (!torrentId) continue;
        
        // Wait for torrent to be ready
        let ready = false;
        let attempts = 0;
        while (!ready && attempts < 15) {
          await new Promise(r => setTimeout(r, 3000));
          const info = await rd.getTorrentInfo(torrentId);
          if (info && info.status === 'downloaded' && info.links && info.links.length > 0) {
            ready = true;
            // Unrestrict the link
            downloadUrl = await rd.unrestrictLink(info.links[0]);
            if (downloadUrl) {
              selectedTorrent = torrent;
              break;
            }
          }
          attempts++;
        }
        
        if (downloadUrl) break;
        
      } catch (e) {
        console.error('Torrent error:', e.message);
        continue;
      }
    }
    
    if (!downloadUrl) {
      await ctx.reply(
        `❌ Could not get download link for "${title}".\n\n` +
        `💡 Try:\n` +
        `• Different movie\n` +
        `• Wait 5 minutes and retry\n` +
        `• Check if Real-Debrid account is active`
      );
      return;
    }
    
    // 3. Download and send file
    await ctx.reply(
      `📥 *Downloading:* ${selectedTorrent.title}\n` +
      `📦 Size: ${selectedTorrent.size}\n` +
      `⏳ This takes 3-10 minutes\n` +
      `💡 Keep this chat open!`,
      { parse_mode: 'Markdown' }
    );
    
    const filename = `/tmp/${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`;
    
    // Download file
    const response = await axios({
      method: 'get',
      url: downloadUrl,
      responseType: 'stream',
      timeout: 600000,
      maxContentLength: MAX_FILE_SIZE,
      maxBodyLength: MAX_FILE_SIZE
    });
    
    const writer = fs.createWriteStream(filename);
    response.data.pipe(writer);
    
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
    
    // Send file
    const stats = fs.statSync(filename);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(1);
    
    await ctx.replyWithVideo(
      { source: filename },
      {
        caption: `🎬 *${title}*\n📦 Size: ${fileSizeMB}MB\n✅ Download complete!`,
        parse_mode: 'Markdown',
        supports_streaming: true
      }
    );
    
    fs.unlinkSync(filename);
    await ctx.reply('✅ Movie sent! Enjoy watching 🎥');
    
  } catch (e) {
    console.error('Download error:', e.message);
    await ctx.reply(`❌ Download failed: ${e.message}`);
  }
});

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
    await bot.launch();
    console.log('✅ Bot is running!');
  } catch (e) {
    console.error('❌ Failed to start bot:', e.message);
    process.exit(1);
  }
}

startBot();
