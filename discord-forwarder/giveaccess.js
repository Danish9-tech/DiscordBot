const { 
  Client, 
  GatewayIntentBits, 
  PermissionFlagsBits 
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

const TOKEN = process.env.BOT_TOKEN || '';
const YOUR_SERVER_ID = '769638012325199879';

client.once('clientReady', () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  console.log('📌 Commands ready:');
  console.log('   !give @username   → Give Premium Crypto access');
  console.log('   !remove @username → Remove Premium Crypto access');
  console.log('   !list             → Show all Premium Crypto members');
});

// ─────────────────────────────────────────
// !give @username
// ─────────────────────────────────────────
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  if (msg.guildId !== YOUR_SERVER_ID) return;

  // ── GIVE ACCESS ──
  if (msg.content.startsWith('!give')) {
    // Check if user is admin
    if (!msg.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return msg.reply('❌ Only admins can use this command!');
    }

    const member = msg.mentions.members.first();
    if (!member) {
      return msg.reply('❌ Please mention a user!\nExample: `!give @username`');
    }

    try {
      const guild = await client.guilds.fetch(YOUR_SERVER_ID);
      const premiumRole = guild.roles.cache.find(r => r.name === 'Premium Crypto');

      if (!premiumRole) {
        return msg.reply('❌ Premium Crypto role not found! Run `serverpermissions.js` first.');
      }

      // Check if already has role
      if (member.roles.cache.has(premiumRole.id)) {
        return msg.reply(`⚠️ **${member.user.username}** already has Premium Crypto access!`);
      }

      await member.roles.add(premiumRole);
      await msg.reply(
        `✅ **${member.user.username}** has been given **Premium Crypto** access!\n` +
        `💎 They can now see all Premium Crypto channels.`
      );
      console.log(`✅ Gave access to: ${member.user.username}`);

    } catch (err) {
      console.error(err);
      await msg.reply(`❌ Error: ${err.message}`);
    }
  }

  // ── REMOVE ACCESS ──
  if (msg.content.startsWith('!remove')) {
    if (!msg.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return msg.reply('❌ Only admins can use this command!');
    }

    const member = msg.mentions.members.first();
    if (!member) {
      return msg.reply('❌ Please mention a user!\nExample: `!remove @username`');
    }

    try {
      const guild = await client.guilds.fetch(YOUR_SERVER_ID);
      const premiumRole = guild.roles.cache.find(r => r.name === 'Premium Crypto');

      if (!premiumRole) {
        return msg.reply('❌ Premium Crypto role not found!');
      }

      if (!member.roles.cache.has(premiumRole.id)) {
        return msg.reply(`⚠️ **${member.user.username}** does not have Premium Crypto access!`);
      }

      await member.roles.remove(premiumRole);
      await msg.reply(
        `✅ **${member.user.username}** Premium Crypto access has been removed!`
      );
      console.log(`✅ Removed access from: ${member.user.username}`);

    } catch (err) {
      await msg.reply(`❌ Error: ${err.message}`);
    }
  }

  // ── LIST ALL PREMIUM MEMBERS ──
  if (msg.content.startsWith('!list')) {
    if (!msg.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return msg.reply('❌ Only admins can use this command!');
    }

    try {
      const guild = await client.guilds.fetch(YOUR_SERVER_ID);
      const premiumRole = guild.roles.cache.find(r => r.name === 'Premium Crypto');

      if (!premiumRole) {
        return msg.reply('❌ Premium Crypto role not found!');
      }

      const members = premiumRole.members;

      if (members.size === 0) {
        return msg.reply('📋 No members have Premium Crypto access yet.');
      }

      const list = members.map(m => `• ${m.user.username}`).join('\n');
      await msg.reply(
        `📋 **Premium Crypto Members (${members.size}):**\n${list}`
      );

    } catch (err) {
      await msg.reply(`❌ Error: ${err.message}`);
    }
  }
});

client.login(TOKEN);
