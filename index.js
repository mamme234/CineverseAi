// index.js
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const { torrentProviders } = require('./config');

const token = process.env.TELEGRAM_BOT_TOKEN;
const tmdbApiKey = process.env.TMDB_API_KEY;
const bot = new TelegramBot(token, { polling: true });

// Main menu with buttons
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    
    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🎬 Search Movies', callback_data: 'search_movie' },
                    { text: '📺 Search TV Shows', callback_data: 'search_tv' }
                ],
                [
                    { text: '🔥 Trending', callback_data: 'trending' },
                    { text: '🎯 Popular', callback_data: 'popular' }
                ],
                [
                    { text: '❓ Help', callback_data: 'help' }
                ]
            ]
        }
    };
    
    bot.sendMessage(chatId, '🎥 *Welcome to CineverseAI Bot!*\n\nChoose an option below:', {
        ...options,
        parse_mode: 'Markdown'
    });
});

// Handle button clicks
bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    
    // Acknowledge the callback
    await bot.answerCallbackQuery(callbackQuery.id);
    
    switch(action) {
        case 'search_movie':
        case 'search_tv':
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
            // Set user state to wait for search input
            userStates[chatId] = { action: 'waiting_for_search', type: action };
            break;
            
        case 'trending':
            await handleTrending(chatId, messageId);
            break;
            
        case 'popular':
            await handlePopular(chatId, messageId);
            break;
            
        case 'main_menu':
            await showMainMenu(chatId, messageId);
            break;
            
        case 'help':
            await showHelp(chatId, messageId);
            break;
    }
});

// Handle text input for search
const userStates = {};
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Skip commands and callback queries
    if (text.startsWith('/') || !userStates[chatId]) return;
    
    const state = userStates[chatId];
    if (state.action === 'waiting_for_search') {
        await performSearch(chatId, text, state.type);
        delete userStates[chatId];
    }
});

// Search function with buttons for results
async function performSearch(chatId, query, type) {
    try {
        // Search TMDb
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
        
        if (response.data.results.length === 0) {
            await bot.sendMessage(chatId, '❌ No results found. Try another search.');
            return;
        }
        
        const results = response.data.results.slice(0, 5);
        
        for (const item of results) {
            const title = type === 'search_movie' ? item.title : item.name;
            const year = type === 'search_movie' ? 
                item.release_date?.split('-')[0] : 
                item.first_air_date?.split('-')[0];
            const overview = item.overview?.slice(0, 200) + '...';
            
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
                }
            };
            
            const caption = `🎥 *${title}* (${year || 'N/A'})\n\n📝 ${overview || 'No description available.'}`;
            
            // Send with poster if available
            if (item.poster_path) {
                const posterUrl = `https://image.tmdb.org/t/p/w500${item.poster_path}`;
                await bot.sendPhoto(chatId, posterUrl, {
                    caption: caption,
                    parse_mode: 'Markdown',
                    ...buttons
                });
            } else {
                await bot.sendMessage(chatId, caption, {
                    parse_mode: 'Markdown',
                    ...buttons
                });
            }
        }
        
    } catch (error) {
        console.error('Search error:', error);
        await bot.sendMessage(chatId, '❌ Error performing search. Please try again.');
    }
}

// Get torrents with buttons
bot.on('callback_query', async (callbackQuery) => {
    const data = callbackQuery.data;
    const chatId = callbackQuery.message.chat.id;
    
    if (data.startsWith('torrent_')) {
        await bot.answerCallbackQuery(callbackQuery.id);
        const [, id, type] = data.split('_');
        
        await bot.sendMessage(chatId, '🔍 *Searching for torrents...*', {
            parse_mode: 'Markdown'
        });
        
        // Search for torrents
        const torrents = await searchTorrents(id, type);
        
        if (torrents.length === 0) {
            await bot.sendMessage(chatId, '❌ No torrents found. Try another source.');
            return;
        }
        
        // Display torrents with download buttons
        for (const torrent of torrents.slice(0, 3)) {
            const buttons = {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '⬇️ Download Magnet', url: torrent.magnet || '' },
                            { text: '🔗 Torrent File', url: torrent.url || '' }
                        ],
                        [
                            { text: '🔍 More Results', callback_data: `more_torrents_${id}_${type}` }
                        ]
                    ]
                }
            };
            
            const info = `🧲 *${torrent.name}*\n📦 Size: ${torrent.size || 'N/A'}\n👤 Seeds: ${torrent.seeds || 'N/A'}`;
            await bot.sendMessage(chatId, info, {
                parse_mode: 'Markdown',
                ...buttons
            });
        }
    }
});

// Helper functions
async function showMainMenu(chatId, messageId) {
    const options = {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🎬 Search Movies', callback_data: 'search_movie' },
                    { text: '📺 Search TV Shows', callback_data: 'search_tv' }
                ],
                [
                    { text: '🔥 Trending', callback_data: 'trending' },
                    { text: '🎯 Popular', callback_data: 'popular' }
                ],
                [
                    { text: '❓ Help', callback_data: 'help' }
                ]
            ]
        }
    };
    
    await bot.editMessageText(
        '🎥 *Welcome to CineverseAI Bot!*\n\nChoose an option below:',
        {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            ...options
        }
    );
}

// Health check endpoint
const express = require('express');
const app = express();
const port = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('CineverseAI Bot is running!');
});

app.listen(port, () => {
    console.log(`✅ Health check server listening on port ${port}`);
});

// Keep the process alive
process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
});

console.log('🤖 CineverseAI Bot started successfully!');
