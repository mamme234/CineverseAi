const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');
const cheerio = require('cheerio');

// ============ ENVIRONMENT VARIABLES ============
const token = process.env.TELEGRAM_BOT_TOKEN;
const tmdbApiKey = process.env.TMDB_API_KEY;

// Check if token exists
if (!token) {
    console.error('❌ TELEGRAM_BOT_TOKEN is not set in environment variables!');
    process.exit(1);
}

if (!tmdbApiKey) {
    console.error('❌ TMDB_API_KEY is not set in environment variables!');
    process.exit(1);
}

// ============ INITIALIZE BOT ============
let bot;
try {
    bot = new TelegramBot(token, { 
        polling: true,
        onlyFirstMatch: true
    });
    console.log('✅ Bot initialized successfully');
} catch (error) {
    console.error('❌ Failed to initialize bot:', error.message);
    process.exit(1);
}

// ============ USER STATES ============
const userStates = {};

// ============ TORRENT SOURCES ============
const torrentSources = [
    {
        name: '1337x',
        baseUrl: 'https://1337x.to',
        searchUrl: (query) => `https://1337x.to/search/${encodeURIComponent(query)}/1/`,
        parse: (html) => {
            const $ = cheerio.load(html);
            const results = [];
            $('tbody tr').each((i, el) => {
                if (i >= 5) return false;
                const name = $(el).find('.name a').last().text().trim();
                const magnet = $(el).find('.magnet-download a').attr('href');
                const seeds = $(el).find('.seeds').text().trim();
                const size = $(el).find('.size').text().trim();
                if (name && magnet) {
                    results.push({ name, magnet, seeds, size, source: '1337x' });
                }
            });
            return results;
        }
    },
    {
        name: 'ThePirateBay',
        baseUrl: 'https://thepiratebay.org',
        searchUrl: (query) => `https://thepiratebay.org/search/${encodeURIComponent(query)}/0/99/0`,
        parse: (html) => {
            const $ = cheerio.load(html);
            const results = [];
            $('#searchResult tbody tr').each((i, el) => {
                if (i >= 5) return false;
                const name = $(el).find('.detLink').text().trim();
                const magnet = $(el).find('a[href^="magnet:"]').attr('href');
                const seeds = $(el).find('td').eq(2).text().trim();
                const size = $(el).find('.detDesc').text().match(/Size ([\d.]+ [A-Z]+)/)?.[1] || 'N/A';
                if (name && magnet) {
                    results.push({ name, magnet, seeds, size, source: 'TPB' });
                }
            });
            return results;
        }
    },
    {
        name: 'YTS',
        baseUrl: 'https://yts.mx',
        searchUrl: (query) => `https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(query)}&limit=5`,
        parse: async (response) => {
            try {
                const data = response.data;
                const results = [];
                if (data.data && data.data.movies) {
                    for (const movie of data.data.movies) {
                        if (movie.torrents) {
                            for (const torrent of movie.torrents) {
                                results.push({
                                    name: `${movie.title} (${movie.year}) - ${torrent.quality} ${torrent.type}`,
                                    magnet: torrent.magnet || `https://yts.mx/torrent/download/${torrent.hash}`,
                                    seeds: torrent.seeds || 'N/A',
                                    size: torrent.size || 'N/A',
                                    source: 'YTS'
                                });
                            }
                        }
                    }
                }
                return results.slice(0, 5);
            } catch (error) {
                console.error('YTS parse error:', error.message);
                return [];
            }
        }
    }
];

// ============ MAIN MENU ============
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    showMainMenu(chatId);
});

function showMainMenu(chatId) {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🎬 Search Movies', callback_data: 'search_movie' },
                    { text: '📺 Search TV Shows', callback_data: 'search_tv' }
                ],
                [
                    { text: '🔥 Trending', callback_data: 'trending' },
                    { text: '⭐ Popular', callback_data: 'popular' }
                ],
                [
                    { text: '❓ Help', callback_data: 'help' }
                ]
            ]
        },
        parse_mode: 'Markdown'
    };
    
    bot.sendMessage(chatId, '🎥 *Welcome to CineverseAI Bot!*\n\nChoose an option below:', options);
}

