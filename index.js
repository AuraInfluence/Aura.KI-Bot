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
        .map((m) => 
