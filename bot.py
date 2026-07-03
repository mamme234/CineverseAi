import asyncio
import logging
import time
from aiogram import Bot, Dispatcher, types
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from config import BOT_TOKEN, ADMIN_IDS, STORAGE_CHANNEL_ID
from database import Database
from scraper import MovieScraper
from tmdbv3api import TMDb, Search, Movie

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize
bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()
db = Database()
tmdb = TMDb()
tmdb.api_key = "YOUR_TMDB_API_KEY"  # Or use from config
search = Search()
movie_api = Movie()
scraper = MovieScraper()

# --- COMMAND HANDLERS ---

@dp.message(Command("start"))
async def start_cmd(message: types.Message):
    await message.reply(
        "🎬 *Movie Download Bot*\n\n"
        "Send me a movie name to search.\n"
        "Use: `/search Inception` or just type the name.\n\n"
        "👑 *Admins:* Use `/upload` to add movies.",
        parse_mode="Markdown"
    )

@dp.message(Command("search"))
async def search_cmd(message: types.Message):
    query = message.text.replace("/search", "").strip()
    if not query:
        await message.reply("Please provide a movie name. Example: `/search Inception`")
        return
    
    await handle_search(message, query)

@dp.message(Command("upload"))
async def upload_cmd(message: types.Message):
    """Admin-only: Upload a movie to storage channel"""
    if message.from_user.id not in ADMIN_IDS:
        await message.reply("⛔ Admin only.")
        return
    
    args = message.text.replace("/upload", "").strip().split("|")
    if len(args) < 3:
        await message.reply(
            "Usage: `/upload Movie Title | 2024 | file_id`\n"
            "Forward a movie file to @ChannelBot to get its file_id."
        )
        return
    
    title, year, file_id = args[0].strip(), int(args[1].strip()), args[2].strip()
    
    # Get TMDb info
    results = search.movies(title)
    if results:
        tmdb_id = results[0].id
        title = results[0].title
        year = results[0].release_date[:4] if results[0].release_date else year
    else:
        tmdb_id = None
    
    db.add_movie(title, year, tmdb_id, file_id, "720p", 0, message.from_user.id)
    await message.reply(f"✅ Added: *{title} ({year})*", parse_mode="Markdown")

@dp.message()
async def auto_search(message: types.Message):
    """Auto-search when user sends any text"""
    await handle_search(message, message.text)

# --- CORE SEARCH LOGIC ---

async def handle_search(message: types.Message, query: str):
    # 1. Check cache
    cached = db.search_movie(query)
    if cached:
        await send_cached_movie(message, cached)
        return
    
    # 2. Not in cache - try to scrape
    await message.reply("🔍 Searching online sources... (this may take 20-30s)")
    
    result = scraper.get_download_link(query)
    if not result:
        await message.reply("❌ No sources found. Try a different title.")
        return
    
    # 3. Send magnet link (or auto-download if you have the file)
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton("🧲 Magnet Link", url=result['magnet'])],
        [InlineKeyboardButton("📥 Download Torrent", callback_data=f"torrent_{query}")]
    ])
    
    await message.reply(
        f"🎬 *{result['title']}*\n"
        f"Quality: `{result['quality']}`\n"
        f"Source: YTS\n\n"
        "⚠️ *Use a VPN and antivirus software.*",
        reply_markup=keyboard,
        parse_mode="Markdown"
    )
    
    # 4. Admin option: Save to cache for future users
    if message.from_user.id in ADMIN_IDS:
        await message.reply(
            "💡 *Admin:* To cache this movie, upload the file to the storage channel, "
            "get its file_id, and use:\n"
            f"`/upload {result['title']} | 2024 | file_id_here`"
        )

async def send_cached_movie(message: types.Message, movies):
    """Send cached movie from Telegram storage"""
    for movie in movies[:3]:  # Limit to 3 results
        try:
            await bot.copy_message(
                chat_id=message.chat.id,
                from_chat_id=STORAGE_CHANNEL_ID,
                message_id=int(movie['file_id'])  # Note: This needs adjustment
            )
            await message.reply(
                f"✅ *{movie['title']} ({movie['year']})*\n"
                f"Quality: `{movie['quality']}`",
                parse_mode="Markdown"
            )
        except Exception as e:
            logger.error(f"Failed to send cached movie: {e}")
            await message.reply("❌ This file is no longer available on Telegram.")

# --- CALLBACK HANDLERS ---

@dp.callback_query()
async def handle_callback(callback: types.CallbackQuery):
    if callback.data.startswith("torrent_"):
        await callback.answer("Magnet link sent above. Use a torrent client.")
    await callback.answer()

# --- MAIN ---

async def main():
    logger.info("Starting Movie Bot...")
    try:
        await dp.start_polling(bot)
    finally:
        db.close()

if __name__ == "__main__":
    asyncio.run(main())
