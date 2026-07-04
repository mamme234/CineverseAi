import express from "express";
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import fs from "fs";
import Stripe from "stripe";
import { GoogleGenerativeAI } from "@google/generative-ai";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// ================= OWNER CONFIGURATION =================
const OWNER = {
  name: "Muhammad Ilyas",
  username: "@KING_OF_ALPHA",
  telegram: "https://t.me/KING_OF_ALPHA",
  github: "https://github.com/mamme234",
  email: "ghazimuhammadilyas@gmail.com",
  bio: "👑 King of Alpha | Full-Stack Developer | AI Enthusiast | Creator of this Bot",
  skills: [
    "JavaScript", 
    "Python", 
    "AI/ML", 
    "Web Development", 
    "Bot Development",
    "Blockchain",
    "Cloud Computing"
  ],
  achievements: [
    "🏆 Built 50+ Bots",
    "🚀 10k+ Active Users",
    "💡 AI Innovator",
    "👑 Alpha Developer"
  ]
};

// ================= ADMIN CONFIGURATION =================
const ADMIN_IDS = [
  "123456789", // ⭐ Replace with your Telegram user ID
];

// ================= EMOJI & STYLE =================
const E = {
  premium: "💎",
  admin: "👑",
  free: "🆓",
  star: "⭐",
  sparkle: "✨",
  fire: "🔥",
  rocket: "🚀",
  brain: "🧠",
  magic: "🎯",
  gift: "🎁",
  crown: "👑",
  diamond: "💎",
  lightning: "⚡",
  robot: "🤖",
  heart: "❤️",
  ad: "📢",
  coin: "🪙",
  developer: "👨‍💻",
  code: "💻",
  link: "🔗",
  mail: "📧",
  trophy: "🏆",
  alpha: "🐺"
};

// ================= VALIDATE ENV =================
console.log("🔍 Checking environment variables...");
console.log("BOT_TOKEN:", process.env.BOT_TOKEN ? "✅ Set" : "❌ Missing");
console.log("GEMINI_API_KEY:", process.env.GEMINI_API_KEY ? "✅ Set" : "❌ Missing");
console.log("WEBHOOK_URL:", process.env.WEBHOOK_URL || "❌ Missing");

const requiredEnv = ['BOT_TOKEN', 'GEMINI_API_KEY', 'WEBHOOK_URL'];
for (const env of requiredEnv) {
  if (!process.env[env]) {
    console.error(`❌ Missing required environment variable: ${env}`);
    process.exit(1);
  }
}

// ================= INITIALIZE SERVICES =================
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ================= MODEL SELECTION =================
const TEST_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.0-flash", 
  "gemini-3.5-flash",
  "gemini-flash-latest"
];

let workingModel = null;
let model = null;
let modelInitialized = false;

async function findWorkingModel() {
  console.log("🔍 Searching for working model...");
  
  for (const modelName of TEST_MODELS) {
    try {
      console.log(`🔄 Testing: ${modelName}`);
      
      const testModel = genAI.getGenerativeModel({ 
        model: modelName,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 100,
        }
      });
      
      const result = await testModel.generateContent({
        contents: [{ role: "user", parts: [{ text: "Say hello" }] }]
      });
      
      const response = result.response.text();
      console.log(`✅ ${modelName} works! Response: "${response.substring(0, 30)}..."`);
      
      workingModel = modelName;
      model = testModel;
      modelInitialized = true;
      return true;
      
    } catch (error) {
      console.error(`❌ ${modelName} failed:`, error.message);
    }
  }
  
  console.error("❌ No working model found!");
  return false;
}

await findWorkingModel();

// ================= DB =================
const DB_FILE = "./db.json";

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, stats: { totalMessages: 0 } }, null, 2));
      return { users: {}, stats: { totalMessages: 0 } };
    }
    return JSON.parse(fs.readFileSync(DB_FILE));
  } catch (error) {
    console.error("❌ DB Error:", error);
    return { users: {}, stats: { totalMessages: 0 } };
  }
}

let db = loadDB();

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    console.error("❌ Save DB Error:", error);
  }
}

function getUser(id) {
  const userId = String(id);
  if (!db.users[userId]) {
    const isAdmin = ADMIN_IDS.includes(userId);
    db.users[userId] = {
      premium: isAdmin,
      isAdmin: isAdmin,
      requests: 0,
      totalMessages: 0,
      chatHistory: [],
      adsWatched: 0,
      coins: isAdmin ? 9999 : 0,
      joinedDate: new Date().toISOString()
    };
    db.stats.totalUsers = (db.stats.totalUsers || 0) + 1;
    saveDB();
  }
  return db.users[userId];
}