// ============ CALLBACK QUERY HANDLER ============
bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    
    try {
        await bot.answerCallbackQuery(callbackQuery.id);
    } catch (error) {
        console.error('Error answering callback:', error.message);
    }
    
    // Handle torrent callback
    if (action && action.startsWith('torrent_')) {
        await handleTorrentSearch(chatId, action);
        return;
    }
    
    // Handle more torrents
    if (action && action.startsWith('more_torrents_')) {
        await handleMoreTorrents(chatId, action);
        return;
    }
    
    switch(action) {
        case 'search_movie':
        case 'search_tv':
            userStates[chatId] = { action: 'waiting_for_search', type: action };
            try {
                await bot.editMessageText(
                    `📝 *Enter the ${action === 'search_movie' ? 'movie' : 'TV show'} name:*`,
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '◀️ Back to Main Menu', callback_data: 'main_menu' }]
                            ]
                        }
                    }
                );
            } catch (error) {
                console.error('Error editing message:', error.message);
            }
            break;
            
        case 'trending':
            await handleTrending(chatId, messageId);
            break;
            
        case 'popular':
            await handlePopular(chatId, messageId);
            break;
            
        case 'main_menu':
            try {
                await bot.editMessageText(
                    '🎥 *Welcome to CineverseAI Bot!*\n\nChoose an option below:',
                    {
                        chat_id: chatId,
                        message_id: messageId,
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '🎬 Search Movies', callback_data: 'search_movie' },
                                    { text: '📺 Search TV Shows', callback_data: 'search_tv' }
                                ],
                                [
                                    { text: '🔥 Trending', callback_data: 'trending' },
                                    { text: '⭐ Popular', callback_data: 'popular' }
                                ],
                                [
                                    { text: '❓ Help', callback_data: 'help' }
                                ]
                            ]
                        }
                    }
                );
            } catch (error) {
                console.error('Error returning to main menu:', error.message);
            }
            break;
            
        case 'help':
            await showHelp(chatId, messageId);
            break;
    }
});

// ============ TEXT MESSAGE HANDLER ============
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!text || text.startsWith('/')) return;
    if (!userStates[chatId]) return;
    
    const state = userStates[chatId];
    if (state.action === 'waiting_for_search') {
        await performSearch(chatId, text, state.type);
        delete userStates[chatId];
    }
});

// ============ SEARCH FUNCTIONS ============
async function performSearch(chatId, query, type) {
    try {
        const searchType = type === 'search_movie' ? 'movie' : 'tv';
        const response = await axios.get(
            `https://api.themoviedb.org/3/search/${searchType}`,
            {
                params: {
                    api_key: tmdbApiKey,
                    query: query,
                    page: 1
                }
            }
        );
        
        if (!response.data.results || response.data.results.length === 0) {
            await bot.sendMessage(chatId, '❌ No results found. Try another search.');
            return;
        }
        
        const results = response.data.results.slice(0, 5);
        
        for (const item of results) {
            const title = type === 'search_movie' ? item.title : item.name;
            const year = type === 'search_movie' ? 
                item.release_date?.split('-')[0] : 
                item.first_air_date?.split('-')[0];
            const overview = item.overview ? item.overview.slice(0, 200) + '...' : 'No description available.';
            
            const buttons = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '🎬 Get Torrents', callback_data: `torrent_${item.id}_${type}` }
                        ],
                        [
                            { text: '🔍 Search Again', callback_data: type === 'movie' ? 'search_movie' : 'search_tv' },
                            { text: '🏠 Main Menu', callback_data: 'main_menu' }
                        ]
                    ]
                },
                parse_mode: 'Markdown'
            };
            
            const caption = `🎥 *${title}* (${year || 'N/A'})\n\n📝 ${overview}`;
            
            try {
                if (item.poster_path) {
                    const posterUrl = `https://image.tmdb.org/t/p/w500${item.poster_path}`;
                    await bot.sendPhoto(chatId, posterUrl, {
                        caption: caption,
                        ...buttons
                    });
                } else {
                    await bot.sendMessage(chatId, caption, buttons);
                }
            } catch (error) {
                console.error('Error sending result:', error.message);
                await bot.sendMessage(chatId, caption, buttons);
            }
        }
        
    } catch (error) {
        console.error('Search error:', error.message);
        await bot.sendMessage(chatId, '❌ Error performing search. Please try again.');
    }
}

