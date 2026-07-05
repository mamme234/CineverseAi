const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

// ============ CONFIG ============
const token = process.env.TELEGRAM_BOT_TOKEN;
const tmdbKey = process.env.TMDB_API_KEY;

if (!token || !tmdbKey) {
    console.error('❌ Missing TELEGRAM_BOT_TOKEN or TMDB_API_KEY');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
const waiting = {};

console.log('✅ Bot started');

// ============ MAIN MENU ============
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, '🎥 *Welcome to CineverseAI Bot!*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎬 Search Movie', callback_data: 'movie' }],
                [{ text: '📺 Search TV Show', callback_data: 'tv' }],
                [{ text: '🔥 Trending', callback_data: 'trending' }],
                [{ text: '⭐ Popular', callback_data: 'popular' }]
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
        bot.editMessageText('🎥 *Welcome to CineverseAI Bot!*', {
            chat_id: chatId,
            message_id: message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🎬 Search Movie', callback_data: 'movie' }],
                    [{ text: '📺 Search TV Show', callback_data: 'tv' }],
                    [{ text: '🔥 Trending', callback_data: 'trending' }],
                    [{ text: '⭐ Popular', callback_data: 'popular' }]
                ]
            }
        });
        return;
    }

    if (data === 'trending') {
        await getTrending(chatId, message.message_id);
        return;
    }

    if (data === 'popular') {
        await getPopular(chatId, message.message_id);
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
            const rating = item.vote_average?.toFixed(1) || 'N/A';

            const buttons = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '⬇️ Get Torrents', callback_data: `torrent_${item.id}_${type}` }],
                        [{ text: '🔍 Search Again', callback_data: type === 'movie' ? 'movie' : 'tv' }]
                    ]
                },
                parse_mode: 'Markdown'
            };

            const caption = `🎥 *${title}* (${year})\n⭐ ${rating}/10\n\n📝 ${desc}`;

            if (item.poster_path) {
                await bot.sendPhoto(chatId, `https://image.tmdb.org/t/p/w500${item.poster_path}`, {
                    caption: caption,
                    ...buttons
                });
            } else {
                await bot.sendMessage(chatId, caption, buttons);
            }
        }
    } catch (error) {
        bot.sendMessage(chatId, '❌ Search failed. Try again.');
    }
}

// ============ TRENDING & POPULAR ============
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
            text += `${i+1}. *${movie.title}* (${year}) ⭐${movie.vote_average?.toFixed(1)}\n`;
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

async function getPopular(chatId, msgId) {
    try {
        const { data } = await axios.get(
            'https://api.themoviedb.org/3/movie/popular',
            { params: { api_key: tmdbKey } }
        );

        let text = '⭐ *Popular Movies*\n\n';
        const keyboard = [];

        data.results.slice(0, 5).forEach((movie, i) => {
            const year = movie.release_date?.split('-')[0] || 'N/A';
            text += `${i+1}. *${movie.title}* (${year}) ⭐${movie.vote_average?.toFixed(1)}\n`;
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
        bot.sendMessage(chatId, '❌ Failed to load popular.');
    }
}

// ============ SOLIDTORRENTS SEARCH ============
async function searchSolidTorrents(query) {
    const results = [];
    const clean = encodeURIComponent(query.trim());
    
    console.log(`🔍 Searching SolidTorrents: "${query}"`);

    try {
        const { data } = await axios.get(
            `https://solidtorrents.to/api/v1/search?q=${clean}&limit=10`,
            { 
                timeout: 15000,
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        );
        
        if (data.results && data.results.length > 0) {
            data.results.forEach(t => {
                if (t.magnet) {
                    results.push({
                        name: t.name || 'Unknown',
                        magnet: t.magnet,
                        seeds: t.seeds || 'N/A',
                        size: t.size || 'N/A',
                        source: '🔷 SolidTorrents'
                    });
                }
            });
            console.log(`✅ Found ${results.length} torrents`);
        }
    } catch (error) {
        console.log('❌ SolidTorrents error:', error.message);
    }

    return results.slice(0, 5);
}

// ============ TORRENT HANDLER ============
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
        const poster = media.poster_path ? `https://image.tmdb.org/t/p/w500${media.poster_path}` : null;
        const query = `${title} ${year}`.trim();

        const loading = await bot.sendMessage(chatId, `🔍 Searching SolidTorrents for *${title}*...`, { 
            parse_mode: 'Markdown' 
        });

        const torrents = await searchSolidTorrents(query);

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
            text += `📦 ${t.size} | 👤 ${t.seeds} seeds\n`;
            text += `📡 ${t.source}\n\n`;
            if (t.magnet) {
                keyboard.push([{ text: `⬇️ Download ${i+1}`, url: t.magnet }]);
            }
        });

        keyboard.push([{ text: '🔍 Search Again', callback_data: type === 'movie' ? 'movie' : 'tv' }]);
        keyboard.push([{ text: '🏠 Menu', callback_data: 'back' }]);

        // Send with poster if available
        if (poster) {
            await bot.sendPhoto(chatId, poster, {
                caption: text,
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        } else {
            await bot.sendMessage(chatId, text, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        }

    } catch (error) {
        console.error('Error:', error.message);
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
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.listen(process.env.PORT || 10000, () => console.log('✅ Server running'));

console.log('🤖 Bot Ready!');
console.log('📌 Torrent Source: SolidTorrents');
console.log('📌 Posters: TMDB');
