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
];

const CHANNEL_RULES = {
  "regelwerk": { includeBots: true, preferImages: false, limit: 30 },
  "neu-dazugekommen": { includeBots: true, preferImages: false, limit: 25 },
  "richtlinien-faq": { includeBots: true, preferImages: true, limit: 12 },
  "agentur-faq": { includeBots: true, preferImages: true, limit: 12 },
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
      const channel = guild.channels.cache.find((c) => {
        if (!c) return false;
        if (c.type !== ChannelType.GuildText) return false;
        return normalizeName(c.name) === normalizeName(wantedName);
      });

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
    const channelContexts = await getChannelContext(message.guild);

    const inputContent = [];
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

        if (c.images?.length) {
          contextText += `Hinweis: Dieser Channel enthält FAQ-Bilder/Grafiken.\n`;
        }
      }
    }

    contextText += `
WICHTIGE REGELN FÜR DEINE ANTWORT:
- Sprich den fragenden Creator am Anfang direkt mit seiner Mention an.
- Verwende niemals "User" oder "Nutzer", sondern allgemein immer "Creator".
- Wenn du über eine konkrete Person sprichst, nutze die echte Mention, wenn vorhanden.
- Wenn nach "regelwerk" gefragt wird, fasse die wichtigsten Regeln zusammen UND erwähne auch ergänzende Regeln/Hinweise, falls sie im Kontext stehen.
- Wenn du einen Channel nennst, nutze IMMER die echte Channel-Mention aus dem Feld "Mention".
- Wenn du am Ende nochmal auf einen Channel verweist, dann wieder als echte Mention, nicht als normaler Text.
- Wenn nach "neu-dazugekommen" gefragt wird, erwähne sinnvoll den zuletzt erkannten Creator, falls vorhanden.
- Wenn Informationen aus Bildern stammen, sag ehrlich, dass du sie aus den FAQ-Grafiken zusammenfasst.
- Antworte locker, klar, hilfreich und nicht unnötig lang.
- Keine erfundenen Namen oder Beispiele.
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
        "Du bist Aura.KI von Aura Influence. Du antwortest auf Deutsch, natürlich, community-nah und präzise. Du sagst immer Creator statt User/Nutzer.",
      input: [
        {
          role: "user",
          content: inputContent,
        },
      ],
    });

    let answer = cleanTailMentions(response.output_text?.trim() || "Ich konnte gerade nichts Sinnvolles antworten.");

    const fallbackMentions = channelContexts.map((c) => c.mention).filter(Boolean);
    const targetMentions = [];

    if (/regelwerk/i.test(userText)) {
      const c = channelContexts.find((x) => x.channelName === "regelwerk");
      if (c?.mention) targetMentions.push(c.mention);
    } else if (/richtlinien/i.test(userText)) {
      const c = channelContexts.find((x) => x.channelName === "richtlinien-faq");
      if (c?.mention) targetMentions.push(c.mention);
    } else if (/agentur/i.test(userText)) {
      const c = channelContexts.find((x) => x.channelName === "agentur-faq");
      if (c?.mention) targetMentions.push(c.mention);
    }

    if (answer.length < 1500 && targetMentions.length) {
      answer += `\n\nMehr dazu findest du direkt hier: ${[...new Set(targetMentions)].join(" ")}`;
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
