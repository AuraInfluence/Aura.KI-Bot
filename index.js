import { Client, GatewayIntentBits } from "discord.js";
import OpenAI from "openai";

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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

  const content = message.content.trim();
  if (!content) return;

  try {
    await message.channel.sendTyping();

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      instructions:
        "Du bist Aura.KI, der freundliche Discord-Assistent von Aura Influence. Antworte locker, klar, hilfreich und auf Deutsch. Antworte direkt auf die Frage des Users. Sei nicht unnötig lang.",
      input: content,
    });

    const answer = response.output_text?.trim() || "Ich konnte gerade nichts Sinnvolles antworten.";

    await message.reply({
      content: answer.slice(0, 1900),
    });
  } catch (error) {
    console.error("Fehler bei der Antwort:", error);
    await message.reply("Es gab gerade einen Fehler. Versuch es gleich nochmal.");
  }
});

client.login(DISCORD_TOKEN);