// ================= WEBHOOK =================
const WEBHOOK_PATH = `/webhook/${process.env.BOT_TOKEN}`;

async function setWebhook() {
  try {
    const baseUrl = process.env.WEBHOOK_URL.replace(/\/$/, '');
    const webhookUrl = `${baseUrl}${WEBHOOK_PATH}`;
    console.log(`🔄 Setting webhook to: ${webhookUrl}`);
    
    await bot.setWebHook('', { drop_pending_updates: true });
    const result = await bot.setWebHook(webhookUrl, {
      allowed_updates: ['message', 'callback_query']
    });
    
    console.log(result ? "✅ Webhook set!" : "❌ Webhook failed!");
  } catch (error) {
    console.error("❌ Webhook error:", error.message);
  }
}

app.post(WEBHOOK_PATH, async (req, res) => {
  try {
    await bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook processing error:", error);
    res.sendStatus(500);
  }
});

// ================= AD FUNCTIONS =================
async function showAd(chatId, userId) {
  try {
    const user = getUser(userId);
    
    await bot.sendMessage(
      chatId,
      `${E.ad} **WATCH AN AD TO EARN COINS** ${E.ad}\n\n` +
      `${E.coin} **Earn 10 coins per ad!**\n` +
      `🎯 Collect coins to unlock premium features!\n\n` +
      `Click the link below to watch an ad:\n` +
      `[Watch Ad](${process.env.WEBHOOK_URL}/watch-ad?user=${userId})`,
      { parse_mode: "Markdown" }
    );
    
    return true;
  } catch (error) {
    console.error("❌ Ad error:", error);
    return false;
  }
}

// ================= OWNER INFO =================
function getOwnerInfo() {
  return `${E.alpha} **ABOUT THE OWNER** ${E.alpha}\n\n` +
    `👤 **Name:** ${OWNER.name}\n` +
    `📝 **Username:** ${OWNER.username}\n` +
    `📋 **Bio:** ${OWNER.bio}\n\n` +
    `${E.code} **Skills:**\n` +
    `${OWNER.skills.map(s => `• ${s}`).join('\n')}\n\n` +
    `${E.trophy} **Achievements:**\n` +
    `${OWNER.achievements.map(a => `• ${a}`).join('\n')}\n\n` +
    `${E.link} **Connect with Me:**\n` +
    `• Telegram: ${OWNER.telegram}\n` +
    `• GitHub: ${OWNER.github}\n` +
    `• Email: ${OWNER.email}\n\n` +
    `${E.heart} *Built with passion for the community!* ${E.heart}`;
}

// ================= MESSAGE HANDLER =================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);

  if (!msg.text || msg.text.startsWith("/")) return;

  try {
    const user = getUser(userId);
    
    if (!modelInitialized) {
      await findWorkingModel();
      if (!modelInitialized) {
        throw new Error("Model not initialized");
      }
    }

    await bot.sendChatAction(chatId, "typing");

    const isPremium = user.premium || user.isAdmin;
    const maxFreeMessages = 5;

    if (!isPremium && user.requests >= maxFreeMessages) {
      await bot.sendMessage(
        chatId,
        `${E.fire} **FREE LIMIT REACHED** ${E.fire}\n\n` +
        `You've used ${user.requests} free messages.\n` +
        `${E.coin} **Watch an ad to get 5 extra messages!**\n\n` +
        `Options:\n` +
        `1️⃣ Watch ad - Get 5 free messages\n` +
        `2️⃣ Upgrade to Premium - Only $5\n\n` +
        `Type /ad to watch an ad\n` +
        `Type /buy to upgrade`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    user.chatHistory = user.chatHistory || [];
    user.chatHistory.push({ role: "user", text: msg.text });
    user.requests = (user.requests || 0) + 1;
    user.totalMessages = (user.totalMessages || 0) + 1;
    db.stats.totalMessages = (db.stats.totalMessages || 0) + 1;

    const maxHistory = isPremium ? 50 : 10;
    if (user.chatHistory.length > maxHistory) {
      user.chatHistory = user.chatHistory.slice(-maxHistory);
    }

    let context = "";
    for (const entry of user.chatHistory) {
      context += `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.text}\n`;
    }

    const result = await model.generateContent({
      contents: [
        {
          role: "user",
          parts: [{ 
            text: `You are a helpful AI assistant. Be engaging and use emojis.\nConversation:\n${context}\nAssistant: Respond helpfully.` 
          }]
        }
      ],
      generationConfig: {
        maxOutputTokens: isPremium ? 8192 : 2048,
        temperature: 0.7,
      }
    });

    const answer = result.response.text();

    user.chatHistory.push({ role: "assistant", text: answer });
    saveDB();

    await bot.sendMessage(chatId, answer);

    if (!isPremium && user.requests % 3 === 0) {
      setTimeout(() => {
        showAd(chatId, userId);
      }, 2000);
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
    await bot.sendMessage(
      chatId,
      `${E.sparkle} ⚠️ Error: ${error.message}\n\nPlease try again. ${E.sparkle}`
    );
  }
});

// ================= COMMANDS =================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  const isPremium = user.premium || user.isAdmin;
  const status = isPremium ? `${E.premium} Premium` : `${E.free} Free`;
  const adminBadge = user.isAdmin ? ` ${E.crown} Admin` : '';
  
  await bot.sendMessage(
    chatId,
    `${E.robot} **WELCOME TO ULTIMATE AI BOT** ${E.robot}\n\n` +
    `👤 **Status:** ${status}${adminBadge}\n` +
    `📊 **Messages:** ${user.requests || 0}/∞\n` +
    `${E.coin} **Coins:** ${user.coins || 0}\n` +
    `📺 **Ads Watched:** ${user.adsWatched || 0}\n\n` +
    `**Commands:**\n` +
    `/ad - ${E.ad} Watch ad for free messages\n` +
    `/buy - ${E.diamond} Upgrade to Premium ($5)\n` +
    `/owner - ${E.developer} About the Owner\n` +
    `/status - ${E.star} Your stats\n` +
    `/reset - ${E.magic} Reset conversation\n` +
    `/help - ${E.heart} All commands\n\n` +
    `${E.fire} *Send any message to chat!* ${E.fire}`,
    { parse_mode: "Markdown" }
  );
});

