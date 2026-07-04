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

// ==================== MOVIE/TV SCRAPER ====================
class MovieScraper {
  constructor() {
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    ];
  }

  getHeaders() {
    return {
      'User-Agent': this.userAgents[Math.floor(Math.random() * this.userAgents.length)],
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    };
  }

  // ---------- SOURCE 1: 1337x (Movies + TV) ----------
  async search1337x(query) {
    try {
      const domains = ['1337x.to', 'x1337x.ws', '1337x.gd', '1337x.st'];
      
      for (const domain of domains) {
        try {
          const url = `https://${domain}/search/${encodeURIComponent(query)}/1/`;
          const response = await axios.get(url, { 
            headers: this.getHeaders(), 
            timeout: 10000,
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
          });
          
          const $ = cheerio.load(response.data);
          const rows = $('tr');
          
          const results = [];
          rows.each((i, row) => {
            if (i === 0) return;
            const nameTag = $(row).find('a.name');
            const magnetLink = $(row).find('a[href^="magnet:?"]');
            const seeds = $(row).find('td').eq(4).text().trim() || '0';
            const size = $(row).find('td').eq(3).text().trim() || 'Unknown';
            const type = $(row).find('td').eq(1).text().trim() || 'Unknown';
            
            if (nameTag.length && magnetLink.length) {
              results.push({
                title: nameTag.text().trim(),
                magnet: magnetLink.attr('href'),
                seeds: parseInt(seeds) || 0,
                size: size,
                type: type
              });
            }
          });
          
          // Sort by seeds (most popular first)
          results.sort((a, b) => b.seeds - a.seeds);
          
          if (results.length > 0) {
            return {
              title: results[0].title,
              magnet: results[0].magnet,
              source: `1337x (${domain})`,
              quality: results[0].size,
              seeds: results[0].seeds,
              allResults: results.slice(0, 5)
            };
          }
        } catch (e) {
          console.log(`1337x ${domain} failed, trying next...`);
          continue;
        }
      }
    } catch (error) {
      console.error('1337x error:', error.message);
    }
    return null;
  }

  // ---------- SOURCE 2: TORRENTGALAXY (TV Series) ----------
  async searchTorrentgalaxy(query) {
    try {
      const url = `https://torrentgalaxy.to/torrents.php?search=${encodeURIComponent(query)}`;
      const response = await axios.get(url, { 
        headers: this.getHeaders(), 
        timeout: 10000 
      });
      
      const $ = cheerio.load(response.data);
      const rows = $('tr.tgxtable');
      
      const results = [];
      rows.each((i, row) => {
        const nameTag = $(row).find('a.tx');
        const magnetLink = $(row).find('a[href^="magnet:?"]');
        const seeds = $(row).find('td').eq(4).text().trim() || '0';
        
        if (nameTag.length && magnetLink.length) {
          results.push({
            title: nameTag.text().trim(),
            magnet: magnetLink.attr('href'),
            seeds: parseInt(seeds) || 0
          });
        }
      });
      
      results.sort((a, b) => b.seeds - a.seeds);
      
      if (results.length > 0) {
        return {
          title: results[0].title,
          magnet: results[0].magnet,
          source: 'TorrentGalaxy',
          quality: 'TV Series',
          seeds: results[0].seeds
        };
      }
    } catch (error) {
      console.error('Torrentgalaxy error:', error.message);
    }
    return null;
  }

  // ---------- SOURCE 3: TORRENTREACTOR (TV Series) ----------
  async searchTorrentreactor(query) {
    try {
      const url = `https://torrentreactor.to/search/${encodeURIComponent(query)}/`;
      const response = await axios.get(url, { 
        headers: this.getHeaders(), 
        timeout: 10000 
      });
      
      const $ = cheerio.load(response.data);
      const rows = $('tr.highlight');
      
      const results = [];
      rows.each((i, row) => {
        const nameTag = $(row).find('a');
        const magnetLink = $(row).find('a[href^="magnet:?"]');
        const seeds = $(row).find('td').eq(3).text().trim() || '0';
        
        if (nameTag.length && magnetLink.length) {
          results.push({
            title: nameTag.first().text().trim(),
            magnet: magnetLink.attr('href'),
            seeds: parseInt(seeds) || 0
          });
        }
      });
      
      results.sort((a, b) => b.seeds - a.seeds);
      
      if (results.length > 0) {
        return {
          title: results[0].title,
          magnet: results[0].magnet,
          source: 'TorrentReactor',
          quality: 'TV Series',
          seeds: results[0].seeds
        };
      }
    } catch (error) {
      console.error('Torrentreactor error:', error.message);
    }
    return null;
  }

  // ---------- SOURCE 4: MOVIESJOY (Turkish Series) ----------
  async searchMoviesjoy(query) {
    try {
      const url = `https://moviesjoy.to/search/${encodeURIComponent(query)}`;
      const response = await axios.get(url, { 
        headers: this.getHeaders(), 
        timeout: 10000 
      });
      
      const $ = cheerio.load(response.data);
      const result = $('.ml-item').first();
      
      if (result.length) {
        const link = result.find('a').first();
        const title = result.find('.mli-info h2').text().trim() || query;
        
        if (link.attr('href')) {
          return {
            title: title,
            magnet: null, // Moviesjoy uses direct links, not magnet
            source: 'MoviesJoy (Turkish)',
            quality: 'Stream/Download',
            url: `https://moviesjoy.to${link.attr('href')}`,
            isDirect: true
          };
        }
      }
    } catch (error) {
      console.error('Moviesjoy error:', error.message);
    }
    return null;
  }

  // ---------- SOURCE 5: DIZICLUB (Turkish Series) ----------
  async searchDiziclub(query) {
    try {
      const url = `https://diziclub.com/search/${encodeURIComponent(query)}`;
      const response = await axios.get(url, { 
        headers: this.getHeaders(), 
        timeout: 10000 
      });
      
      const $ = cheerio.load(response.data);
      const result = $('.search-item').first();
      
      if (result.length) {
        const link = result.find('a').first();
        const title = result.find('.si-title').text().trim() || query;
        
        if (link.attr('href')) {
          return {
            title: title,
            magnet: null,
            source: 'DiziClub (Turkish)',
            quality: 'Turkish Series',
            url: `https://diziclub.com${link.attr('href')}`,
            isDirect: true
          };
        }
      }
    } catch (error) {
      console.error('Diziclub error:', error.message);
    }
    return null;
  }

  // ---------- SOURCE 6: TMDb (Metadata) ----------
  async searchTmdb(query) {
    try {
      const url = `https://api.themoviedb.org/3/search/multi?api_key=019e8f1102b6bbf4a3c2be3854a6cfc1&query=${encodeURIComponent(query)}`;
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.data.results && response.data.results.length > 0) {
        const item = response.data.results[0];
        const isTV = item.media_type === 'tv';
        
        return {
          title: item.title || item.name || query,
          year: item.release_date ? item.release_date.split('-')[0] : (item.first_air_date ? item.first_air_date.split('-')[0] : ''),
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null,
          rating: item.vote_average,
          overview: item.overview,
          type: isTV ? 'TV Series' : 'Movie',
          mediaType: item.media_type
        };
      }
    } catch (error) {
      console.error('TMDb error:', error.message);
    }
    return null;
  }

  // ---------- MAIN SEARCH ----------
  async searchMovie(query) {
    // Get metadata
    const metadata = await this.searchTmdb(query);
    
    // Try all sources in parallel
    const sources = [
      this.search1337x(query),
      this.searchTorrentgalaxy(query),
      this.searchTorrentreactor(query),
      this.searchMoviesjoy(query),
      this.searchDiziclub(query)
    ];
    
    const results = await Promise.allSettled(sources);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const movie = result.value;
        if (metadata) {
          movie.title = metadata.title || movie.title;
          movie.year = metadata.year || movie.year;
          movie.poster = metadata.poster || movie.poster;
          movie.rating = metadata.rating;
          movie.overview = metadata.overview;
          movie.mediaType = metadata.mediaType;
          movie.type = metadata.type;
        }
        return movie;
      }
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
    `🎬 *CineverseAI Bot v3*\n\n` +
    `Send me a movie or TV series name!\n\n` +
    `📺 *Supported:*\n` +
    `• Hollywood Movies\n` +
    `• Turkish Series (Eşref Rüya, Kurtlar Vadisi)\n` +
    `• K-Dramas (Squid Game, Crash Landing)\n` +
    `• Anime (Naruto, Demon Slayer)\n\n` +
    `📡 Searching: 1337x, TorrentGalaxy, MoviesJoy, DiziClub\n` +
    `⚡ Finds both Movies AND TV Series`
  );
});

