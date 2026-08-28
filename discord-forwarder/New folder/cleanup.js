const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.BOT_TOKEN || '';
const YOUR_SERVER_ID = '769638012325199879'; // ← Your server ID here

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log('🗑️ Deleting all channels...');

  const guild = await client.guilds.fetch(YOUR_SERVER_ID);
  const channels = await guild.channels.fetch();

  for (const [id, channel] of channels) {
    try {
      await channel.delete();
      console.log(`🗑️ Deleted: ${channel.name}`);
    } catch (err) {
      console.log(`⚠️ Could not delete: ${channel.name}`);
    }
  }

  console.log('✅ All channels deleted! Now run setup.js');
  process.exit(0);
});

client.login(TOKEN);