// ============ TORRENT SEARCH ============
async function searchTorrents(query) {
    const allResults = [];
    
    for (const source of torrentSources) {
        try {
            console.log(`🔍 Searching ${source.name} for: ${query}`);
            
            if (source.name === 'YTS') {
                // YTS uses JSON API
                const response = await axios.get(source.searchUrl(query), {
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                const results = await source.parse(response);
                allResults.push(...results);
            } else {
                // HTML scrapers
                const response = await axios.get(source.searchUrl(query), {
                    timeout: 10000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                const results = source.parse(response.data);
                allResults.push(...results);
            }
            
            if (allResults.length >= 5) break;
            
        } catch (error) {
            console.error(`❌ ${source.name} error:`, error.message);
        }
    }
    
    return allResults;
}

// ============ TORRENT HANDLER ============
async function handleTorrentSearch(chatId, data) {
    const [, id, type] = data.split('_');
    
    // Get movie/TV show title from TMDb
    try {
        const searchType = type === 'movie' ? 'movie' : 'tv';
        const response = await axios.get(
            `https://api.themoviedb.org/3/${searchType}/${id}`,
            {
                params: {
                    api_key: tmdbApiKey,
                    language: 'en-US'
                }
            }
        );
        
        const title = type === 'movie' ? response.data.title : response.data.name;
        const year = type === 'movie' ? 
            response.data.release_date?.split('-')[0] : 
            response.data.first_air_date?.split('-')[0];
        
        const searchQuery = `${title} ${year || ''}`.trim();
        
        // Send searching message
        const searchingMsg = await bot.sendMessage(
            chatId, 
            `🔍 *Searching for torrents:* ${searchQuery}\n\n⏳ Please wait...`,
            { parse_mode: 'Markdown' }
        );
        
        // Search for torrents
        const torrents = await searchTorrents(searchQuery);
        
        // Delete searching message
        await bot.deleteMessage(chatId, searchingMsg.message_id);
        
        if (torrents.length === 0) {
            await bot.sendMessage(
                chatId, 
                '❌ No torrents found for this title. Try searching with different keywords.',
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔍 Try Different Search', callback_data: 'search_movie' }],
                            [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
                        ]
                    }
                }
            );
            return;
        }
        
        // Display torrents
        const limitedTorrents = torrents.slice(0, 5);
        let torrentText = `🎬 *Torrents for:* ${title} (${year || 'N/A'})\n\n`;
        
        for (let i = 0; i < limitedTorrents.length; i++) {
            const t = limitedTorrents[i];
            torrentText += `*${i + 1}. ${t.name}*\n`;
            torrentText += `📦 Size: ${t.size || 'N/A'} | 👤 Seeds: ${t.seeds || 'N/A'}\n`;
            torrentText += `📡 Source: ${t.source || 'Unknown'}\n\n`;
        }
        
        const buttons = {
            reply_markup: {
                inline_keyboard: [
                    ...limitedTorrents.map((t, index) => [
                        { text: `⬇️ Magnet ${index + 1}`, url: t.magnet || '#' }
                    ]),
                    [
                        { text: '🔍 Search Again', callback_data: 'search_movie' },
                        { text: '🏠 Main Menu', callback_data: 'main_menu' }
                    ]
                ]
            },
            parse_mode: 'Markdown'
        };
        
        await bot.sendMessage(chatId, torrentText, buttons);
        
    } catch (error) {
        console.error('Torrent search error:', error.message);
        await bot.sendMessage(
            chatId, 
            '❌ Error searching for torrents. Please try again.',
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
                    ]
                }
            }
        );
    }
}

