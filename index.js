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

  if (!me) {
    console.error("Bot-Mitglied in Guild nicht gefunden.");
    return contexts;
  }

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
      if (!perms) {
        console.log(`Keine Permissions prüfbar für #${channel.name}`);
        continue;
      }

      if (!perms.has(PermissionsBitField.Flags.ViewChannel)) {
        console.log(`Kein Zugriff auf #${channel.name}`);
        continue;
      }

      if (!perms.has(PermissionsBitField.Flags.ReadMessageHistory)) {
        console.log(`Kein Nachrichtenverlauf-Zugriff auf #${channel.name}`);
        continue;
      }

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
        "Du bist Aura.KI, der freundliche Discord-Assistent von Aura Influence. Antworte immer auf Deutsch, locker, klar, hilfreich und direkt. Nutze den Server-Kontext nur dann, wenn er wirklich zur Frage passt. Erfinde nichts.",
      input: `User-Frage:\n${userText}\n\nServer-Kontext aus ausgewählten Channels:\n${contextBlock}`,
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
