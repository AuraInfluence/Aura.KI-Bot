import { Client, GatewayIntentBits, ChannelType, PermissionsBitField } from "discord.js";
import OpenAI from "openai";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PREFIX = "?aura";

const ALLOWED_CHANNELS = [
  "regelwerk",
  "neu-dazugekommen",
  "richtlinien-faq",
  "agentur-faq",
  "updates",
  "information",
  "umfragen",
  "tipps-und-tricks",
  "live-manager",
  "agentur-info",
];

const CHANNEL_RULES = {
  "regelwerk": { includeBots: true, limit: 30 },
  "neu-dazugekommen": { includeBots: true, limit: 25 },
  "richtlinien-faq": { includeBots: true, limit: 12 },
  "agentur-faq": { includeBots: true, limit: 12 },
  "updates": { includeBots: true, limit: 20 },
  "information": { includeBots: true, limit: 20 },
  "umfragen": { includeBots: true, limit: 20 },
  "tipps-und-tricks": { includeBots: true, limit: 20 },
  "live-manager": { includeBots: true, limit: 20 },
  "agentur-info": { includeBots: true, limit: 20 },
};

const CHANNEL_ALIASES = {
  "regelwerk": ["regelwerk"],
  "neu-dazugekommen": ["neu-dazugekommen", "neu dazugekommen", "neudazugekommen"],
  "richtlinien-faq": ["richtlinien-faq", "richtlinien faq", "richtlinienfaq"],
  "agentur-faq": ["agentur-faq", "agentur faq", "agenturfaq"],
  "updates": ["updates", "update"],
  "information": ["information", "informationen", "info", "infos"],
  "umfragen": ["umfragen", "umfrage"],
  "tipps-und-tricks": [
    "tipps-und-tricks",
    "tipps und tricks",
    "tipps-und-trick",
    "tipps tricks",
    "tipps",
    "tricks",
  ],
  "live-manager": ["live-manager", "live manager", "livemanager"],
  "agentur-info": ["agentur-info", "agentur info", "agenturinfo"],
};

const GREETINGS = ["Hey", "Moin", "Servus", "Was geht", "Hi", "Jo"];

if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN fehlt.");
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY fehlt.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

process.on("unhandledRejection", (error) => {
  console.error("UNHANDLED REJECTION:", error);
});

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

client.once("ready", () => {
  console.log(`✅ Bot ist online als ${client.user.tag}`);
});

function normalizeName(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

function pickGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

function extractMentionedUserIds(text) {
  const matches = String(text || "").match(/<@!?(\d+)>/g) || [];
  return matches.map((m) => m.replace(/\D/g, ""));
}

function splitMessage(text, maxLength = 1900) {
  const chunks = [];
  let remaining = String(text || "").trim();

  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf("\n", maxLength);
    if (cut < 900) cut = remaining.lastIndexOf(". ", maxLength);
    if (cut < 900) cut = maxLength;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining.length) chunks.push(remaining);
  return chunks;
}

function getAliasesForChannel(wantedName) {
  return CHANNEL_ALIASES[wantedName] || [wantedName];
}

function findMatchingChannel(guild, wantedName) {
  const aliases = getAliasesForChannel(wantedName).map(normalizeName);

  return guild.channels.cache.find((c) => {
    if (!c) return false;
    if (c.type !== ChannelType.GuildText) return false;

    const channelName = normalizeName(c.name);
    return aliases.includes(channelName);
  });
}

async function getChannelContext(guild) {
  const contexts = [];

  try {
    await guild.channels.fetch();
  } catch (err) {
    console.error("Konnte Channels nicht laden:", err);
  }

  let me = guild.members.me;
  try {
    if (!me && client.user?.id) {
      me = await guild.members.fetch(client.user.id);
    }
  } catch (err) {
    console.error("Konnte Bot-Mitglied nicht laden:", err);
    return contexts;
  }

  if (!me) return contexts;

  for (const wantedName of ALLOWED_CHANNELS) {
    try {
      const channel = findMatchingChannel(guild, wantedName);
      if (!channel) continue;

      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) continue;
      if (!perms?.has(PermissionsBitField.Flags.ReadMessageHistory)) continue;

      const rule = CHANNEL_RULES[wantedName] || {
        includeBots: false,
        limit: 10,
      };

      const messages = await channel.messages.fetch({ limit: rule.limit });
      const sorted = [...messages.values()].reverse();

      const textLines = [];
      let latestCreatorMention = null;

      for (const m of sorted) {
        const hasText = !!m.content?.trim();
        if (!rule.includeBots && m.author.bot) continue;
        if (!hasText) continue;

        const authorLabel = m.author.bot ? `${m.author.username} [BOT]` : m.author.username;
        textLines.push(`- ${authorLabel}: ${m.content.trim()}`);

        const ids = extractMentionedUserIds(m.content);
        if (wantedName === "neu-dazugekommen" && ids.length > 0) {
          latestCreatorMention = `<@${ids[ids.length - 1]}>`;
        }
      }

      contexts.push({
        key: wantedName,
        channelName: channel.name,
        mention: `<#${channel.id}>`,
        text: textLines.slice(0, 40).join("\n"),
        latestCreatorMention,
      });
    } catch (err) {
      console.error(`Fehler beim Lesen von ${wantedName}:`, err);
    }
  }

  return contexts;
}

