import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PREFIX = "?aura";

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

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      instructions:
        "Du bist Aura.KI, der freundliche Discord-Assistent von Aura Influence. Antworte immer auf Deutsch, locker, klar, hilfreich und direkt. Sei sympathisch, modern und nicht unnötig lang.",
      input: userText,
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
