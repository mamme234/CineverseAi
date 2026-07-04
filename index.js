const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const express = require('express');

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
            
        default:
            if (action && action.startsWith('torrent_')) {
                await handleTorrentSearch(chatId, action);
            }
            break;
    }
});

// ============ TEXT MESSAGE HANDLER ============
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Skip commands and empty messages
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
                            { text: '🎬 Get Torrents', callback_data: `torrent_${item.id}_${type}` },
                            { text: '📋 Details', callback_data: `details_${item.id}_${type}` }
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

// ============ TRENDING & POPULAR ============
async function handleTrending(chatId, messageId) {
    try {
        const response = await axios.get('https://api.themoviedb.org/3/trending/movie/week', {
            params: { api_key: tmdbApiKey }
        });
        
        const movies = response.data.results.slice(0, 5);
        let text = '🔥 *Trending Movies This Week*\n\n';
        
        movies.forEach((movie, index) => {
            const year = movie.release_date?.split('-')[0] || 'N/A';
            text += `${index + 1}. *${movie.title}* (${year})\n`;
            if (movie.overview) {
                text += `   ${movie.overview.slice(0, 80)}...\n\n`;
            }
        });
        
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔍 Search a Movie', callback_data: 'search_movie' }],
                    [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
                ]
            }
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
        
        movies.forEach((movie, index) => {
            const year = movie.release_date?.split('-')[0] || 'N/A';
            text += `${index + 1}. *${movie.title}* (${year})\n`;
            if (movie.overview) {
                text += `   ${movie.overview.slice(0, 80)}...\n\n`;
            }
        });
        
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '🔍 Search a Movie', callback_data: 'search_movie' }],
                    [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
                ]
            }
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

*How to use:*
1. Use the buttons to navigate
2. Type the movie/TV show name when asked
3. Click on torrent buttons to get download links

*Commands:*
/start - Show main menu
/help - Show this help message

*Note:* You need to have a torrent client to download movies.`;

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

// ============ TORRENT HANDLER ============
async function handleTorrentSearch(chatId, data) {
    const [, id, type] = data.split('_');
    
    await bot.sendMessage(chatId, '🔍 *Searching for torrents...*\n\n⚠️ Torrent search feature is being developed.', {
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
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(port, '0.0.0.0', () => {
    console.log(`✅ Health check server listening on port ${port}`);
});

// ============ STARTUP MESSAGE ============
console.log('🤖 CineverseAI Bot started successfully!');
console.log(`📌 Bot token: ${token ? '✅ Set (length: ' + token.length + ')' : '❌ Missing'}`);
console.log(`📌 TMDb API Key: ${tmdbApiKey ? '✅ Set' : '❌ Missing'}`);
console.log(`📌 Health check: http://localhost:${port}/health`);

// ============ PROCESS HANDLING ============
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});

process.on('SIGINT', () => {
    console.log('🛑 Stopping bot...');
    process.exit(0);
});