// ============ TRENDING & POPULAR ============
async function handleTrending(chatId, messageId) {
    try {
        const response = await axios.get('https://api.themoviedb.org/3/trending/movie/week', {
            params: { api_key: tmdbApiKey }
        });
        
        const movies = response.data.results.slice(0, 5);
        let text = '🔥 *Trending Movies This Week*\n\n';
        
        const buttons = {
            reply_markup: {
                inline_keyboard: []
            },
            parse_mode: 'Markdown'
        };
        
        movies.forEach((movie, index) => {
            const year = movie.release_date?.split('-')[0] || 'N/A';
            text += `${index + 1}. *${movie.title}* (${year})\n`;
            text += `   ${movie.overview?.slice(0, 80) || 'No description'}\n\n`;
            
            buttons.reply_markup.inline_keyboard.push([
                { text: `🎬 Get ${movie.title}`, callback_data: `torrent_${movie.id}_movie` }
            ]);
        });
        
        buttons.reply_markup.inline_keyboard.push([
            { text: '🔍 Search a Movie', callback_data: 'search_movie' },
            { text: '🏠 Main Menu', callback_data: 'main_menu' }
        ]);
        
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            ...buttons
        });
    } catch (error) {
        console.error('Trending error:', error.message);
        await bot.sendMessage(chatId, '❌ Error fetching trending movies.');
    }
}

async function handlePopular(chatId, messageId) {
    try {
        const response = await axios.get('https://api.themoviedb.org/3/movie/popular', {
            params: { api_key: tmdbApiKey }
        });
        
        const movies = response.data.results.slice(0, 5);
        let text = '⭐ *Popular Movies*\n\n';
        
        const buttons = {
            reply_markup: {
                inline_keyboard: []
            },
            parse_mode: 'Markdown'
        };
        
        movies.forEach((movie, index) => {
            const year = movie.release_date?.split('-')[0] || 'N/A';
            text += `${index + 1}. *${movie.title}* (${year})\n`;
            text += `   ${movie.overview?.slice(0, 80) || 'No description'}\n\n`;
            
            buttons.reply_markup.inline_keyboard.push([
                { text: `🎬 Get ${movie.title}`, callback_data: `torrent_${movie.id}_movie` }
            ]);
        });
        
        buttons.reply_markup.inline_keyboard.push([
            { text: '🔍 Search a Movie', callback_data: 'search_movie' },
            { text: '🏠 Main Menu', callback_data: 'main_menu' }
        ]);
        
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            ...buttons
        });
    } catch (error) {
        console.error('Popular error:', error.message);
        await bot.sendMessage(chatId, '❌ Error fetching popular movies.');
    }
}

// ============ HELP ============
async function showHelp(chatId, messageId) {
    const helpText = `🤖 *CineverseAI Bot Help*

*What I can do:*
🎬 *Search Movies* - Find any movie by name
📺 *Search TV Shows* - Find TV series by name
🔥 *Trending* - See what's trending this week
⭐ *Popular* - See most popular movies

*Torrent Sources:*
• 1337x
• ThePirateBay  
• YTS

*How to use:*
1. Use the buttons to navigate
2. Type the movie/TV show name when asked
3. Click on magnet links to download torrents

*Commands:*
/start - Show main menu
/help - Show this help message

*Note:* You need a torrent client (like qBittorrent) to download movies.`;

    await bot.editMessageText(helpText, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
            ]
        }
    });
}

// ============ ERROR HANDLING ============
bot.on('error', (error) => {
    console.error('Bot error:', error.message);
});

bot.on('polling_error', (error) => {
    console.error('Polling error:', error.message);
});

// ============ HEALTH CHECK SERVER ============
const app = express();
const port = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('CineverseAI Bot is running!');
});

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        bot: 'running'
    });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Health check server listening on port ${port}`);
});

// ============ STARTUP MESSAGE ============
console.log('🤖 CineverseAI Bot started successfully!');
console.log(`📌 Bot token: ${token ? '✅ Set (length: ' + token.length + ')' : '❌ Missing'}`);
console.log(`📌 TMDb API Key: ${tmdbApiKey ? '✅ Set' : '❌ Missing'}`);
console.log(`📌 Torrent Sources: 1337x, ThePirateBay, YTS`);

// ============ PROCESS HANDLING ============
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});

process.on('SIGINT', () => {
    console.log('🛑 Stopping bot...');
    process.exit(0);
});
