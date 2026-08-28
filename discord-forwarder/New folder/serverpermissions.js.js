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
  const channels = await guild.channels.fetch();

  // ─── CREATE PREMIUM CRYPTO ROLE (if not exists) ───
  let premiumRole = guild.roles.cache.find(r => r.name === 'Premium Crypto');
  if (!premiumRole) {
    premiumRole = await guild.roles.create({
      name: 'Premium Crypto',
      color: 'Gold',
      reason: 'Role for Premium Crypto Community access',
    });
    console.log(`✅ Created role: Premium Crypto`);
  } else {
    console.log(`✅ Role already exists: Premium Crypto`);
  }

  // ─── LOOP ALL CHANNELS ───
  for (const [id, channel] of channels) {
    if (!channel) continue;

    const isPremiumCrypto =
      channel.name.toLowerCase().includes('premium crypto') ||
      (channel.parent && channel.parent.name.toLowerCase().includes('premium crypto'));

    // ── PREMIUM CRYPTO CATEGORY & CHANNELS → LOCKED ──
    if (isPremiumCrypto) {
      await channel.permissionOverwrites.set([
        {
          // @everyone CANNOT see
          id: everyoneRole.id,
          deny: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
        {
          // Premium Crypto role CAN see (read only)
          id: premiumRole.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.ReadMessageHistory,
          ],
          deny: [
            PermissionFlagsBits.SendMessages,
          ],
        },
      ]);
      console.log(`🔒 Locked (Premium only): ${channel.name}`);

    } else {
      // ── ALL OTHER CHANNELS → READ ONLY FOR EVERYONE ──
      if (channel.type === ChannelType.GuildText) {
        await channel.permissionOverwrites.set([
          {
            // @everyone can see but NOT send messages
            id: everyoneRole.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.ReadMessageHistory,
            ],
            deny: [
              PermissionFlagsBits.SendMessages,
            ],
          },
        ]);
        console.log(`👁️ Read Only: ${channel.name}`);
      }
    }
  }

  console.log('\n🎉 ALL PERMISSIONS SET SUCCESSFULLY!');
  console.log('📌 Summary:');
  console.log('   👁️  All normal channels    → Read Only (members can see, cannot send)');
  console.log('   🔒 Premium Crypto channels → Locked (only Premium Crypto role can see)');
  process.exit(0);
});

client.login(TOKEN);
