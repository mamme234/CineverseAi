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

  // ---------- SOURCE 1: YTS Proxy ----------
  async searchYts(query) {
    try {
      // Use yts.mx with proxy or alternative domain
      const domains = ['yts.mx', 'yts.uno', 'yts.ag', 'yts.pm'];
      
      for (const domain of domains) {
        try {
          const url = `https://${domain}/browse-movies/${encodeURIComponent(query)}/all/all/0/latest`;
          const response = await axios.get(url, { 
            headers: this.getHeaders(), 
            timeout: 10000,
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
          });
          
          const $ = cheerio.load(response.data);
          const movieTile = $('.movie-tile').first();
          
          if (movieTile.length) {
            const link = movieTile.find('a').first();
            if (link.attr('href')) {
              const title = link.text().trim() || query;
              const year = $('.year', movieTile).text().trim() || '';
              
              // Get detail page
              const detailUrl = `https://${domain}${link.attr('href')}`;
              const detailResponse = await axios.get(detailUrl, { 
                headers: this.getHeaders(), 
                timeout: 10000,
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
              });
              const $$ = cheerio.load(detailResponse.data);
              
              const magnet = $$('a[href^="magnet:?"]').first().attr('href');
              if (magnet) {
                return {
                  title: `${title} ${year}`.trim(),
                  magnet: magnet,
                  source: `YTS (${domain})`,
                  quality: '720p/1080p'
                };
              }
            }
          }
        } catch (e) {
          console.log(`YTS ${domain} failed, trying next...`);
          continue;
        }
      }
    } catch (error) {
      console.error('YTS error:', error.message);
    }
    return null;
  }

  // ---------- SOURCE 2: The Movie Database (Free API) ----------
  async searchTmdb(query) {
    try {
      // Use the free TMDb API without key (limited)
      const url = `https://api.themoviedb.org/3/search/movie?api_key=019e8f1102b6bbf4a3c2be3854a6cfc1&query=${encodeURIComponent(query)}`;
      const response = await axios.get(url, { timeout: 10000 });
      
      if (response.data.results && response.data.results.length > 0) {
        const movie = response.data.results[0];
        return {
          title: movie.title,
          year: movie.release_date ? movie.release_date.split('-')[0] : '',
          poster: `https://image.tmdb.org/t/p/w200${movie.poster_path}`,
          rating: movie.vote_average,
          overview: movie.overview,
          tmdb_id: movie.id
        };
      }
    } catch (error) {
      console.error('TMDb error:', error.message);
    }
    return null;
  }

  // ---------- SOURCE 3: 1337x Proxy ----------
  async search1337x(query) {
    try {
      const domains = ['1337x.to', 'x1337x.ws', '1337x.gd'];
      
      for (const domain of domains) {
        try {
          const url = `https://${domain}/search/${encodeURIComponent(query)}/1/`;
          const response = await axios.get(url, { 
            headers: this.getHeaders(), 
            timeout: 10000,
            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
          });
          
          const $ = cheerio.load(response.data);
          const row = $('tr').first();
          
          if (row.length) {
            const nameTag = row.find('a.name').first();
            const magnetLink = row.find('a[href^="magnet:?"]').first();
            
            if (nameTag.length && magnetLink.length) {
              return {
                title: nameTag.text().trim(),
                magnet: magnetLink.attr('href'),
                source: `1337x (${domain})`,
                quality: '1080p'
              };
            }
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

  // ---------- SOURCE 4: RARBG Proxy ----------
  async searchRarbg(query) {
    try {
      const url = `https://rarbg.to/torrents.php?search=${encodeURIComponent(query)}`;
      const response = await axios.get(url, { 
        headers: this.getHeaders(), 
        timeout: 10000 
      });
      
      const $ = cheerio.load(response.data);
      const row = $('tr.lista2').first();
      
      if (row.length) {
        const nameTag = row.find('a').first();
        const magnetLink = row.find('a[href^="magnet:?"]').first();
        
        if (nameTag.length && magnetLink.length) {
          return {
            title: nameTag.text().trim(),
            magnet: magnetLink.attr('href'),
            source: 'RARBG',
            quality: '1080p'
          };
        }
      }
    } catch (error) {
      console.error('RARBG error:', error.message);
    }
    return null;
  }

  // ---------- SOURCE 5: TORRENTGALAXY ----------
  async searchTorrentgalaxy(query) {
    try {
      const url = `https://torrentgalaxy.to/torrents.php?search=${encodeURIComponent(query)}`;
      const response = await axios.get(url, { 
        headers: this.getHeaders(), 
        timeout: 10000 
      });
      
      const $ = cheerio.load(response.data);
      const row = $('tr.tgxtable').first();
      
      if (row.length) {
        const nameTag = row.find('a.tx');
        const magnetLink = row.find('a[href^="magnet:?"]');
        
        if (nameTag.length && magnetLink.length) {
          return {
            title: nameTag.text().trim(),
            magnet: magnetLink.attr('href'),
            source: 'TorrentGalaxy',
            quality: '1080p'
          };
        }
      }
    } catch (error) {
      console.error('Torrentgalaxy error:', error.message);
    }
    return null;
  }

  // ---------- MAIN SEARCH ----------
  async searchMovie(query) {
    // Try TMDb for metadata
    const metadata = await this.searchTmdb(query);
    
    // Try all sources in parallel
    const sources = [
      this.searchYts(query),
      this.search1337x(query),
      this.searchRarbg(query),
      this.searchTorrentgalaxy(query)
    ];
    
    const results = await Promise.allSettled(sources);
    
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const movie = result.value;
        if (metadata) {
          movie.title = metadata.title || movie.title;
          movie.year = metadata.year || movie.year;
          movie.poster = metadata.poster;
          movie.rating = metadata.rating;
          movie.overview = metadata.overview;
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
    `🎬 *CineverseAI Bot v2*\n\n` +
    `Send me a movie name and I'll find download links!\n\n` +
    `Examples:\n` +
    `\`Inception\`\n` +
    `\`The Dark Knight\`\n` +
    `\`Turkish series\`\n` +
    `\`Kdrama\`\n\n` +
    `📡 Searching: YTS, 1337x, RARBG, TorrentGalaxy\n` +
    `⚡ Multiple sources for best results\n\n` +
    `🇹🇷 Turkish: Try "Eşref Rüya" or "Kurtlar Vadisi"\n` +
    `🇰🇷 Korean: Try "Squid Game" or "Crash Landing on You"`
  );
});

// ---------- HELP ----------
bot.command('help', async (ctx) => {
  await ctx.replyWithMarkdown(
    `📖 *How to use:*\n\n` +
    `1. Send any movie name\n` +
    `2. I'll search multiple sources\n` +
    `3. Get a magnet link\n` +
    `4. Open in your torrent client\n\n` +
    `⚠️ *Use a VPN for privacy*\n` +
    `⚠️ *Some sources may be blocked in your region*\n\n` +
    `🔍 *Tips for better results:*\n` +
    `• Use the English title for Hollywood movies\n` +
    `• For Turkish: Try the original name\n` +
    `• For K-Dramas: Use the English title\n` +
    `• Add the year (e.g., "Inception 2010")`
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
        `Try:\n` +
        `• Using the English title\n` +
        `• For Turkish: Try "Kurtlar Vadisi" or "Eşref Rüya"\n` +
        `• For K-Dramas: Try "Squid Game" or "Crash Landing"\n` +
        `• Adding the year (e.g., "Inception 2010")\n` +
        `• A different movie\n\n` +
        `ℹ️ Some sources may be blocked. Try again with a VPN.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Build response
    let message = `🎬 *${result.title}*`;
    if (result.year) message += ` (${result.year})`;
    if (result.rating) message += `\n⭐ Rating: ${result.rating}/10`;
    if (result.overview) message += `\n\n📝 ${result.overview.substring(0, 300)}...`;
    message += `\n\n📡 Source: ${result.source}`;
    message += `\n📦 Quality: ${result.quality}`;
    
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
    
    // Send magnet link
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
    } else {
      await ctx.reply('❌ No download link found.');
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
