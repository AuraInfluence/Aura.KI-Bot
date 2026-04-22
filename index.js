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
  "regelwerk": { includeBots: true, preferImages: false, limit: 15 },
  "neu-dazugekommen": { includeBots: true, preferImages: false, limit: 15 },
  "richtlinien-faq": { includeBots: true, preferImages: true, limit: 10 },
  "agentur-faq": { includeBots: true, preferImages: true, limit: 10 },
};

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

      if (!channel) {
        console.log(`Channel nicht gefunden: ${wantedName}`);
        continue;
      }

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

      for (const m of sorted) {
        const hasText = !!m.content?.trim();
        const images = extractImageUrls(m);
        const hasImages = images.length > 0;

        if (!rule.includeBots && m.author.bot) continue;
        if (!hasText && !hasImages) continue;

        if (hasText) {
          const authorLabel = m.author.bot ? `${m.author.username} [BOT]` : m.author.username;
          textLines.push(`- ${authorLabel}: ${m.content.trim()}`);
        }

        if (hasImages) {
          imageUrls.push(...images);
        }
      }

      contexts.push({
        channelName: channel.name,
        text: textLines.slice(0, 20).join("\n"),
        images: [...new Set(imageUrls)].slice(0, 5),
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

    const channelContexts = await getChannelContext(message.guild);

    const inputContent = [];

    let contextText = `User-Frage:\n${userText}\n\nVerfügbare Server-Kontexte:\n`;

    if (channelContexts.length === 0) {
      contextText += "Keine Channel-Kontexte gefunden.";
    } else {
      for (const c of channelContexts) {
        contextText += `\n[CHANNEL: ${c.channelName}]\n`;
        contextText += c.text?.trim()
          ? `${c.text}\n`
          : "- Keine Textnachrichten gefunden.\n";

        if (c.images?.length) {
          contextText += `- Dieser Channel enthält außerdem Bilder/Infografiken, die zusätzlich analysiert werden.\n`;
        }
      }
    }

    contextText += `\nWICHTIG:
- Wenn du Informationen aus einem Channel nutzt, nenne den Channel-Namen in der Antwort.
- Wenn etwas aus Bildern kommt, sage das ehrlich.
- Wenn in regelwerk die ProBot-Nachricht relevant ist, nutze sie.
- Wenn in neu-dazugekommen ProBot-Willkommensposts sind, behandle das als echte Server-Infos.
- Erfinde nichts.`;

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
        "Du bist Aura.KI, der freundliche Discord-Assistent von Aura Influence. Antworte immer auf Deutsch, klar, hilfreich und direkt. Nutze Server-Kontext nur wenn passend. Antworte präzise. Wenn die Frage nach Regeln, FAQ oder neuen Mitgliedern fragt, beziehe die passenden Channels ein und nenne sie klar.",
      input: [
        {
          role: "user",
          content: inputContent,
        },
      ],
    });

    const answer =
      response.output_text?.trim() ||
      "Ich konnte gerade nichts Sinnvolles antworten.";

    await message.reply({
      content: answer.slice(0, 1900),
    });
  } catch (error) {
    console.error("Fehler im messageCreate-Handler:", error);
    try {
      await message.reply("Es gab gerade einen Fehler. Versuch es gleich nochmal.");
    } catch {}
  }
});

client.login(DISCORD_TOKEN);
