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
  "richtlinien-faq": { includeBots: true, limit: 15 },
  "agentur-faq": { includeBots: true, limit: 15 },
  "updates": { includeBots: true, limit: 20 },
  "information": { includeBots: true, limit: 20 },
  "umfragen": { includeBots: true, limit: 20 },
  "tipps-und-tricks": { includeBots: true, limit: 20 },
  "live-manager": { includeBots: true, limit: 20 },
  "agentur-info": { includeBots: true, limit: 20 },
};

const CHANNEL_ALIASES = {
  "regelwerk": ["regelwerk"],
  "neu-dazugekommen": ["neu-dazugekommen", "neu dazugekommen"],
  "richtlinien-faq": ["richtlinien-faq", "richtlinien faq", "richtlinien"],
  "agentur-faq": ["agentur-faq", "agentur faq"],
  "updates": ["updates", "update"],
  "information": ["information", "informationen", "info", "infos"],
  "umfragen": ["umfragen", "umfrage"],
  "tipps-und-tricks": ["tipps-und-tricks", "tipps und tricks", "tipps", "tricks"],
  "live-manager": ["live-manager", "live manager", "livemanager"],
  "agentur-info": ["agentur-info", "agentur info", "agenturinfo"],
};

if (!DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN fehlt.");
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY fehlt.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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
    .trim();
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

function cleanText(text) {
  return String(text || "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/g, "")
    .trim();
}

function extractImageUrls(message) {
  const urls = [];

  for (const attachment of message.attachments.values()) {
    const isImage =
      attachment.contentType?.startsWith("image/") ||
      /\.(png|jpe?g|webp|gif)$/i.test(attachment.url || "");
    if (isImage && attachment.url) urls.push(attachment.url);
  }

  for (const embed of message.embeds) {
    if (embed.image?.url) urls.push(embed.image.url);
    if (embed.thumbnail?.url) urls.push(embed.thumbnail.url);
  }

  return [...new Set(urls)];
}

function extractMentionedUserIds(text) {
  const matches = String(text || "").match(/<@!?(\d+)>/g) || [];
  return matches.map((m) => m.replace(/\D/g, ""));
}

function detectTargetChannel(userText) {
  const normalizedText = normalizeName(userText);

  const entries = Object.entries(CHANNEL_ALIASES).sort((a, b) => {
    const aLen = Math.max(...a[1].map((x) => normalizeName(x).length));
    const bLen = Math.max(...b[1].map((x) => normalizeName(x).length));
    return bLen - aLen;
  });

  for (const [key, aliases] of entries) {
    const normalizedAliases = aliases.map(normalizeName);
    if (normalizedAliases.some((alias) => normalizedText.includes(alias))) {
      return key;
    }
  }

  return null;
}

function findChannelByWantedName(guild, wantedName) {
  const aliases = (CHANNEL_ALIASES[wantedName] || [wantedName]).map(normalizeName);

  return guild.channels.cache.find((c) => {
    if (!c) return false;
    if (c.type !== ChannelType.GuildText) return false;

    const normalizedChannelName = normalizeName(c.name);
    return aliases.includes(normalizedChannelName);
  });
}

async function getChannelContext(guild, targetChannel = null) {
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

  const wantedChannels = targetChannel ? [targetChannel] : ALLOWED_CHANNELS;

  for (const wantedName of wantedChannels) {
    try {
      const channel = findChannelByWantedName(guild, wantedName);
      if (!channel) continue;

      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) continue;
      if (!perms?.has(PermissionsBitField.Flags.ReadMessageHistory)) continue;

      const rule = CHANNEL_RULES[wantedName] || { includeBots: false, limit: 10 };
      const messages = await channel.messages.fetch({ limit: rule.limit });
      const sorted = [...messages.values()].reverse();

      const textLines = [];
      const imageUrls = [];
      let latestCreatorMention = null;

      for (const m of sorted) {
        const hasText = !!m.content?.trim();
        const images = extractImageUrls(m);
        const hasImages = images.length > 0;

        if (!rule.includeBots && m.author.bot) continue;
        if (!hasText && !hasImages) continue;

        if (hasText) {
          const authorLabel = m.author.bot ? `${m.author.username} [BOT]` : m.author.username;
          textLines.push(`- ${authorLabel}: ${m.content.trim()}`);

          const ids = extractMentionedUserIds(m.content);
          if (wantedName === "neu-dazugekommen" && ids.length > 0) {
            latestCreatorMention = `<@${ids[ids.length - 1]}>`;
          }
        }

        if (hasImages) {
          imageUrls.push(...images);
        }
      }

      contexts.push({
        key: wantedName,
        channelName: channel.name,
        mention: `<#${channel.id}>`,
        text: textLines.slice(0, 40).join("\n"),
        images: [...new Set(imageUrls)].slice(0, 6),
        latestCreatorMention,
      });
    } catch (err) {
      console.error(`Fehler beim Lesen eines Channels (${wantedName}):`, err);
    }
  }

  return contexts;
}

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;
    if (!message.guild) return;

    const raw = message.content?.trim();
    if (!raw) return;

    const lower = raw.toLowerCase();
    if (!lower.startsWith(PREFIX)) return;

    const userText = raw.slice(PREFIX.length).trim();

    if (!userText) {
      await message.reply("Schreib mir einfach mit ?aura plus deiner Frage.");
      return;
    }

    await message.channel.sendTyping();

    const askerMention = `<@${message.author.id}>`;
    const detectedTargetChannel = detectTargetChannel(userText);
    const channelContexts = await getChannelContext(message.guild, detectedTargetChannel);

    const inputContent = [];
    let contextText = `Fragender Creator: ${askerMention}

Frage:
${userText}

Erkanntes Kanal-Ziel:
${detectedTargetChannel || "kein eindeutiger Zielkanal"}

Server-Kontexte:
`;

    if (channelContexts.length === 0) {
      contextText += "Keine Channel-Kontexte gefunden.\n";
    } else {
      for (const c of channelContexts) {
        contextText += `
[CHANNEL]
Interner Schlüssel: ${c.key}
Name: ${c.channelName}
Mention: ${c.mention}
`;
        if (c.latestCreatorMention) {
          contextText += `Letzter Creator in diesem Channel: ${c.latestCreatorMention}\n`;
        }
        contextText += c.text?.trim()
          ? `Text:\n${c.text}\n`
          : `Text:\n- Keine Textnachrichten gefunden.\n`;

        if (c.images?.length) {
          contextText += `Hinweis: Dieser Channel enthält Bilder oder Grafiken.\n`;
        }
      }
    }

    contextText += `
WICHTIGE REGELN FÜR DEINE ANTWORT:
- Sprich den fragenden Creator am Anfang mit seiner Mention an.
- Verwende immer das Wort "Creator", nicht "User" oder "Nutzer".
- Wenn die Frage klar zu einem bestimmten Channel gehört, antworte auf Basis genau dieses Channels.
- Wenn du einen Channel erwähnst, nutze die echte Mention aus dem Feld "Mention".
- Fasse Inhalte natürlich, hilfreich und verständlich zusammen.
- Wenn nach einem Channel gefragt wird wie "Was steht in Informationen?", "Was steht in Agenturinfo?" oder "Was steht im Regelwerk?", lies den passenden Channel-Kontext und erkläre den Inhalt in natürlicher Sprache.
- Erfinde nichts dazu.
- Wenn etwas unklar ist, sag das ehrlich.
- Antworte nicht unnötig kurz, aber auch nicht zu lang.
- Keine komischen Platzhalter wie #unbekannt.
`;

    inputContent.push({
      type: "input_text",
      text: contextText,
    });

    for (const c of channelContexts) {
      for (const imageUrl of c.images || []) {
        inputContent.push({
          type: "input_image",
          image_url: imageUrl,
        });
      }
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      instructions:
        "Du bist Aura.KI von Aura Influence. Du antwortest auf Deutsch, natürlich, klar, hilfreich und community-nah. Deine Antworten sollen aus den gegebenen Channel-Inhalten entstehen.",
      input: [
        {
          role: "user",
          content: inputContent,
        },
      ],
    });

    const answer = cleanText(
      response.output_text?.trim() || "Ich ko
