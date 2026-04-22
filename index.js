import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActivityType,
} from "discord.js";
import OpenAI from "openai";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const NODE_ENV = process.env.NODE_ENV || "production";

if (!DISCORD_TOKEN || !OPENAI_API_KEY) {
  console.error("Fehlende ENV: DISCORD_TOKEN oder OPENAI_API_KEY");
  console.error("Gefunden:", {
    DISCORD_TOKEN: !!DISCORD_TOKEN,
    OPENAI_API_KEY: !!OPENAI_API_KEY,
    NODE_ENV,
  });
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

let SETTINGS = {
  bot_name: "Aura.KI",
  presence_status: "online",
  activity_text: null,
  require_mention: false,
  trigger_words: ["aura"],
  cooldown_seconds: 0,
  history_depth: 20,
  max_images: 8,
};

let CHANNEL_RULES = [];

const CHANNEL_HINT_ALIASES = {
  information: ["information", "informationen", "info", "infos"],
};

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot online als ${c.user.tag}`);
  applyPresence();

  setInterval(() => {
    applyPresence();
  }, 10_000);
});

function applyPresence() {
  try {
    const status = SETTINGS.presence_status || "online";
    const activityText = SETTINGS.activity_text || null;

    client.user?.setPresence({
      status,
      activities: activityText
        ? [{ name: activityText, type: ActivityType.Custom, state: activityText }]
        : [],
    });
  } catch (e) {
    console.warn("presence err", e?.message);
  }
}

function isAllowed(channelId, channelName) {
  if (!CHANNEL_RULES.length) return true;

  const rule = CHANNEL_RULES.find(
    (r) => r.channel_id === channelId || r.channel_name === channelName
  );

  if (!rule) return true;
  return rule.mode !== "blocked";
}

function shouldRespond(message) {
  if (message.author.bot) return false;
  if (!message.content) return false;

  const mentioned = message.mentions.has(client.user);
  const content = message.content.trim();
  const lower = content.toLowerCase();

  let triggered = false;
  let cleaned = content;

  for (const w of SETTINGS.trigger_words || []) {
    const tw = String(w).toLowerCase();
    if (lower.startsWith(`!${tw}`)) {
      triggered = true;
      cleaned = content.slice(tw.length + 1).trim();
      break;
    }
  }

  if (SETTINGS.require_mention) {
    if (!mentioned) return false;
  } else {
    if (!mentioned && !triggered) return false;
  }

  if (mentioned) {
    cleaned = cleaned.replace(/<@!?\d+>/g, "").trim();
  }

  return cleaned;
}

function startTyping(channel) {
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    channel.sendTyping().catch(() => {});
  };

  tick();
  const iv = setInterval(tick, 7000);

  return () => {
    stopped = true;
    clearInterval(iv);
  };
}

async function fetchRecent(channel, limit = 20, includeBots = true) {
  try {
    const msgs = await channel.messages.fetch({
      limit: Math.min(50, Math.max(1, limit)),
    });

    const arr = [...msgs.values()].reverse();

    return arr
      .filter((m) => includeBots || !m.author.bot)
      .map((m) => ({
        author: m.author.username,
        author_id: m.author.id,
        is_bot: m.author.bot,
        content: m.content || "",
        created_at: m.createdAt.toISOString(),
        images: [...m.attachments.values()]
          .filter(
            (a) =>
              a.contentType?.startsWith("image/") ||
              /\.(png|jpe?g|webp|gif)$/i.test(a.url)
          )
          .map((a) => a.url),
      }));
  } catch (e) {
    console.warn("fetchRecent err", e?.message);
    return [];
  }
}

function expandHints(hints = []) {
  const expanded = new Set();

  for (const rawHint of hints) {
    const hint = String(rawHint || "").toLowerCase().trim();
    if (!hint) continue;

    expanded.add(hint);

    if (CHANNEL_HINT_ALIASES[hint]) {
      for (const alias of CHANNEL_HINT_ALIASES[hint]) {
        expanded.add(alias.toLowerCase());
      }
    }

    for (const [key, aliases] of Object.entries(CHANNEL_HINT_ALIASES)) {
      if (aliases.includes(hint)) {
        expanded.add(key.toLowerCase());
        for (const alias of aliases) {
          expanded.add(alias.toLowerCase());
        }
      }
    }
  }

  return [...expanded];
}

async function findChannelsByHints(guild, hints) {
  if (!guild) return [];

  const all = [...guild.channels.cache.values()].filter((c) => c.isTextBased?.());
  if (!hints || !hints.length || hints.includes("*")) return all;

  const lower = expandHints(hints);

  return all.filter((c) => {
    const channelName = c.name?.toLowerCase() || "";
    return lower.some((h) => channelName.includes(h));
  });
}

async function summarizeMessages(question, recentMessages, channelName) {
  const contextLines = recentMessages.slice(-20).map((m) => {
    const img = m.images?.length ? ` [${m.images.length} Bild(er)]` : "";
    return `- ${m.author}: ${m.content || "(kein Text)"}${img}`;
  });

  const prompt = [
    `Du bist ein hilfreicher Discord-Assistent.`,
    `Antworte kurz, konkret und passend zur Frage.`,
    `Wenn der User nach einem Channel fragt, nutze die Nachrichten im Channel-Kontext.`,
    `Wenn die Frage nach dem Channel "Information" geht, beachte, dass auch "information", "informationen", "info" und "infos" derselbe Zielkanal sein können.`,
    ``,
    `Frage: ${question}`,
    `Aktueller Channel: ${channelName}`,
    ``,
    `Letzte Nachrichten:`,
    ...contextLines,
  ].join("\n");

  const result = await openai.chat.completions.create({
    model: "gpt-5-mini",
    messages: [
      { role: "system", content: "Du bist ein präziser Discord-Assistent." },
      { role: "user", content: prompt },
    ],
    temperature: 0.4,
  });

  return result?.choices?.[0]?.message?.content?.trim() || "Hmm, dazu habe ich gerade keine passende Antwort.";
}

const userQueues = new Map();

function enqueueForUser(userId, task) {
  const prev = userQueues.get(userId) || Promise.resolve();
  const next = prev.then(task, task);

  userQueues.set(userId, next);

  next.finally(() => {
    if (userQueues.get(userId) === next) {
      userQueues.delete(userId);
    }
  });

  return next;
}

async function processQuestion(message, cleanQuestion) {
  let stopTyping = () => {};

  try {
    const channel = message.channel;
    const guild = message.guild;

    if (!isAllowed(channel.id, channel.name)) {
      await message.reply("Hier antworte ich gerade nicht. Schreib mich gern in einem anderen Channel an. 🙂");
      return;
    }

    stopTyping = startTyping(channel);

    const recentMessages = await fetchRecent(channel, SETTINGS.history_depth || 20, true);

    const directImages = [];
    for (const a of message.attachments.values()) {
      if (
        a.contentType?.startsWith("image/") ||
        /\.(png|jpe?g|webp|gif)$/i.test(a.url)
      ) {
        directImages.push(a.url);
      }
    }

    let answer = await summarizeMessages(cleanQuestion, recentMessages, channel.name);

    const safe = answer.length > 1990 ? answer.slice(0, 1987) + "..." : answer;
    await message.reply(safe);
  } catch (err) {
    console.error("Fehler bei Nachricht:", err);
    try {
      await message.reply("⚠️ Ups, da ist was schiefgelaufen. Probier's gleich nochmal.");
    } catch {}
  } finally {
    stopTyping();
  }
}

client.on(Events.MessageCreate, async (message) => {
  const cleanQuestion = shouldRespond(message);
  if (cleanQuestion === false) return;

  enqueueForUser(message.author.id, () => processQuestion(message, cleanQuestion));
});

client.on(Events.Error, (err) => console.error("Discord client error:", err));
client.login(DISCORD_TOKEN);
