import { Client, GatewayIntentBits, ChannelType, PermissionsBitField } from "discord.js";
import OpenAI from "openai";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PREFIX = "?aura";

const ALLOWED_CHANNELS = [
  "regelwerk-neu",
  "neu-dazugekommen",
  "richtlinien-faq",
  "agentur-faq",
];

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

client.once("ready", () => {
  console.log(`✅ Bot ist online als ${client.user.tag}`);
});

function normalizeName(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9äöüß-_ ]/g, "")
    .replace(/\s+/g, "-")
    .trim();
}

async function getChannelContext(guild) {
  const contexts = [];

  for (const wantedName of ALLOWED_CHANNELS) {
    const channel = guild.channels.cache.find((c) => {
      if (!c) return false;
      if (c.type !== ChannelType.GuildText) return false;
      return normalizeName(c.name) === normalizeName(wantedName);
    });

    if (!channel) continue;

    const me = guild.members.me;
    if (!me) continue;

    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) continue;
    if (!perms?.has(PermissionsBitField.Flags.ReadMessageHistory)) continue;

    try {
      const messages = await channel.messages.fetch({ limit: 8 });
      const cleaned = [...messages.values()]
        .reverse()
        .filter((m) => !m.author.bot && m.content?.trim())
        .map((m) => `- ${m.author.username}: ${m.content.trim()}`)
        .slice(0, 8);

      contexts.push({
        channelName: channel.name,
        text: cleaned.join("\n"),
      });
    } catch (err) {
      console.error(`Fehler beim Lesen von #${channel.name}:`, err.message);
    }
  }

  return contexts;
}

client.on("messageCreate", async (message) => {
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

  try {
    await message.channel.sendTyping();

    const channelContexts = await getChannelContext(message.guild);

    const contextBlock =
      channelContexts.length > 0
        ? channelContexts
            .map(
              (c) =>
                `# ${c.channelName}\n${c.text || "- Keine lesbaren Nachrichten gefunden."}`
            )
            .join("\n\n")
        : "Keine Channel-Kontexte gefunden.";

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      instructions:
        "Du bist Aura.KI, der freundliche Discord-Assistent von Aura Influence. Antworte immer auf Deutsch, locker, klar, hilfreich und direkt. Nutze den Server-Kontext nur dann, wenn er zur Frage passt. Erfinde nichts.",
      input: [
        {
          role: "user",
          content: `User-Frage:\n${userText}\n\nServer-Kontext aus ausgewählten Channels:\n${contextBlock}`,
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
    console.error("Fehler bei der Antwort:", error);
    await message.reply("Es gab gerade einen Fehler. Versuch es gleich nochmal.");
  }
});

client.login(DISCORD_TOKEN);
