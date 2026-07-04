const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const cheerio = require('cheerio');

// ============ CONFIGURATION ============
const config = {
    telegramToken: process.env.TELEGRAM_BOT_TOKEN,
    tmdbApiKey: process.env.TMDB_API_KEY,
    port: process.env.PORT || 10000
};

if (!config.telegramToken || !config.tmdbApiKey) {
    console.error('❌ Missing environment variables');
    process.exit(1);
}

const bot = new TelegramBot(config.telegramToken, { polling: true });
const userStates = {};

console.log('✅ Bot started');

// ============ MAIN MENU ============
const mainMenu = {
    reply_markup: {
        inline_keyboard: [
            [{ text: '🎬 Search Movies', callback_data: 'search_movie' }, { text: '📺 Search TV', callback_data: 'search_tv' }],
            [{ text: '🔥 Trending', callback_data: 'trending' }, { text: '⭐ Popular', callback_data: 'popular' }],
            [{ text: '❓ Help', callback_data: 'help' }]
        ]
    },
    parse_mode: 'Markdown'
};

// ============ COMMANDS ============
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, '🎥 *Welcome to CineverseAI Bot!*', mainMenu);
});

// ============ CALLBACKS ============
bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    const chatId = message.chat.id;
    const msgId = message.message_id;

    await bot.answerCallbackQuery(id);

    if (data.startsWith('torrent_')) {
        await handleTorrent(chatId, data);
        return;
    }

    const actions = {
        'search_movie': () => askSearch(chatId, msgId, 'movie'),
        'search_tv': () => askSearch(chatId, msgId, 'tv'),
        'trending': () => handleTrending(chatId, msgId),
        'popular': () => handlePopular(chatId, msgId),
        'help': () => showHelp(chatId),
        'main_menu': () => bot.editMessageText('🎥 *Welcome to CineverseAI Bot!*', { chat_id: chatId, message_id: msgId, ...mainMenu })
    };

    if (actions[data]) await actions[data]();
});

// ============ SEARCH ============
async function askSearch(chatId, msgId, type) {
    userStates[chatId] = { type };
    const label = type === 'movie' ? 'movie' : 'TV show';
    await bot.editMessageText(`📝 *Enter ${label} name:*`, {
        chat_id: chatId,
        message_id: msgId,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '◀️ Back', callback_data: 'main_menu' }]]
        }
    });
}

bot.on('message', async (msg) => {
    const { chat, text } = msg;
    if (!text || text.startsWith('/') || !userStates[chat.id]) return;

    const { type } = userStates[chat.id];
    delete userStates[chat.id];
    await searchMedia(chat.id, text, type);
});

async function searchMedia(chatId, query, type) {
    try {
        const endpoint = type === 'movie' ? 'movie' : 'tv';
        const { data } = await axios.get(`https://api.themoviedb.org/3/search/${endpoint}`, {
            params: { api_key: config.tmdbApiKey, query, page: 1 }
        });

        if (!data.results?.length) {
            return bot.sendMessage(chatId, '❌ No results found.');
        }

        for (const item of data.results.slice(0, 5)) {
            const title = type === 'movie' ? item.title : item.name;
            const year = (type === 'movie' ? item.release_date : item.first_air_date)?.split('-')[0] || 'N/A';
            const overview = item.overview?.slice(0, 200) + '...' || 'No description.';

            const buttons = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎬 Get Torrents', callback_data: `torrent_${item.id}_${type}` }],
                        [{ text: '🔍 Search Again', callback_data: type === 'movie' ? 'search_movie' : 'search_tv' },
                         { text: '🏠 Main Menu', callback_data: 'main_menu' }]
                    ]
                },
                parse_mode: 'Markdown'
            };

            const caption = `🎥 *${title}* (${year})\n\n📝 ${overview}`;

            if (item.poster_path) {
                await bot.sendPhoto(chatId, `https://image.tmdb.org/t/p/w500${item.poster_path}`, { caption, ...buttons });
            } else {
                await bot.sendMessage(chatId, caption, buttons);
            }
        }
    } catch (error) {
        console.error('Search error:', error.message);
        await bot.sendMessage(chatId, '❌ Search failed. Try again.');
    }
}

