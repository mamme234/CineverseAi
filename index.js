const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

// ============ CONFIG ============
const token = process.env.TELEGRAM_BOT_TOKEN;
const tmdbKey = process.env.TMDB_API_KEY;

if (!token || !tmdbKey) {
    console.error('❌ Missing environment variables');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const waiting = {};

console.log('✅ Bot started');

// ============ MAIN MENU ============
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, '🎥 *Welcome!*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎬 Search Movie', callback_data: 'movie' }],
                [{ text: '📺 Search TV Show', callback_data: 'tv' }],
                [{ text: '🔥 Trending', callback_data: 'trending' }]
            ]
        }
    });
});

// ============ CALLBACKS ============
bot.on('callback_query', async (query) => {
    const { data, message, id } = query;
    const chatId = message.chat.id;
    
    await bot.answerCallbackQuery(id);

    if (data === 'movie' || data === 'tv') {
        waiting[chatId] = data;
        bot.editMessageText(`📝 *Enter ${data === 'movie' ? 'movie' : 'TV show'} name:*`, {
            chat_id: chatId,
            message_id: message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '◀️ Back', callback_data: 'back' }]]
            }
        });
        return;
    }

    if (data === 'back') {
        bot.editMessageText('🎥 *Welcome!*', {
            chat_id: chatId,
            message_id: message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎬 Search Movie', callback_data: 'movie' }],
                    [{ text: '📺 Search TV Show', callback_data: 'tv' }],
                    [{ text: '🔥 Trending', callback_data: 'trending' }]
                ]
            }
        });
        return;
    }

    if (data === 'trending') {
        await getTrending(chatId, message.message_id);
        return;
    }

    if (data.startsWith('torrent_')) {
        await getTorrents(chatId, data);
        return;
    }
});

// ============ SEARCH ============
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!text || text.startsWith('/') || !waiting[chatId]) return;
    
    const type = waiting[chatId];
    delete waiting[chatId];
    
    await searchMedia(chatId, text, type);
});

async function searchMedia(chatId, query, type) {
    try {
        const endpoint = type === 'movie' ? 'movie' : 'tv';
        const { data } = await axios.get(
            `https://api.themoviedb.org/3/search/${endpoint}`,
            { params: { api_key: tmdbKey, query } }
        );

        if (!data.results?.length) {
            return bot.sendMessage(chatId, '❌ No results found.');
        }

        for (const item of data.results.slice(0, 5)) {
            const title = type === 'movie' ? item.title : item.name;
            const year = (type === 'movie' ? item.release_date : item.first_air_date)?.split('-')[0] || 'N/A';
            const desc = item.overview?.slice(0, 150) || 'No description.';

            bot.sendMessage(chatId, `🎥 *${title}* (${year})\n\n${desc}`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬇️ Get Torrents', callback_data: `torrent_${item.id}_${type}` }],
                        [{ text: '🔍 Search Again', callback_data: type === 'movie' ? 'movie' : 'tv' }]
                    ]
                }
            });
        }
    } catch (error) {
        bot.sendMessage(chatId, '❌ Search failed. Try again.');
    }
}

// ============ TRENDING ============
async function getTrending(chatId, msgId) {
    try {
        const { data } = await axios.get(
            'https://api.themoviedb.org/3/trending/movie/week',
            { params: { api_key: tmdbKey } }
        );

        let text = '🔥 *Trending Movies*\n\n';
        const keyboard = [];

        data.results.slice(0, 5).forEach((movie, i) => {
            const year = movie.release_date?.split('-')[0] || 'N/A';
            text += `${i+1}. *${movie.title}* (${year})\n`;
            keyboard.push([{ text: `⬇️ ${movie.title}`, callback_data: `torrent_${movie.id}_movie` }]);
        });

        keyboard.push([{ text: '🏠 Menu', callback_data: 'back' }]);

        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: msgId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    } catch (error) {
        bot.sendMessage(chatId, '❌ Failed to load trending.');
    }
}

// ============ TORRENTS ============
async function searchTorrents(query) {
    const results = [];
    const clean = encodeURIComponent(query.trim());

    // Try YTS (most reliable)
    try {
        const { data } = await axios.get(
            `https://yts.mx/api/v2/list_movies.json?query_term=${clean}&limit=5`,
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
        }
    } catch (e) {}

    // Try TorrentAPI
    if (results.length < 3) {
        try {
            const { data } = await axios.get(
                `https://torrentapi.org/pubapi_v2.php?mode=search&search_string=${clean}&format=json&limit=5`,
                { timeout: 10000 }
            );
            
            if (data.torrent_results) {
                data.torrent_results.forEach(t => {
                    if (t.download) {
                        results.push({
                            name: t.title || 'Unknown',
                            magnet: t.download,
                            seeds: t.seeds || 'N/A',
                            size: t.size || 'N/A',
                            source: 'TorrentAPI'
                        });
                    }
                });
            }
        } catch (e) {}
    }

    return results.slice(0, 5);
}

async function getTorrents(chatId, data) {
    const [, id, type] = data.split('_');
    
    try {
        const endpoint = type === 'movie' ? 'movie' : 'tv';
        const { data: media } = await axios.get(
            `https://api.themoviedb.org/3/${endpoint}/${id}`,
            { params: { api_key: tmdbKey } }
        );

        const title = type === 'movie' ? media.title : media.name;
        const year = (type === 'movie' ? media.release_date : media.first_air_date)?.split('-')[0] || '';
        const query = `${title} ${year}`.trim();

        const loading = await bot.sendMessage(chatId, `🔍 Searching for *${title}*...`, { parse_mode: 'Markdown' });

        const torrents = await searchTorrents(query);

        await bot.deleteMessage(chatId, loading.message_id).catch(() => {});

        if (!torrents.length) {
            return bot.sendMessage(chatId, `❌ No torrents found for *${title}*.`, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔍 Try Again', callback_data: type === 'movie' ? 'movie' : 'tv' }],
                        [{ text: '🏠 Menu', callback_data: 'back' }]
                    ]
                }
            });
        }

        let text = `🎬 *${title}* (${year || 'N/A'})\n\n`;
        const keyboard = [];

        torrents.forEach((t, i) => {
            text += `*${i+1}. ${t.name}*\n`;
            text += `📦 ${t.size} | 👤 ${t.seeds}\n\n`;
            if (t.magnet) {
                keyboard.push([{ text: `⬇️ Download ${i+1}`, url: t.magnet }]);
            }
        });

        keyboard.push([{ text: '🔍 Search Again', callback_data: type === 'movie' ? 'movie' : 'tv' }]);
        keyboard.push([{ text: '🏠 Menu', callback_data: 'back' }]);

        bot.sendMessage(chatId, text, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });

    } catch (error) {
        bot.sendMessage(chatId, '❌ Error. Try again.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🏠 Menu', callback_data: 'back' }]
                ]
            }
        });
    }
}

// ============ SERVER ============
const app = express();
app.get('/', (req, res) => res.send('Bot is running'));
app.listen(process.env.PORT || 10000, () => console.log('✅ Server running'));

console.log('🤖 Ready!');
