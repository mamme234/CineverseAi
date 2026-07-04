const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

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

// ============ SAFE SEND MESSAGE ============
async function safeSend(chatId, text, options = {}) {
    try {
        return await bot.sendMessage(chatId, text, options);
    } catch (error) {
        console.error('Send error:', error.message);
        return null;
    }
}

async function safeEdit(chatId, msgId, text, options = {}) {
    try {
        return await bot.editMessageText(text, { chat_id: chatId, message_id: msgId, ...options });
    } catch (error) {
        console.error('Edit error:', error.message);
        return null;
    }
}

async function safeDelete(chatId, msgId) {
    try {
        await bot.deleteMessage(chatId, msgId);
    } catch (error) {
        // Ignore delete errors
    }
}

// ============ COMMANDS ============
bot.onText(/\/start/, (msg) => {
    safeSend(msg.chat.id, '🎥 *Welcome to CineverseAI Bot!*', mainMenu);
});

// ============ CALLBACKS ============
bot.on('callback_query', async (query) => {
    try {
        const { data, message, id } = query;
        const chatId = message.chat.id;
        const msgId = message.message_id;

        await bot.answerCallbackQuery(id).catch(() => {});

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
            'main_menu': () => safeEdit(chatId, msgId, '🎥 *Welcome to CineverseAI Bot!*', mainMenu)
        };

        if (actions[data]) await actions[data]();
    } catch (error) {
        console.error('Callback error:', error.message);
    }
});

// ============ SEARCH ============
async function askSearch(chatId, msgId, type) {
    userStates[chatId] = { type };
    const label = type === 'movie' ? 'movie' : 'TV show';
    await safeEdit(chatId, msgId, `📝 *Enter ${label} name:*`, {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{ text: '◀️ Back', callback_data: 'main_menu' }]]
        }
    });
}

bot.on('message', async (msg) => {
    try {
        const { chat, text } = msg;
        if (!text || text.startsWith('/') || !userStates[chat.id]) return;

        const { type } = userStates[chat.id];
        delete userStates[chat.id];
        await searchMedia(chat.id, text, type);
    } catch (error) {
        console.error('Message error:', error.message);
    }
});

async function searchMedia(chatId, query, type) {
    try {
        const endpoint = type === 'movie' ? 'movie' : 'tv';
        const { data } = await axios.get(`https://api.themoviedb.org/3/search/${endpoint}`, {
            params: { api_key: config.tmdbApiKey, query, page: 1 },
            timeout: 10000
        });

        if (!data.results?.length) {
            return safeSend(chatId, '❌ No results found.');
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
                await bot.sendPhoto(chatId, `https://image.tmdb.org/t/p/w500${item.poster_path}`, { caption, ...buttons }).catch(() => {
                    safeSend(chatId, caption, buttons);
                });
            } else {
                await safeSend(chatId, caption, buttons);
            }
        }
    } catch (error) {
        console.error('Search error:', error.message);
        await safeSend(chatId, '❌ Search failed. Try again.');
    }
}