function detectTargetChannel(userText) {
  const text = String(userText || "").toLowerCase().trim();

  const asksExplicitChannel =
    text.includes("channel") ||
    text.includes("kanal") ||
    text.includes("was steht in") ||
    text.includes("zeig mir") ||
    text.includes("fass") ||
    text.includes("zusammen") ||
    text.includes("inhalt") ||
    text.includes("steht im");

  if (!asksExplicitChannel) return null;

  for (const wantedName of ALLOWED_CHANNELS) {
    const aliases = getAliasesForChannel(wantedName);

    for (const alias of aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[- ]?");
      const rx = new RegExp(`\\b${escaped}\\b`, "i");

      if (rx.test(text)) {
        return wantedName;
      }
    }
  }

  return null;
}

function buildPrompt(channelContexts, userText, askerMention, greeting) {
  let contextText = `Fragender Creator: ${askerMention}
Begrüßung: ${greeting}

Frage:
${userText}

Server-Kontexte:
`;

  if (channelContexts.length === 0) {
    contextText += "Keine Channel-Kontexte gefunden.\n";
  } else {
    for (const c of channelContexts) {
      contextText += `
[CHANNEL]
Name: ${c.channelName}
Mention: ${c.mention}
`;
      if (c.latestCreatorMention) {
        contextText += `Letzter Creator in diesem Channel: ${c.latestCreatorMention}\n`;
      }
      contextText += c.text?.trim()
        ? `Text:\n${c.text}\n`
        : `Text:\n- Keine Textnachrichten gefunden.\n`;
    }
  }

  contextText += `
WICHTIGE REGELN FÜR DEINE ANTWORT:
- Sprich den fragenden Creator am Anfang direkt mit seiner Mention an.
- Verwende niemals "User" oder "Nutzer", sondern allgemein immer "Creator".
- Wenn du über eine konkrete Person sprichst, nutze die echte Mention, wenn vorhanden.
- Wenn du einen Channel nennst, nutze IMMER die echte Channel-Mention.
- Wenn du am Ende nochmal auf einen Channel verweist, dann wieder als echte Channel-Mention.
- Wenn nach einem konkreten Channel gefragt wird, antworte NUR anhand dieses Channel-Kontexts.
- Wenn nach "regelwerk" gefragt wird, fasse die wichtigsten Regeln zusammen und erwähne ergänzende Hinweise, falls sie im Kontext stehen.
- Wenn nach "neu-dazugekommen" gefragt wird, erwähne sinnvoll den zuletzt erkannten Creator, falls vorhanden.
- Antworte locker, klar, hilfreich und nicht unnötig lang.
- Keine erfundenen Namen oder Beispiele.
- Wenn etwas im Kontext nicht sicher steht, sag das ehrlich.
`;

  return contextText;
}

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    const raw = message.content?.trim();
    if (!raw) return;

    const lower = raw.toLowerCase();
    const isMention = message.mentions.has(client.user);
    const isPrefix = lower.startsWith(PREFIX);

    if (!isMention && !isPrefix) return;

    let userText = raw;

    if (isMention) {
      userText = userText.replace(/<@!?\d+>/g, "").trim();
    } else if (isPrefix) {
      userText = raw.slice(PREFIX.length).trim();
    }

    if (!userText) {
      await message.reply("Schreib mir einfach mit ?aura plus deiner Frage oder markiere mich direkt.");
      return;
    }

    await message.channel.sendTyping();

    const greeting = pickGreeting();
    const askerMention = `<@${message.author.id}>`;
    const allContexts = await getChannelContext(message.guild);
    const targetChannel = detectTargetChannel(userText);

    let usedContexts = allContexts;
    if (targetChannel) {
      const filtered = allContexts.filter((c) => c.key === targetChannel);
      if (filtered.length > 0) {
        usedContexts = filtered;
      }
    }

    const prompt = buildPrompt(usedContexts, userText, askerMention, greeting);

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
    });

    const answer = String(response.output_text || "").trim();

    if (!answer) {
      console.error("Leere OpenAI-Antwort:", JSON.stringify(response, null, 2));
      await message.reply("Ich konnte gerade nichts Sinnvolles antworten.");
      return;
    }

    const parts = splitMessage(answer, 1900);

    for (const part of parts) {
      await message.reply({
        content: part,
        allowedMentions: { parse: ["users", "roles"] },
      });
    }
  } catch (error) {
    console.error("Fehler im messageCreate-Handler:", error);
    try {
      await message.reply(
        `Es gab gerade einen Fehler. Versuch es gleich nochmal.\nFehler: ${error.message?.slice(0, 300) || "unbekannt"}`
      );
    } catch {}
  }
});

client.login(DISCORD_TOKEN);