// ---------- HELP ----------
bot.command('help', async (ctx) => {
  await ctx.replyWithMarkdown(
    `📖 *How to use:*\n\n` +
    `1. Send any movie or series name\n` +
    `2. I'll search multiple sources\n` +
    `3. Get a magnet link\n` +
    `4. Open in your torrent client\n\n` +
    `🔍 *Turkish Series Search:*\n` +
    `• Eşref Rüya\n` +
    `• Kurtlar Vadisi\n` +
    `• Diriliş Ertuğrul\n` +
    `• Muhteşem Yüzyıl\n\n` +
    `🔍 *K-Dramas:*\n` +
    `• Squid Game\n` +
    `• Crash Landing on You\n` +
    `• Descendants of the Sun\n\n` +
    `⚠️ *Use a VPN for privacy*`
  );
});

// ---------- AUTO-SEARCH ----------
bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  await handleSearch(ctx, ctx.message.text);
});

// ---------- SEARCH LOGIC ----------
async function handleSearch(ctx, query) {
  const statusMsg = await ctx.reply(`🔍 Searching for *${query}*...\n⏳ Trying multiple sources...`, { parse_mode: 'Markdown' });
  
  try {
    const result = await scraper.searchMovie(query);
    
    if (!result) {
      await ctx.reply(
        `❌ No results found for *${query}*.\n\n` +
        `🔍 *Tips for better results:*\n\n` +
        `📺 *Turkish Series:*\n` +
        `• Eşref Rüya\n` +
        `• Kurtlar Vadisi\n` +
        `• Diriliş Ertuğrul\n` +
        `• Muhteşem Yüzyıl\n\n` +
        `🇰🇷 *K-Dramas:*\n` +
        `• Squid Game\n` +
        `• Crash Landing on You\n` +
        `• Descendants of the Sun\n\n` +
        `🎬 *Hollywood:*\n` +
        `• Use English titles\n` +
        `• Add year (e.g., "Inception 2010")\n\n` +
        `ℹ️ Some sources may be blocked. Try again with a VPN.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Build response
    let message = `🎬 *${result.title}*`;
    if (result.year) message += ` (${result.year})`;
    if (result.type) message += `\n📺 Type: ${result.type}`;
    if (result.rating) message += `\n⭐ Rating: ${result.rating}/10`;
    if (result.overview) message += `\n\n📝 ${result.overview.substring(0, 300)}...`;
    message += `\n\n📡 Source: ${result.source}`;
    message += `\n📦 Quality: ${result.quality}`;
    if (result.seeds) message += `\n🌱 Seeds: ${result.seeds}`;
    
    // Send poster if available
    if (result.poster) {
      try {
        await ctx.replyWithPhoto(result.poster, { 
          caption: message, 
          parse_mode: 'Markdown' 
        });
      } catch (e) {
        await ctx.replyWithMarkdown(message);
      }
    } else {
      await ctx.replyWithMarkdown(message);
    }
    
    // Send magnet link or direct URL
    if (result.magnet) {
      await ctx.replyWithMarkdown(
        `🧲 *Magnet Link*\n\n` +
        `\`${result.magnet}\`\n\n` +
        `📌 *How to download:*\n` +
        `1. Copy the magnet link\n` +
        `2. Open your torrent client (qBittorrent, uTorrent, etc.)\n` +
        `3. Add the magnet link\n` +
        `4. Wait for the download\n\n` +
        `⚠️ *Use a VPN for privacy and faster speeds*`
      );
    } else if (result.url) {
      await ctx.replyWithMarkdown(
        `🔗 *Direct Link*\n\n` +
        `You can watch/download here:\n` +
        `[Click to Watch](${result.url})\n\n` +
        `⚠️ *This is a streaming site, may have pop-ups*`
      );
    } else {
      await ctx.reply('❌ No download link found.');
    }
    
  } catch (error) {
    console.error('Search error:', error.message);
    await ctx.reply(
      `❌ Error: ${error.message}\n\n` +
      `Try a different movie or series name.`
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
