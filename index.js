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

const CHANNEL_LABELS = {
  "regelwerk": "Regelwerk",
  "neu-dazugekommen": "Neu-dazugekommen",
  "richtlinien-faq": "Richtlinien-FAQ",
  "agentur-faq": "Agentur-FAQ",
  "updates": "Updates",
  "information": "Informationen",
  "umfragen": "Umfragen",
  "tipps-und-tricks": "Tipps & Tricks",
  "live-manager": "Live-Manager",
  "agentur-info": "Agenturinfo",
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
        label: CHANNEL_LABELS[wantedName] || wantedName,
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

function isChannelQuestion(userText) {
  const t = normalizeName(userText);
  return (
    t.includes("was-steht") ||
    t.includes("was-ist") ||
    t.includes("erklar") ||
    t.includes("erklaer") ||
    t.includes("wofur-ist") ||
    t.includes("wofuer-ist")
  );
}

async function buildNiceChannelAnswer({
  askerMention,
  userText,
  targetContext,
}) {
  const label = targetContext.label;
  const mention = targetContext.mention;

  const prompt = `
Du schreibst eine schöne Discord-Antwort auf Deutsch.

Aufgabe:
Der User fragt nach genau einem Server-Channel. Erkläre den Channel kurz, natürlich und hilfreich.

Wichtige Regeln:
- Antworte in 3 bis 5 Sätzen.
- Klang natürlich, freundlich und hochwertig.
- Nicht zu kurz, nicht zu lang.
- Nenne den Channel IMMER mit dieser echten Mention: ${mention}
- Verwende keine andere Channel-Schreibweise als diese Mention.
- Schreibe NICHT "#unbekannt".
- Schreibe NICHT doppelte Formulierungen wie "Information, Information".
- Schreibe NICHT komische Füllsätze wie "die letzten Informationen darüber".
- Wenn Inhalt aus dem Channel-Kontext kommt, fasse ihn sauber zusammen.
- Wenn wenig Inhalt da ist, erkläre stattdessen sinnvoll, wofür der Channel da ist.
- Starte mit ${askerMention}
- Kein "User", sondern "Creator".
- Am Ende gern ein kurzer natürlicher Zusatz wie:
  "Wenn du zu einem Punkt daraus mehr wissen willst, sag einfach Bescheid."
- Aber nur wenn es natürlich passt.

Frage vom Creator:
${userText}

Channel-Name intern:
${targetContext.key}

Channel-Label:
${label}

Channel-Kontext:
${targetContext.text || "Keine Textnachrichten gefunden."}
`;

  const inputContent = [
    {
      type: "input_text",
      text: prompt,
    },
  ];

  for (const imageUrl of targetContext.images || []) {
    inputContent.push({
      type: "input_image",
      image_url: imageUrl,
    });
  }

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    instructions:
      "Du bist Aura.KI von Aura Influence. Du formulierst schön, natürlich, klar und community-nah. Bei Channel-Erklärungen schreibst du nicht zu knapp, sondern angenehm und hilfreich.",
    input: [
      {
        role: "user",
        content: inputContent,
      },
    ],
  });

  let answer = cleanTailMentions(
    response.output_text?.trim() || `${askerMention} In ${mention} findest du die wichtigsten Infos zu diesem Bereich.`
  );

  if (!answer.includes(mention)) {
    answer = `${askerMention} In ${mention} findest du die wichtigsten Infos zu ${label}.`;
  }

  if (/#unbekannt/i.test(answer)) {
    answer = answer.replace(/#unbekannt/gi, mention);
  }

  return answer;
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

    const userText = raw.slice(PREFIX.length).trim();

    if (!userText) {
      await message.reply("Schreib mir einfach mit ?aura plus deiner Frage.");
      return;
    }

    await message.channel.sendTyping();

    const askerMention = `<@${message.author.id}>`;
    const detectedTargetChannel = detectTargetChannel(userText);

    if (detectedTargetChannel && isChannelQuestion(userText)) {
      const channelContexts = await getChannelContext(message.guild, detectedTargetChannel);
      const targetContext = channelContexts.find((x) => x.key === detectedTargetChannel);

      if (!targetContext) {
        await message.reply(
          `${askerMention} Ich konnte den passenden Channel dazu gerade nicht sauber finden. Schau bitte kurz, ob der Kanalname genau so existiert oder schreib mir den Namen nochmal exakt.`
        );
        return;
      }

      const answer = await buildNiceChannelAnswer({
        askerMention,
        userText,
        targetContext,
      });

      const parts = splitMessage(answer, 1900);
      for (const part of parts) {
        await message.reply({
          content: part,
          allowedMentions: { parse: ["users", "roles"] },
        });
      }
      return;
    }

    const greeting = pickGreeting();
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
Interner Schlüssel: ${c.key}
Label: ${c.label}
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
- Verwende niemals "User" oder "Nutzer", sondern immer "Creator".
- Antworte locker, klar, hilfreich und natürlich.
- Nicht unnötig kurz.
- Wenn du einen Channel nennst, nutze IMMER die echte Channel-Mention aus dem Feld "Mention".
- Keine erfundenen Namen, keine erfundenen Beispiele.
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
        "Du bist Aura.KI von Aura Influence. Du antwortest auf Deutsch, natürlich, community-nah, präzise und hilfreich. Du sollst nicht zu knapp antworten, wenn eine etwas schönere Antwort besser passt.",
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
