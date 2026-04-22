import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  ActivityType,
} from "discord.js";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const BOT_SHARED_SECRET = process.env.BOT_SHARED_SECRET || "";

if (!DISCORD_TOKEN || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Fehlende ENV: DISCORD_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY");
  console.error("Gefunden:", {
    DISCORD_TOKEN: !!DISCORD_TOKEN,
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_ANON_KEY: !!SUPABASE_ANON_KEY,
  });
  process.exit(1);
}

const EDGE_AI = `${SUPABASE_URL}/functions/v1/discord-ai`;
const EDGE_CONFIG = `${SUPABASE_URL}/functions/v1/bot-config`;

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

async function loadConfig() {
  try {
    const r = await fetch(EDGE_CONFIG, {
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        ...(BOT_SHARED_SECRET ? { "x-bot-secret": BOT_SHARED_SECRET } : {}),
      },
    });
    if (!r.ok) {
      console.warn("bot-config http", r.status);
      return;
    }
    const data = await r.json();
    if (data?.settings) SETTINGS = { ...SETTINGS, ...data.settings };
    if (Array.isArray(data?.channel_rules)) CHANNEL_RULES = data.channel_rules;
  } catch (e) {
    console.warn("loadConfig error", e?.message);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot online als ${c.user.tag}`);
  await loadConfig();
  applyPresence();
  setInterval(async () => {
    await loadConfig();
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
  } else if (!mentioned && !triggered) {
    return false;
  }

  if (mentioned) cleaned = cleaned.replace(/<@!?\d+>/g, "").trim();
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
    const msgs = await channel.messages.fetch({ limit: Math.min(50, Math.max(1, limit)) });
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
          .filter((a) => a.contentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a.url))
          .map((a) => a.url),
      }));
  } catch (e) {
    console.warn("fetchRecent err", e?.message);
    return [];
  }
}

function normalizeChannelName(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const CHANNEL_ALIASES = {
  "regelwerk": ["regelwerk"],
  "neu-dazugekommen": ["neu-dazugekommen", "neudazugekommen", "neu dazugekommen"],
  "richtlinien-faq": ["richtlinien-faq", "richtlinienfaq", "richtlinien faq"],
  "agentur-faq": ["agentur-faq", "agenturfaq", "agentur faq"],
  "updates": ["updates", "update"],
  "information": ["information", "informationen", "info", "infos"],
  "umfragen": ["umfragen", "umfrage"],
  "tipps-und-tricks": ["tipps-und-tricks", "tippsundtricks", "tipps und tricks", "tipps", "tricks"],
  "live-manager": ["live-manager", "livemanager", "live manager"],
  "agentur-info": ["agentur-info", "agenturinfo", "agentur info"],
};

function detectTargetChannel(userText) {
  const raw = String(userText || "").toLowerCase();
  const compact = normalizeChannelName(userText);

  for (const [target, aliases] of Object.entries(CHANNEL_ALIASES)) {
    for (const alias of aliases) {
      const aliasRaw = String(alias).toLowerCase();
      const aliasCompact = normalizeChannelName(alias);
      if (raw.includes(aliasRaw) || compact.includes(aliasCompact)) return target;
    }
  }

  return null;
}

function buildExactChannelInstruction(targetChannel) {
  if (!targetChannel) return "";
  return [
    "",
    "EXAKTE CHANNEL-FRAGE:",
    `Der User meint genau den Discord-Channel "${targetChannel}".`,
    "WICHTIGE REGELN:",
    `- Beantworte nur den Channel "${targetChannel}".`,
    "- Weiche niemals auf ähnliche Channels aus.",
    "- Rate nicht, ob vielleicht ein anderer Channel gemeint sein könnte.",
    "- Stelle keine Rückfrage wie 'Meinst du vielleicht einen anderen Channel?'.",
    `- Wenn "${targetChannel}" gemeint ist, dann ist exakt dieser Channel gemeint.`,
    `- Wenn zu "${targetChannel}" kein Kontext gefunden wird, sag klar, dass genau für diesen Channel kein Kontext gefunden wurde.`,
    "- Keine Alternativen, keine Vermutungen, keine Umdeutung."
  ].join("\n");
}

async function findChannelsByHints(guild, hints) {
  if (!guild) return [];
  const all = [...guild.channels.cache.values()].filter((c) => c.isTextBased?.());
  if (!hints || !hints.length || hints.includes("*")) return all;
  const rawHints = hints.map((h) => String(h).toLowerCase().trim());
  const normalizedHints = hints.map((h) => normalizeChannelName(h));
  return all.filter((c) => {
    const rawName = String(c.name || "").toLowerCase();
    const normalizedName = normalizeChannelName(c.name);
    return rawHints.some((h) => rawName === h) || normalizedHints.some((h) => normalizedName === h);
  });
}

async function callEdgeAi(payload) {
  const r = await fetch(EDGE_AI, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
      ...(BOT_SHARED_SECRET ? { "x-bot-secret": BOT_SHARED_SECRET } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`edge-ai http ${r.status} ${t.slice(0, 300)}`);
  }
  return r.json();
}

const userQueues = new Map();
function enqueueForUser(userId, task) {
  const prev = userQueues.get(userId) || Promise.resolve();
  const next = prev.then(task, task);
  userQueues.set(userId, next);
  next.finally(() => {
    if (userQueues.get(userId) === next) userQueues.delete(userId);
  });
  return next;
}

async function processQuestion(message, cleanQuestion) {
  let stopTyping = () => {};
  try {
    const channel = message.channel;
    const guild = message.guild;

    if (!isAllowed(channel.id, channel.name)) {
      await message.reply("Hier antworte ich gerade nicht. Schreib mich gern in einem anderen Channel an.");
      return;
    }

    stopTyping = startTyping(channel);

    const recentMessages = await fetchRecent(channel, SETTINGS.history_depth || 20, true);

    const directImages = [];
    for (const a of message.attachments.values()) {
      if (a.contentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(a.url)) {
        directImages.push(a.url);
      }
    }

    const targetChannel = detectTargetChannel(cleanQuestion);
    const exactChannelInstruction = buildExactChannelInstruction(targetChannel);

    const finalQuestion = exactChannelInstruction
      ? `${cleanQuestion}\n${exactChannelInstruction}`
      : cleanQuestion;

    let payload = {
      question: finalQuestion || "leere Frage",
      userId: message.author.id,
      username: message.author.username,
      channelName: channel.name,
      channelId: channel.id,
      recentMessages,
      images: directImages.slice(0, SETTINGS.max_images || 8),
    };

    let resp = await callEdgeAi(payload);

    let safetyRounds = 0;
    while (resp?.status === "needs_tool_result" && resp?.tool === "search_server") {
      safetyRounds++;
      if (safetyRounds > 3) break;

      const toolResults = [];
      for (const call of resp.calls || []) {
        let callHints = Array.isArray(call.channel_hints) ? [...call.channel_hints] : [];
        const limit = Math.min(20, Math.max(1, call.message_limit || 10));

        if (targetChannel) {
          const aliases = CHANNEL_ALIASES[targetChannel] || [targetChannel];
          callHints = [...new Set([...callHints, ...aliases])];
        }

        const matched = await findChannelsByHints(guild, callHints);
        const channels = [];

        for (const ch of matched) {
          if (!isAllowed(ch.id, ch.name)) continue;

          if (targetChannel) {
            const aliases = CHANNEL_ALIASES[targetChannel] || [targetChannel];
            const chNorm = normalizeChannelName(ch.name);
            const isExactTarget = aliases.some((alias) => normalizeChannelName(alias) === chNorm);
            if (!isExactTarget) continue;
          }

          const msgs = await fetchRecent(ch, limit, true);
          channels.push({ name: ch.name, id: ch.id, messages: msgs });
        }

        toolResults.push({ tool_call_id: call.id, channels });
      }

      payload = {
        question: finalQuestion,
        userId: message.author.id,
        conversationState: resp.conversationState,
        toolResults,
      };

      resp = await callEdgeAi(payload);
    }

    if (resp?.status === "needs_tool_result") {
      await message.reply("Hmm, die Server-Suche hat zu lange gedauert. Versuch's bitte nochmal oder formulier die Frage anders.");
      return;
    }

    const answer =
      resp?.answer ||
      (targetChannel
        ? `Ich konnte für den Channel ${targetChannel} gerade keinen passenden Kontext finden.`
        : "Hmm, ich konnte gerade keine Antwort generieren. Versuch's bitte nochmal.");

    const safe = answer.length > 1990 ? `${answer.slice(0, 1987)}...` : answer;
    await message.reply(safe);
  } catch (err) {
    console.error("Fehler bei Nachricht:", err);
    try {
      await message.reply("Ups, da ist was schiefgelaufen. Probiers gleich nochmal.");
    } catch {}
  } finally {
    stopTyping?.();
  }
}

client.on(Events.MessageCreate, async (message) => {
  const cleanQuestion = shouldRespond(message);
  if (cleanQuestion === false) return;
  enqueueForUser(message.author.id, () => processQuestion(message, cleanQuestion));
});

client.on(Events.Error, (err) => console.error("Discord client error:", err));
client.login(DISCORD_TOKEN);