// ================= OWNER COMMAND =================
bot.onText(/\/owner/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    getOwnerInfo(),
    { parse_mode: "Markdown", disable_web_page_preview: true }
  );
});

bot.onText(/\/ad/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  await showAd(chatId, userId);
});

bot.onText(/\/buy/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  if (user.isAdmin) {
    await bot.sendMessage(
      chatId,
      `${E.crown} **ADMIN ACCESS** ${E.crown}\n\nYou already have unlimited access!`
    );
    return;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "AI Bot Premium Access",
              description: "Unlimited AI chat access"
            },
            unit_amount: 500,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.WEBHOOK_URL}/success?user=${userId}`,
      cancel_url: `${process.env.WEBHOOK_URL}/cancel`,
      metadata: { userId: String(userId) }
    });

    await bot.sendMessage(
      chatId, 
      `${E.diamond} **UNLOCK PREMIUM** ${E.diamond}\n\n` +
      `💳 Pay here: ${session.url}\n\n` +
      `🔒 Only $5!\n\n` +
      `**Benefits:**\n` +
      `• ${E.lightning} Unlimited messages\n` +
      `• ${E.rocket} 8192 token responses\n` +
      `• ${E.brain} Advanced AI\n` +
      `• ${E.crown} Priority support`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("❌ Stripe error:", error);
    await bot.sendMessage(chatId, "⚠️ Payment system unavailable. Try again later.");
  }
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const user = getUser(userId);
  
  const isPremium = user.premium || user.isAdmin;
  const days = Math.floor((Date.now() - new Date(user.joinedDate).getTime()) / (1000 * 60 * 60 * 24));
  
  await bot.sendMessage(
    chatId,
    `${E.star} **YOUR STATS** ${E.star}\n\n` +
    `👤 **User:** ${userId}\n` +
    `${user.isAdmin ? E.crown : ''} **Plan:** ${isPremium ? '💎 Premium' : '🆓 Free'}\n` +
    `📊 **Messages:** ${user.requests || 0}\n` +
    `${E.coin} **Coins:** ${user.coins || 0}\n` +
    `📺 **Ads:** ${user.adsWatched || 0}\n` +
    `📅 **Days Active:** ${days}\n` +
    `🤖 **Model:** ${workingModel || 'N/A'}\n\n` +
    `${isPremium ? `${E.fire} Enjoy unlimited access! ${E.fire}` : `${E.coin} Watch ads with /ad!`}`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  
  const user = getUser(userId);
  user.chatHistory = [];
  saveDB();
  
  await bot.sendMessage(
    chatId,
    `${E.magic} **RESET COMPLETE** ${E.magic}\n\nFresh start! Send any message.`
  );
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  
  await bot.sendMessage(
    chatId,
    `${E.heart} **COMMANDS** ${E.heart}\n\n` +
    `**Core:**\n` +
    `/start - Welcome\n` +
    `/help - This menu\n` +
    `/status - Your stats\n` +
    `/reset - Clear history\n` +
    `/owner - ${E.developer} About the Owner\n\n` +
    `**Earn & Upgrade:**\n` +
    `/ad - ${E.ad} Watch ad for free messages\n` +
    `/buy - ${E.diamond} Get Premium ($5)\n\n` +
    `${E.fire} *Send any message to chat!*`,
    { parse_mode: "Markdown" }
  );
});

// ================= PAYMENT SUCCESS =================
app.get("/success", async (req, res) => {
  const userId = req.query.user;
  const sessionId = req.query.session_id;

  if (userId && sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.payment_status === 'paid') {
        const user = getUser(userId);
        user.premium = true;
        saveDB();
        
        await bot.sendMessage(
          userId, 
          `${E.diamond} **PREMIUM UNLOCKED!** ${E.diamond}\n\n` +
          `🎉 You now have unlimited access!\n` +
          `${E.rocket} Enjoy the full power of AI!`,
          { parse_mode: "Markdown" }
        );
      }
    } catch (error) {
      console.error("❌ Success error:", error);
    }
  }

  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Premium Unlocked</title>
      <style>
        body { 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
          color: white; 
          text-align: center; 
          padding: 50px; 
          font-family: Arial, sans-serif;
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .card {
          background: rgba(255,255,255,0.1);
          backdrop-filter: blur(10px);
          padding: 40px;
          border-radius: 20px;
          max-width: 400px;
        }
        .emoji { font-size: 80px; }
        h1 { font-size: 2em; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="emoji">💎</div>
        <h1>Premium Unlocked!</h1>
        <p>Welcome to the Elite Club!</p>
        <p style="font-size: 0.9em; opacity: 0.8;">Close this window and return to Telegram</p>
      </div>
    </body>
    </html>
  `);
});