// ============ TRENDING & POPULAR ============
async function handleTrending(chatId, msgId) {
    try {
        const { data } = await axios.get('https://api.themoviedb.org/3/trending/movie/week', {
            params: { api_key: config.tmdbApiKey }
        });

        let text = '🔥 *Trending Movies*\n\n';
        const keyboard = [];

        data.results.slice(0, 5).forEach((movie, i) => {
            const year = movie.release_date?.split('-')[0] || 'N/A';
            text += `${i+1}. *${movie.title}* (${year})\n`;
            text += `   ${movie.overview?.slice(0, 80) || ''}\n\n`;
            keyboard.push([{ text: `🎬 Get ${movie.title}`, callback_data: `torrent_${movie.id}_movie` }]);
        });

        keyboard.push([{ text: '🔍 Search', callback_data: 'search_movie' }, { text: '🏠 Menu', callback_data: 'main_menu' }]);

        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Trending error:', error.message);
        await bot.sendMessage(chatId, '❌ Failed to load trending.');
    }
}

async function handlePopular(chatId, msgId) {
    try {
        const { data } = await axios.get('https://api.themoviedb.org/3/movie/popular', {
            params: { api_key: config.tmdbApiKey }
        });

        let text = '⭐ *Popular Movies*\n\n';
        const keyboard = [];

        data.results.slice(0, 5).forEach((movie, i) => {
            const year = movie.release_date?.split('-')[0] || 'N/A';
            text += `${i+1}. *${movie.title}* (${year})\n`;
            text += `   ${movie.overview?.slice(0, 80) || ''}\n\n`;
            keyboard.push([{ text: `🎬 Get ${movie.title}`, callback_data: `torrent_${movie.id}_movie` }]);
        });

        keyboard.push([{ text: '🔍 Search', callback_data: 'search_movie' }, { text: '🏠 Menu', callback_data: 'main_menu' }]);

        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Popular error:', error.message);
        await bot.sendMessage(chatId, '❌ Failed to load popular.');
    }
}