// ============ TRENDING & POPULAR ============
async function handleTrending(chatId, msgId) {
    try {
        const { data } = await axios.get('https://api.themoviedb.org/3/trending/movie/week', {
            params: { api_key: config.tmdbApiKey },
            timeout: 10000
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

        await safeEdit(chatId, msgId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Trending error:', error.message);
        await safeSend(chatId, '❌ Failed to load trending.');
    }
}

async function handlePopular(chatId, msgId) {
    try {
        const { data } = await axios.get('https://api.themoviedb.org/3/movie/popular', {
            params: { api_key: config.tmdbApiKey },
            timeout: 10000
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

        await safeEdit(chatId, msgId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        console.error('Popular error:', error.message);
        await safeSend(chatId, '❌ Failed to load popular.');
    }
}

// ============ TORRENT SEARCH ============
async function searchTorrents(query) {
    const results = [];
    const cleanQuery = encodeURIComponent(query.trim());
    
    console.log(`🔍 Searching: "${query}"`);

    // Source 1: TorrentAPI
    try {
        const { data } = await axios.get(
            `https://torrentapi.org/pubapi_v2.php?mode=search&search_string=${cleanQuery}&format=json&limit=10`,
            { timeout: 15000 }
        );
        
        if (data.torrent_results?.length) {
            data.torrent_results.slice(0, 5).forEach(t => {
                if (t.download) {
                    results.push({
                        name: t.title || t.filename || 'Unknown',
                        magnet: t.download,
                        seeds: t.seeds || 'N/A',
                        size: t.size || 'N/A',
                        source: 'TorrentAPI'
                    });
                }
            });
            console.log(`✅ TorrentAPI: ${results.length} results`);
        }
    } catch (error) {
        console.log('❌ TorrentAPI error');
    }

    // Source 2: YTS
    if (results.length < 3) {
        try {
            const { data } = await axios.get(
                `https://yts.mx/api/v2/list_movies.json?query_term=${cleanQuery}&limit=5`,
                { timeout: 10000 }
            );
            
            if (data.data?.movies) {
                data.data.movies.forEach(movie => {
                    movie.torrents?.forEach(t => {
                        if (t.magnet) {
                            results.push({
                                name: `${movie.title} (${movie.year}) - ${t.quality}`,
                                magnet: t.magnet,
                                seeds: t.seeds || 'N/A',
                                size: t.size || 'N/A',
                                source: 'YTS'
                            });
                        }
                    });
                });
                console.log(`✅ YTS: ${results.length} results`);
            }
        } catch (error) {
            console.log('❌ YTS error');
        }
    }

    // Source 3: SolidTorrents
    if (results.length < 3) {
        try {
            const { data } = await axios.get(
                `https://solidtorrents.to/api/v1/search?q=${cleanQuery}&limit=5`,
                { timeout: 15000 }
            );
            
            if (data.results?.length) {
                data.results.forEach(t => {
                    if (t.magnet) {
                        results.push({
                            name: t.name || 'Unknown',
                            magnet: t.magnet,
                            seeds: t.seeds || 'N/A',
                            size: t.size || 'N/A',
                            source: 'SolidTorrents'
                        });
                    }
                });
                console.log(`✅ SolidTorrents: ${results.length} results`);
            }
        } catch (error) {
            console.log('❌ SolidTorrents error');
        }
    }

    // Source 4: 1337x (via proxy)
    if (results.length < 2) {
        try {
            const { data } = await axios.get(
                `https://1337x-proxy.com/search/${cleanQuery}/1/`,
                { 
                    timeout: 15000,
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                }
            );
            
            const cheerio = require('cheerio');
            const $ = cheerio.load(data);
            
            $('tbody tr').each((i, el) => {
                if (i >= 3) return false;
                const name = $(el).find('.name a').last().text().trim();
                const magnet = $(el).find('.magnet-download a').attr('href');
                const seeds = $(el).find('.seeds').text().trim();
                const size = $(el).find('.size').text().trim();
                
                if (name && magnet) {
                    results.push({
                        name: name.substring(0, 60),
                        magnet: magnet,
                        seeds: seeds || 'N/A',
                        size: size || 'N/A',
                        source: '1337x'
                    });
                }
            });
            console.log(`✅ 1337x: ${results.length} results`);
        } catch (error) {
            console.log('❌ 1337x error');
        }
    }

    // Remove duplicates
    const unique = [];
    const seen = new Set();
    for (const result of results) {
        const key = result.name.substring(0, 30);
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(result);
        }
    }

    console.log(`📊 Total: ${unique.length} results`);
    return unique.slice(0, 5);
}

// ============ TORRENT HANDLER ============
async function handleTorrent(chatId, data) {
    try {
        const [, id, type] = data.split('_');

        const endpoint = type === 'movie' ? 'movie' : 'tv';
        const { data: mediaData } = await axios.get(`https://api.themoviedb.org/3/${endpoint}/${id}`, {
            params: { api_key: config.tmdbApiKey },
            timeout: 10000
        });

        const title = type === 'movie' ? mediaData.title : mediaData.name;
        const year = (type === 'movie' ? mediaData.release_date : mediaData.first_air_date)?.split('-')[0] || '';
        const searchQuery = `${title} ${year}`.trim();

        const loading = await safeSend(chatId, `🔍 *Searching: ${searchQuery}*\n⏳ Please wait...`, { parse_mode: 'Markdown' });
        
        if (loading) {
            setTimeout(() => safeDelete(chatId, loading.message_id), 5000);
        }

        const torrents = await searchTorrents(searchQuery);

        if (!torrents.length) {
            return safeSend(chatId, `❌ No torrents found for *"${title}"*.\n\nTry:\n• Different keywords\n• Check spelling\n• Try again later`, {
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
            if (t.magnet && t.magnet.startsWith('magnet:')) {
                keyboard.push([{ text: `⬇️ Download ${i+1}`, url: t.magnet }]);
            }
        });

        if (!keyboard.length) {
            text += '⚠️ No magnet links available. Try another source.\n';
        }

        keyboard.push([{ text: '🔍 Search Again', callback_data: 'search_movie' }, { text: '🏠 Menu', callback_data: 'main_menu' }]);

        await safeSend(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });

    } catch (error) {
        console.error('Torrent error:', error.message);
        await safeSend(chatId, '❌ Failed to fetch torrents. Please try again.', {
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
• TorrentAPI
• YTS
• SolidTorrents
• 1337x`;

    safeSend(chatId, helpText, {
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

// ============ ERROR HANDLING ============
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err.message);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err.message);
});

console.log('🤖 Bot is ready!');