app.get("/cancel", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Cancelled</title>
      <style>
        body { 
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); 
          color: white; 
          text-align: center; 
          padding: 50px; 
          font-family: Arial, sans-serif;
          min-height: 100vh;
          display: flex;
          justify-content: center;
          align-items: center;
        }
        .card {
          background: rgba(255,255,255,0.1);
          backdrop-filter: blur(10px);
          padding: 40px;
          border-radius: 20px;
          max-width: 400px;
        }
        .emoji { font-size: 80px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="emoji">😅</div>
        <h1>Cancelled</h1>
        <p>You can try again anytime with /buy</p>
      </div>
    </body>
    </html>
  `);
});

// ================= WEB INTERFACE =================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ================= API ENDPOINTS =================
app.get("/api/status", (req, res) => {
  res.json({
    status: "✅ Online",
    model: workingModel,
    modelReady: modelInitialized,
    users: Object.keys(db.users).length,
    totalMessages: db.stats.totalMessages || 0,
    uptime: process.uptime()
  });
});

app.get("/api/user/:id", (req, res) => {
  const user = getUser(req.params.id);
  res.json({
    premium: user.premium,
    isAdmin: user.isAdmin,
    requests: user.requests,
    totalMessages: user.totalMessages,
    coins: user.coins || 0,
    adsWatched: user.adsWatched || 0
  });
});

app.get("/api/owner", (req, res) => {
  res.json({
    name: OWNER.name,
    username: OWNER.username,
    bio: OWNER.bio,
    skills: OWNER.skills,
    achievements: OWNER.achievements,
    telegram: OWNER.telegram,
    github: OWNER.github,
    email: OWNER.email
  });
});

// ================= TEST ENDPOINTS =================
app.get("/test", async (req, res) => {
  try {
    if (!modelInitialized) {
      await findWorkingModel();
    }
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Say hello" }] }]
    });
    
    res.json({
      success: true,
      model: workingModel,
      response: result.response.text()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get("/debug", (req, res) => {
  res.json({
    model: workingModel,
    modelReady: modelInitialized,
    env: {
      bot_token: process.env.BOT_TOKEN ? "✅" : "❌",
      gemini_key: process.env.GEMINI_API_KEY ? "✅" : "❌",
      webhook_url: process.env.WEBHOOK_URL || "❌"
    },
    db_users: Object.keys(db.users).length,
    total_messages: db.stats.totalMessages || 0
  });
});

// ================= START SERVER =================
app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🤖 Working Model: ${workingModel || '❌ Not found'}`);
  console.log(`📊 Model Ready: ${modelInitialized}`);
  console.log(`👥 Users: ${Object.keys(db.users).length}`);
  console.log(`👑 Owner: ${OWNER.name} (@${OWNER.username})`);
  
  await setWebhook();
  
  console.log(`✅ Bot ready!`);
  console.log(`📋 Web: ${process.env.WEBHOOK_URL}/`);
  console.log(`📋 Test: ${process.env.WEBHOOK_URL}/test`);
  console.log(`📋 Debug: ${process.env.WEBHOOK_URL}/debug`);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});