// ============ TORRENT SEARCH - MULTIPLE SOURCES ============
async function searchTorrents(query) {
    const allResults = [];
    const cleanQuery = encodeURIComponent(query.trim());
    
    console.log(`🔍 Searching: "${query}"`);

    // SOURCE 1: 1337x (with proxy)
    try {
        const response = await axios.get(`https://1337x-proxy.com/search/${cleanQuery}/1/`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        $('tbody tr').each((i, el) => {
            if (i >= 3) return false;
            const name = $(el).find('.name a').last().text().trim();
            const magnet = $(el).find('.magnet-download a').attr('href');
            const seeds = $(el).find('.seeds').text().trim();
            const size = $(el).find('.size').text().trim();
            
            if (name && magnet && name.length > 3) {
                allResults.push({
                    name: name.substring(0, 60),
                    magnet: magnet,
                    seeds: seeds || 'N/A',
                    size: size || 'N/A',
                    source: '1337x'
                });
            }
        });
        console.log(`✅ 1337x: ${allResults.length} results`);
    } catch (error) {
        console.log('❌ 1337x error:', error.message);
    }

    // SOURCE 2: ThePirateBay
    try {
        const response = await axios.get(`https://thepiratebay.org/search/${cleanQuery}/0/99/0`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        $('#searchResult tbody tr').each((i, el) => {
            if (i >= 3) return false;
            const name = $(el).find('.detLink').text().trim();
            const magnet = $(el).find('a[href^="magnet:"]').attr('href');
            const seeds = $(el).find('td').eq(2).text().trim();
            const sizeText = $(el).find('.detDesc').text();
            const size = sizeText.match(/Size ([\d.]+ [A-Z]+)/)?.[1] || 'N/A';
            
            if (name && magnet && name.length > 3) {
                allResults.push({
                    name: name.substring(0, 60),
                    magnet: magnet,
                    seeds: seeds || 'N/A',
                    size: size || 'N/A',
                    source: 'TPB'
                });
            }
        });
        console.log(`✅ TPB: ${allResults.length} results`);
    } catch (error) {
        console.log('❌ TPB error:', error.message);
    }

    // SOURCE 3: YTS API
    try {
        const response = await axios.get(`https://yts.mx/api/v2/list_movies.json?query_term=${cleanQuery}&limit=3`, {
            timeout: 10000
        });

        if (response.data.data?.movies) {
            response.data.data.movies.forEach(movie => {
                movie.torrents?.forEach(t => {
                    allResults.push({
                        name: `${movie.title} (${movie.year}) - ${t.quality}`.substring(0, 60),
                        magnet: t.magnet || '',
                        seeds: t.seeds || 'N/A',
                        size: t.size || 'N/A',
                        source: 'YTS'
                    });
                });
            });
        }
        console.log(`✅ YTS: ${allResults.length} results`);
    } catch (error) {
        console.log('❌ YTS error:', error.message);
    }

    // SOURCE 4: TorrentGalaxy (via proxy)
    try {
        const response = await axios.get(`https://torrentgalaxy.to/torrents.php?search=${cleanQuery}`, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        $('.tgxtable tbody tr').each((i, el) => {
            if (i >= 3) return false;
            const name = $(el).find('.txlight a').text().trim();
            const magnet = $(el).find('a[href^="magnet:"]').attr('href');
            const seeds = $(el).find('td').eq(5).text().trim();
            const size = $(el).find('td').eq(3).text().trim();
            
            if (name && magnet && name.length > 3) {
                allResults.push({
                    name: name.substring(0, 60),
                    magnet: magnet,
                    seeds: seeds || 'N/A',
                    size: size || 'N/A',
                    source: 'TorrentGalaxy'
                });
            }
        });
        console.log(`✅ TorrentGalaxy: ${allResults.length} results`);
    } catch (error) {
        console.log('❌ TorrentGalaxy error:', error.message);
    }

    // Remove duplicates
    const unique = [];
    const seen = new Set();
    for (const result of allResults) {
        const key = result.name.substring(0, 30);
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(result);
        }
    }

    console.log(`📊 Total unique: ${unique.length}`);
    return unique.slice(0, 5);
}

// ============ TORRENT HANDLER ============
async function handleTorrent(chatId, data) {
    const [, id, type] = data.split('_');

    try {
        const endpoint = type === 'movie' ? 'movie' : 'tv';
        const { data: mediaData } = await axios.get(`https://api.themoviedb.org/3/${endpoint}/${id}`, {
            params: { api_key: config.tmdbApiKey }
        });

        const title = type === 'movie' ? mediaData.title : mediaData.name;
        const year = (type === 'movie' ? mediaData.release_date : mediaData.first_air_date)?.split('-')[0] || '';
        const searchQuery = `${title} ${year}`.trim();

        const loading = await bot.sendMessage(chatId, `🔍 *Searching: ${searchQuery}*\n⏳ Please wait...`, { 
            parse_mode: 'Markdown' 
        });

        const torrents = await searchTorrents(searchQuery);

        await bot.deleteMessage(chatId, loading.message_id).catch(() => {});

        if (!torrents.length) {
            return bot.sendMessage(chatId, `❌ No torrents found for *"${title}"*.\n\nTry:\n• Different keywords\n• Check spelling\n• Try again later`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔍 Search Again', callback_data: 'search_movie' }],
                        [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
                    ]
                }
            });
        }

        let text = `🎬 *${title}* (${year || 'N/A'})\n\n`;
        const keyboard = [];

        torrents.forEach((t, i) => {
            text += `*${i+1}. ${t.name}*\n`;
            text += `📦 ${t.size} | 👤 ${t.seeds} seeds\n`;
            text += `📡 ${t.source}\n\n`;
            if (t.magnet) {
                keyboard.push([{ text: `⬇️ Download ${i+1}`, url: t.magnet }]);
            }
        });

        if (keyboard.length === 0) {
            text += '⚠️ No direct download links available.';
        }

        keyboard.push([{ text: '🔍 Search Again', callback_data: 'search_movie' }, { text: '🏠 Menu', callback_data: 'main_menu' }]);

        await bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });

    } catch (error) {
        console.error('Torrent error:', error.message);
        await bot.sendMessage(chatId, '❌ Failed to fetch torrents. Please try again.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔍 Try Again', callback_data: 'search_movie' }],
                    [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
                ]
            }
        });
    }
}

// ============ HELP ============
function showHelp(chatId) {
    const helpText = `🤖 *CineverseAI Bot*

🎬 Search Movies & TV Shows
🔥 Trending & Popular Movies
⬇️ Get torrent links

*Commands:*
/start - Main menu

*Torrent Sources:*
• 1337x
• ThePirateBay
• YTS
• TorrentGalaxy`;

    bot.sendMessage(chatId, helpText, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '🏠 Main Menu', callback_data: 'main_menu' }]]
        }
    });
}

// ============ HEALTH CHECK ============
const app = express();
app.get('/', (req, res) => res.send('CineverseAI Bot is running'));
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.listen(config.port, () => console.log(`✅ Health check on port ${config.port}`));

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err.message));
