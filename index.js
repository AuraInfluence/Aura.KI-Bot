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
  "regelwerk": { includeBots: true, preferImages: false, limit: 30 },
  "neu-dazugekommen": { includeBots: true, preferImages: false, limit: 25 },
  "richtlinien-faq": { includeBots: true, preferImages: true, limit: 12 },
  "agentur-faq": { includeBots: true, preferImages: true, limit: 12 },
  "updates": { includeBots: true, preferImages: false, limit: 20 },
  "information": { includeBots: true, preferImages: false, limit: 20 },
  "umfragen": { includeBots: true, preferImages: false, limit: 20 },
  "tipps-und-tricks": { includeBots: true, preferImages: true, limit: 20 },
  "live-manager": { includeBots: true, preferImages: false, limit: 20 },
  "agentur-info": { includeBots: true, preferImages: true, limit: 20 },
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
    .trim();
}

function pickGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
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

function cleanTailMentions(text) {
  return String(text || "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/g, "")
    .trim();
}

function getAliasesForChannel(wantedName) {
  return CHANNEL_ALIASES[wantedName] || [wantedName];
}

function findChannelByWantedName(guild, wantedName) {
  const aliases = getAliasesForChannel(wantedName).map(normalizeName);

  return guild.channels.cache.find((c) => {
    if (!c) return false;
    if (c.type !== ChannelType.GuildText) return false;

    const normalizedChannelName = normalizeName(c.name);
    return aliases.includes(normalizedChannelName);
  });
}

function detectTargetChannel(userText) {
  const text = normalizeName(userText);

  const sortedEntries = Object.entries(CHANNEL_ALIASES).sort((a, b) => {
    const aMax = Math.max(...a[1].map((x) => normalizeName(x).length));
    const bMax = Math.max(...b[1].map((x) => normalizeName(x).length));
    return bMax - aMax;
  });

  for (const [target, aliases] of sortedEntries) {
    const normalizedAliases = aliases.map(normalizeName);
    if (normalizedAliases.some((alias) => text.includes(alias))) {
      return target;
    }
  }

  return null;
}

function buildChannelLabel(key) {
  switch (key) {
    case "regelwerk":
      return "Regelwerk";
    case "neu-dazugekommen":
      return "Neu-dazugekommen";
    case "richtlinien-faq":
      return "Richtlinien-FAQ";
    case "agentur-faq":
      return "Agentur-FAQ";
    case "updates":
      return "Updates";
    case "information":
      return "Information";
    case "umfragen":
      return "Umfragen";
    case "tipps-und-tricks":
      return "Tipps-und-Tricks";
    case "live-manager":
      return "Live-Manager";
    case "agentur-info":
      return "Agentur-Info";
    default:
      return key;
  }
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

  const channelList = targetChannel ? [targetChannel] : ALLOWED_CHANNELS;

  for (const wantedName of channelList) {
    try {
      const channel = findChannelByWantedName(guild, wantedName);
      if (!channel) continue;

      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) continue;
      if (!perms?.has(PermissionsBitField.Flags.ReadMessageHistory)) continue;

      const rule = CHANNEL_RULES[wantedName] || {
        includeBots: false,
        preferImages: false,
        limit: 10,
      };

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
        channelLabel: buildChannelLabel(wantedName),
        channelName: channel.name,
        channelId: channel.id,
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
    const isPrefix = lower.startsWith(PREFIX);

    if (!isPrefix) return;

    let userText = raw.slice(PREFIX.length).trim();

    if (!userText) {
      await message.reply("Schreib mir einfach mit ?aura plus deiner Frage.");
      return;
    }

    await message.channel.sendTyping();

    const greeting = pickGreeting();
    const askerMention = `<@${message.author.id}>`;
    const detectedTargetChannel = detectTargetChannel(userText);
    const channelContexts = await getChannelContext(message.guild, detectedTargetChannel);

    const inputContent = [];
    let contextText = `Fragender Creator: ${askerMention}
Begrüßung: ${greeting}

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
Anzeigename: ${c.channelLabel}
Discord-Name: ${c.channelName}
Mention: ${c.mention}
`;
        if (c.latestCreatorMention) {
          contextText += `Letzter Creator in diesem Channel: ${c.latestCreatorMention}\n`;
        }
        contextText += c.text?.trim()
          ? `Text:\n${c.text}\n`
          : `Text:\n- Keine Textnachrichten gefunden.\n`;

        if (c.images?.length) {
          contextText += `Hinweis: Dieser Channel enthält FAQ-Bilder/Grafiken.\n`;
        }
      }
    }

    contextText += `
WICHTIGE REGELN FÜR DEINE ANTWORT:
- Starte kurz natürlich, aber ohne unnötiges Gelaber.
- Sprich den fragenden Creator am Anfang direkt mit seiner Mention an.
- Verwende niemals "User" oder "Nutzer", sondern immer "Creator".
- Wenn die Frage sich klar auf genau einen Channel bezieht, dann antworte NUR zu diesem einen Channel.
- Wenn nach "information", "informationen", "info" oder "infos" gefragt wird, ist immer derselbe Channel gemeint.
- Wenn nach "agenturinfo", "agentur-info" oder "agentur info" gefragt wird, ist immer derselbe Channel gemeint.
- Wenn nach einem Channel gefragt wird, erkläre kurz und konkret, was in diesem Channel steht oder wofür er da ist.
- Nutze bei einer Channel-Nennung IMMER die echte Channel-Mention aus dem Feld "Mention".
- Schreibe NICHT sowas wie "im Channel Information, Information" oder doppelte Kanalnamen.
- Schreibe NICHT "die letzten Informationen darüber" oder ähnliche komische Füllsätze.
- Formuliere sauber so: "<#123456> ist dafür da, dass ..." oder "In <#123456> findest du ...".
- Wenn nach Regelwerk gefragt wird, erkläre nur das Regelwerk.
- Wenn nach Richtlinien gefragt wird, erkläre nur Richtlinien-FAQ.
- Wenn nach Agentur-FAQ gefragt wird, erkläre nur Agentur-FAQ.
- Wenn nach Updates gefragt wird, erkläre nur Updates.
- Wenn nach Information gefragt wird, erkläre nur Information.
- Wenn nach Umfragen gefragt wird, erkläre nur Umfragen.
- Wenn nach Tipps und Tricks gefragt wird, erkläre nur Tipps-und-Tricks.
- Wenn nach Live-Manager gefragt wird, erkläre nur Live-Manager.
- Wenn nach Agentur-Info gefragt wird, erkläre nur Agentur-Info.
- Wenn nach Neu-dazugekommen gefragt wird, erwähne sinnvoll den zuletzt erkannten Creator, falls vorhanden.
- Wenn Informationen aus Bildern stammen, sag ehrlich, dass du sie aus den FAQ-Grafiken zusammenfasst.
- Kurz, klar, hilfreich. Keine erfundenen Namen, keine erfundenen Inhalte.
- Wenn ein passender Channel erkannt wurde, nenne in der Antwort genau dessen Mention mindestens einmal.
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
        "Du bist Aura.KI von Aura Influence. Du antwortest auf Deutsch, natürlich, community-nah und präzise. Bei Fragen zu Discord-Kanälen erklärst du den passenden Kanal kurz und sauber. Du nennst Kanäle nicht als Klartext, sondern mit der gegebenen Discord-Mention. Keine doppelten Kanalnamen, keine komischen Füllsätze.",
      input: [
        {
          role: "user",
          content: inputContent,
        },
      ],
    });

    let answer = cleanTailMentions(
      response.output_text?.trim() || "Ich konnte gerade nichts Sinnvolles antworten."
    );

    const targetContext = detectedTargetChannel
      ? channelContexts.find((x) => x.key === detectedTargetChannel)
      : null;

    if (targetContext?.mention && !answer.includes(targetContext.mention)) {
      answer = `${askerMention} ${targetContext.mention} ${answer}`;
      answer = cleanTailMentions(answer);
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
      await message.reply("Es gab gerade einen Fehler. Versuch es gleich nochmal.");
    } catch {}
  }
});

client.login(DISCORD_TOKEN);
