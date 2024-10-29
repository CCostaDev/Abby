// Require the necessary discord.js classes
const fs = require("node:fs");
const path = require("node:path");
const { Client, Collection, Events, GatewayIntentBits } = require("discord.js");
const { token } = require("./config.json");
const { TenorKey } = require("./config.json");
const { DisTube } = require("distube");
const { YtDlpPlugin } = require("@distube/yt-dlp");
const { getVoiceConnection } = require("@discordjs/voice");
const ytSearch = require("yt-search");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.commands = new Collection();

const foldersPath = path.join(__dirname, "commands");
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
  const commandsPath = path.join(foldersPath, folder);
  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js"));
  for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    // Set a new item in the Collection with the key as the command name and the value as the exported module
    if ("data" in command && "execute" in command) {
      client.commands.set(command.data.name, command);
    } else {
      console.log(
        `[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`
      );
    }
  }
}
// Setup DisTube with the YouTube plugin
const distube = new DisTube(client, {
  plugins: [new YtDlpPlugin()],
  emitNewSongOnly: true,
});

(async () => {
  const fetch = (await import("node-fetch")).default;

  const replies = [
    "Ugh... What?",
    "Let me sleep..",
    "How can I NOT help you today?",
    "Get out!",
    "Seems like a YOU problem..",
  ];

  client.on("messageCreate", gotMessage);

  async function gotMessage(message) {
    if (message.content === "!help") {
      const index = Math.floor(Math.random() * replies.length);
      message.reply(replies[index]);
    } else if (message.content.startsWith("!gif")) {
      //split the message content into arguments
      const args = message.content.split(" ");

      // Check for channel mention or name
      let targetChannel = message.channel;

      // Check if the second argument is a channel mention (e.g., #channel-name)
      if (args[1] && args[1].startsWith("<#") && args[1].endsWith(">")) {
        const channelId = args[1].slice(2, -1);
        targetChannel = client.channels.cache.get(channelId);
      }

      // Determine the search term based on wheter channelId is provided
      const searchTerm =
        targetChannel !== message.channel
          ? args.slice(2).join(" ").trim()
          : args.slice(1).join(" ").trim() || "bored";

      // Verify the target channel
      if (!targetChannel) {
        return message.reply("I couldn't find the specified channel.");
      }

      // Construct the Tenor API URL for GIF search
      let url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(
        searchTerm
      )}&key=${TenorKey}&client_key=my_test_app&limit=10`;

      try {
        let response = await fetch(url);
        let json = await response.json();

        if (json.results && json.results.length > 0) {
          const randomIndex = Math.floor(Math.random() * json.results.length);
          const gifUrl = json.results[randomIndex].media_formats.gif.url;

          // Send GIF directly to the target channel
          targetChannel.send(gifUrl);
        } else {
          message.reply(`No GIFs found for "${searchTerm}".`);
        }
      } catch (error) {
        console.error("Error fetching GIF: ", error);
        message.reply("Sorry, I couldn't find a GIF right now.");
      }
    } else if (message.content.startsWith("!play")) {
      // Removed ytdl-core related code and replaced with DisTube implementation
      const args = message.content.split(" ").slice(1);
      const query = args.join(" ");

      const voiceChannel = message.member?.voice?.channel;
      if (!voiceChannel) {
        message.reply("You need to be in a voice channel to play music!");
        return;
      }

      if (!query) {
        message.reply("Please provide a song name or URL.");
        return;
      }

      try {
        // Use DisTube to play the song
        distube.play(voiceChannel, query, {
          member: message.member,
          textChannel: message.channel,
          message,
        });
      } catch (error) {
        console.error("Error playing song: ", error);
        message.reply("There was an issue playing the song.");
      }
    } else if (message.content === "!stop") {
      const queue = distube.getQueue(message);
      if (queue) {
        distube.stop(message);
        message.reply("Stopped the music and I'm leaving the channel!");

        const voiceChannel = message.member.voice.channel;
        if (voiceChannel) {
          const connection = getVoiceConnection(voiceChannel.guild.id);
          if (connection) {
            connection.destroy();
          }
        }
      } else {
        message.reply("There is nothing playing right now.");
      }
    } else if (message.content === "!skip") {
      if (!distube.getQueue(message)) {
        message.reply("There's no song to skip.");
        return;
      }
      distube.skip(message);
      message.reply("Skipped the song!");
    } else if (message.content === "!pause") {
      if (!distube.getQueue(message)) {
        message.reply("There's no music playing to pause.");
        return;
      }
      distube.pause(message);
      message.reply("Paused the music!");
    } else if (message.content === "!resume") {
      if (!distube.getQueue(message)) {
        message.reply("There's no music paused.");
        return;
      }
      distube.resume(message);
      message.reply("Resumed the music!");
    } else if (message.content.startsWith("!volume")) {
      const args = message.content.split(" ");

      // Check if a volume level is specified and is a number
      const volume = parseInt(args[1]);
      if (isNaN(volume) || volume < 1 || volume > 100) {
        return message.reply("Please specify a volume between 1 and 100.");
      }

      // Get the current queue
      const queue = distube.getQueue(message);
      if (!queue) {
        return message.reply("There is no music playing right now.");
      }

      // Set the volume
      distube.setVolume(message, volume);
      message.reply(`Volume set to ${volume}%`);
    }
  }
})();

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    console.error(`No command matching ${interaction.commandName} was found.`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: "There was an error while executing this command!",
        ephemeral: true,
      });
    }
  }
});

// DisTube event handlers (Optional but useful for user feedback)
distube
  .on("playSong", (queue, song) =>
    queue.textChannel.send(
      `Playing: ${song.name} - \`${song.formattedDuration}\``
    )
  )
  .on("addSong", (queue, song) =>
    queue.textChannel.send(
      `Added to queue: ${song.name} - \`${song.formattedDuration}\``
    )
  )
  .on("addList", (queue, playlist) =>
    queue.textChannel.send(
      `Playlist \`${playlist.name}\` with ${playlist.songs.length} songs has been added to the queue!`
    )
  )
  .on("searchNoResult", (message, query) => {
    message.channel.send(`No results found for "${query}".`);
  })
  .on("error", (channel, error) => {
    console.error(error);

    // Check if the error is a 'CANNOT_RESOLVE_SONG' error
    if (error.errorCode === "CANNOT_RESOLVE_SONG") {
      channel.send(
        "I couldn't find the song you requested. Please try another search term."
      );
    } else {
      channel.send(`An unexpected error occurred: ${error.message}`);
    }
  });

// When the client is ready, run this code (only once).
// The distinction between `client: Client<boolean>` and `readyClient: Client<true>` is important for TypeScript developers.
// It makes some properties non-nullable.
client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Log in to Discord with your client's token
client.login(token);
