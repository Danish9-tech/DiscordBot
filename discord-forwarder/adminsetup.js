const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.BOT_TOKEN || '';
const YOUR_SERVER_ID = '769638012325199879';

client.once('clientReady', async () => {
  console.log(`✅ Bot online: ${client.user.tag}`);

  const guild = await client.guilds.fetch(YOUR_SERVER_ID);
  const everyoneRole = guild.roles.everyone;

  // ── CREATE ADMIN CATEGORY ──
  const adminCategory = await guild.channels.create({
    name: '⚙️ ADMIN PANEL',
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      {
        id: everyoneRole.id,
        deny: [PermissionFlagsBits.ViewChannel], // hidden from everyone
      },
    ],
  });
  console.log(`✅ Created Admin Category`);

  // ── CREATE ADMIN COMMANDS CHANNEL ──
  await guild.channels.create({
    name: '🔧 | admin-commands',
    type: ChannelType.GuildText,
    parent: adminCategory.id,
    permissionOverwrites: [
      {
        id: everyoneRole.id,
        deny: [PermissionFlagsBits.ViewChannel], // hidden from everyone
      },
    ],
  });
  console.log(`✅ Created #admin-commands channel`);

  // ── CREATE ADMIN LOGS CHANNEL ──
  await guild.channels.create({
    name: '📋 | admin-logs',
    type: ChannelType.GuildText,
    parent: adminCategory.id,
    permissionOverwrites: [
      {
        id: everyoneRole.id,
        deny: [PermissionFlagsBits.ViewChannel], // hidden from everyone
      },
    ],
  });
  console.log(`✅ Created #admin-logs channel`);

  console.log('\n🎉 Admin panel created! Only you (server owner) can see it.');
  process.exit(0);
});

client.login(TOKEN);
