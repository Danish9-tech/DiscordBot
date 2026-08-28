const { Client, GatewayIntentBits, ChannelType, PermissionFlagsBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const TOKEN = process.env.BOT_TOKEN || '';
const YOUR_SERVER_ID = '769638012325199879'; // ← Your Server ID

const structure = [

  // ─── TOP CHANNELS (no category) ───
  {
    category: 'Suggested',
    channels: [
      '💎 | forex-premium-plans',
      '📟 | create-ticket',
      '🎫 | ticket-3264',
    ]
  },

  // ─── GENERAL ───
  {
    category: '🤝 GENERAL',
    channels: [
      '📌 | start-here',
      '📢 | announcements',
      '📋 | rules-and-guidelines',
      '💜 | crypto-community-reviews',
      '💰 | crypto-profits-showcase',
      '⭐ | forex-community-reviews',
      '📊 | forex-profits-showcase',
      '👻 | gup-shup',
      '💎 | tips-and-tricks',
      '🎫 | create-ticket',
    ]
  },

  // ─── FREE COMMUNITY ───
  {
    category: '🙌 FREE COMMUNITY',
    channels: [
      '⭐ | premium-crypto-signals 🔥',
      '🎇 | premium-forex-signals 🔥',
      '🏆 | free-premium-giveaways',
      '🔔 | latest-market-updates',
    ]
  },

  // ─── PREMIUM COURSES & EDUCATION ───
  {
    category: '👩‍🏫 PREMIUM COURSES & EDUCATION',
    channels: [
      '📊 | waqar-zaka-basic-course',
      '📖 | waqar-zaka-advance-course',
      '🧒 | faizan-haroon-private-course',
      '📝 | candle-and-chart-patterns',
      '🌐 | chuff-gang-lectures',
    ]
  },

  // ─── ABOUT PREMIUM ───
  {
    category: '❓ ABOUT PREMIUM',
    channels: [
      '💎 | crypto-premium-plans',
      '❓ | how-to-join-premium',
    ]
  },

  // ─── PREMIUM CRYPTO Community ───
  {
    category: '🔒 PREMIUM CRYPTO Community',
    channels: [
      '⚡ | waqar-zaka-annual-bitnod',
      '🐺 | waqar-zaka-monthly-godzilla',
      '🥷 | inspired-analyst-premium',
      '⚔️ | inspired-analyst-1k-to-10k',
      '🦅 | abu-cartel-premium',
      '🍬 | crypto-candy-premium',
      '🥷 | hashtag-engineer-premium',
      '🔵 | manzi-crypto-premium',
      '♾️ | trade-with-jarvis-premium',
      '🙂 | shariq-amin-bull-army',
      '🤺 | mafia-exclusive-crypto-signals',
      '🙂 | faizan-haroon-premium',
      '🎯 | faizan-haroon-10x-challenge',
      '❇️ | meiraj-umair-chuff-gang',
      '❇️ | monty-sunny-chuff-gang',
      '❇️ | rafxcod-hunter-ninja-chuff',
      '❇️ | intern-mods-chuff-gang',
      '🚩 | crypto-aman-premium',
      '🩸 | binance-killers-premium',
      '👤 | fed-russian-insiders-premium',
      '🔴 | crypto-inner-circle-premium',
      '🧑‍🦱 | wall-street-queen-premium',
      '🎲 | crypto-taha-premium',
      '📱 | crypto-mobi-premium',
      '🐃 | crypto-bull-maker',
      '⏳ | p4-provider-premium',
      '🏦 | crypto-bank-premium',
      '✨ | trade-ideas-and-charts',
      '🛡️ | mafia-x-alpha-mentorship',
    ]
  },

  // ─── PREMIUM FOREX Community ───
  {
    category: '🔒 PREMIUM FOREX Community',
    channels: [
      '👑 | gold-control-premium',
      '🥇 | ben-gold-room-premium',
      '💎 | diamond-tier-inspired-analysis',
      '🚗 | civic-challenge-inspired-analysis',
      '🥇 | mike-gold-master-premium',
      '🏆 | gold-empire-premium',
      '⭐ | gold-scalp-premium',
      '📕 | forex-guide-room',
      '📊 | forex-premium-results',
      '💬 | forex-chat-room',
      '🎬 | vip-announcements',
      '💰 | crypto-premium-results',
      '💬 | vip-chat-room',
    ]
  },

];

// 🔒 PERMISSION SETS
const adminOnly = [
  {
    id: null, // will be replaced with @everyone role
    deny: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ],
  }
];

const readOnly = [
  {
    id: null, // @everyone
    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
    deny: [PermissionFlagsBits.SendMessages],
  }
];

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log('🚀 Starting full server setup with locked channels...\n');

  const guild = await client.guilds.fetch(YOUR_SERVER_ID);
  const everyoneRole = guild.roles.everyone; // @everyone role

  // Set @everyone ID in permission sets
  adminOnly[0].id = everyoneRole.id;
  readOnly[0].id  = everyoneRole.id;

  const existing = await guild.channels.fetch();
  const existingNames = existing.map(c => c.name.toLowerCase());

  for (const group of structure) {

    // ── TOP CHANNELS (no category) ──
    if (group.category === null) {
      for (const ch of group.channels) {
        await guild.channels.create({
          name: ch,
          type: ChannelType.GuildText,
          permissionOverwrites: adminOnly, // 🔒 locked
        });
        console.log(`🔒 Created locked top channel: ${ch}`);
      }
      continue;
    }

    // ── SKIP IF CATEGORY EXISTS ──
    const catClean = group.category.toLowerCase();
    if (existingNames.includes(catClean)) {
      console.log(`⏭️  Skipped (exists): ${group.category}`);
      continue;
    }

    // ── CREATE CATEGORY (locked) ──
    const category = await guild.channels.create({
      name: group.category,
      type: ChannelType.GuildCategory,
      permissionOverwrites: adminOnly, // 🔒 whole category locked
    });
    console.log(`\n📁 Created locked category: ${group.category}`);

    // ── CREATE CHANNELS UNDER CATEGORY ──
    for (const ch of group.channels) {
      await guild.channels.create({
        name: ch,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: adminOnly, // 🔒 each channel locked
      });
      console.log(`   🔒 Created: ${ch}`);
    }
  }

  console.log('\n🎉 FULL SETUP COMPLETE — ALL CHANNELS LOCKED!');
  process.exit(0);
});

client.login(TOKEN);
