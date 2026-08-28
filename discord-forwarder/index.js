const { Client: SelfClient } = require('discord.js-selfbot-v13');
const { Client: BotClient, ChannelType, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Load Config (supports config.json AND cloud environment variables)
let config = {
  USER_TOKEN: process.env.USER_TOKEN || '',
  BOT_TOKEN: process.env.BOT_TOKEN || '',
  SOURCE_GUILD_NAME: process.env.SOURCE_GUILD_NAME || 'Trading Mafia',
  TARGET_GUILD_ID: process.env.TARGET_GUILD_ID || '769638012325199879',
  TARGET_GUILD_NAME: process.env.TARGET_GUILD_NAME || 'Bernard server',
  USE_WEBHOOKS: true,
  AUTO_CREATE_MISSING_CHANNELS: true,
  REMOVE_SOURCE_CONTACTS: true,
  REPLACEMENTS: {
    "Trading Mafia": "Bernard Community",
    "@Trading Mafia": "@Bernard Support"
  }
};

const configPath = path.join(__dirname, 'config.json');
if (fs.existsSync(configPath)) {
  try {
    const loadedConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...config, ...loadedConfig };
    if (!config.BOT_TOKEN && loadedConfig.TOKEN) {
      config.BOT_TOKEN = loadedConfig.TOKEN;
    }
  } catch (e) {}
}

const botClient = new BotClient({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks,
  ]
});

let selfClient = null;
if (config.USER_TOKEN && config.USER_TOKEN.trim() !== '') {
  selfClient = new SelfClient({ checkUpdate: false });
}

// Channel Mapping: sourceChannelId -> targetChannel Object
const channelMap = new Map();
const webhookMap = new Map();

let sourceGuild = null;
let targetGuild = null;

function sanitizeName(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Text Replacement & Sanitization Engine
 */
function sanitizeText(text) {
  if (!text || typeof text !== 'string') return text;

  let sanitized = text;

  // 1. Custom Text Replacements from Config
  if (config.REPLACEMENTS && typeof config.REPLACEMENTS === 'object') {
    for (const [key, value] of Object.entries(config.REPLACEMENTS)) {
      if (key) {
        const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        sanitized = sanitized.replace(regex, value);
      }
    }
  }

  // 2. Remove Source Contact Links & Phone Numbers if enabled
  if (config.REMOVE_SOURCE_CONTACTS) {
    sanitized = sanitized.replace(/https?:\/\/wa\.me\/[0-9]+/gi, '');
    sanitized = sanitized.replace(/\+44\s?[0-9\s]{9,12}/gi, '');
  }

  return sanitized;
}

/**
 * Embed Sanitization
 */
function sanitizeEmbed(embed) {
  if (!embed) return embed;
  const e = { ...embed };

  if (e.title) e.title = sanitizeText(e.title);
  if (e.description) e.description = sanitizeText(e.description);

  if (Array.isArray(e.fields)) {
    e.fields = e.fields.map(f => ({
      ...f,
      name: sanitizeText(f.name),
      value: sanitizeText(f.value)
    }));
  }

  if (e.footer && e.footer.text) {
    e.footer.text = sanitizeText(e.footer.text);
  }

  return e;
}

async function syncChannelMappings() {
  if (!sourceGuild || !targetGuild) return;

  console.log('\n🔄 Syncing channel mappings...');
  channelMap.clear();

  let sourceChannels, targetChannels;
  try {
    sourceChannels = await sourceGuild.channels.fetch();
  } catch (e) {
    sourceChannels = sourceGuild.channels.cache;
  }
  try {
    targetChannels = await targetGuild.channels.fetch();
  } catch (e) {
    targetChannels = targetGuild.channels.cache;
  }

  const textSource = sourceChannels.filter(c => c && (c.type === 'GUILD_TEXT' || c.isTextBased?.()) && !c.isThread?.());
  const textTarget = targetChannels.filter(c => c && (c.type === 'GUILD_TEXT' || c.isTextBased?.()) && !c.isThread?.());

  let mappedCount = 0;

  for (const [sourceId, sourceChan] of textSource) {
    const matchedTarget = findTargetChannel(sourceChan, textTarget);
    if (matchedTarget) {
      channelMap.set(sourceId, matchedTarget);
      mappedCount++;
      console.log(`  ✅ Mapped: [#${sourceChan.name}] ➡️ [#${matchedTarget.name}]`);
    } else {
      console.log(`  ⚠️ Unmapped: [#${sourceChan.name}] (No matching channel in ${targetGuild.name})`);
    }
  }

  console.log(`✨ Sync Complete! Mapped ${mappedCount}/${textSource.size} channels.\n`);
}

function findTargetChannel(sourceChan, targetChannelsCollection) {
  const sourceClean = sanitizeName(sourceChan.name);
  const sourceCatClean = sourceChan.parent ? sanitizeName(sourceChan.parent.name) : '';

  const targetList = Array.from(targetChannelsCollection.values());

  if (sourceCatClean) {
    const tier1 = targetList.find(tc => {
      const tcClean = sanitizeName(tc.name);
      const tcCatClean = tc.parent ? sanitizeName(tc.parent.name) : '';
      return tcClean === sourceClean && tcCatClean === sourceCatClean;
    });
    if (tier1) return tier1;
  }

  const tier2 = targetList.find(tc => sanitizeName(tc.name) === sourceClean);
  if (tier2) return tier2;

  const tier3 = targetList.find(tc => {
    const tcClean = sanitizeName(tc.name);
    return tcClean.includes(sourceClean) || sourceClean.includes(tcClean);
  });
  if (tier3) return tier3;

  return null;
}

async function getWebhook(targetChannel) {
  if (webhookMap.has(targetChannel.id)) {
    return webhookMap.get(targetChannel.id);
  }

  try {
    const webhooks = await targetChannel.fetchWebhooks();
    let webhook = webhooks.find(wh => wh.owner && wh.owner.id === botClient.user.id);

    if (!webhook) {
      webhook = await targetChannel.createWebhook({
        name: 'Bernard-Forwarder',
        avatar: botClient.user.displayAvatarURL(),
        reason: 'Auto-forwarder webhook'
      });
      console.log(`⚓ Created webhook for #${targetChannel.name}`);
    }

    webhookMap.set(targetChannel.id, webhook);
    return webhook;
  } catch (err) {
    return null;
  }
}

async function forwardMessage(msg) {
  // Prevent loops from Bot itself
  if (msg.author.id === botClient.user.id) return;

  // Never forward messages sent within Target Guild (Bernard Server)
  if (targetGuild && msg.guildId === targetGuild.id) return;

  try {
    const sourceChannel = msg.channel;
    let targetChannel = channelMap.get(sourceChannel.id);

    if (!targetChannel && targetGuild) {
      let targetChannels;
      try {
        targetChannels = await targetGuild.channels.fetch();
      } catch(e) {
        targetChannels = targetGuild.channels.cache;
      }
      const textTargets = targetChannels.filter(c => c && (c.type === 'GUILD_TEXT' || c.isTextBased?.()) && !c.isThread?.());
      targetChannel = findTargetChannel(sourceChannel, textTargets);

      if (targetChannel) {
        channelMap.set(sourceChannel.id, targetChannel);
      }
    }

    if (!targetChannel) return;

    let rawContent = msg.content || '';

    // Handle Replies
    if (msg.reference && msg.reference.messageId) {
      try {
        const refMsg = await msg.channel.messages.fetch(msg.reference.messageId);
        if (refMsg) {
          const replyText = refMsg.content ? refMsg.content.slice(0, 60) : '[Attachment/Embed]';
          rawContent = `> ↩️ *Replying to **${refMsg.author.username}**: "${replyText.replace(/\n/g, ' ')}..."*\n${rawContent}`;
        }
      } catch (err) {}
    }

    // Apply Text Filtering & Replacements
    let content = sanitizeText(rawContent);

    // Handle Attachments
    const files = [];
    if (msg.attachments && msg.attachments.size > 0) {
      msg.attachments.forEach(att => files.push(att.url));
    }

    // Handle Stickers
    if (msg.stickers && msg.stickers.size > 0) {
      msg.stickers.forEach(s => files.push(s.url));
    }

    // Handle Embeds with Filtering
    const embeds = msg.embeds ? msg.embeds.map(e => sanitizeEmbed(e.toJSON ? e.toJSON() : e)) : [];

    let sentSuccess = false;

    if (config.USE_WEBHOOKS) {
      const webhook = await getWebhook(targetChannel);
      if (webhook) {
        try {
          await webhook.send({
            content: content || undefined,
            username: msg.author.displayName || msg.author.username,
            avatarURL: msg.author.displayAvatarURL ? msg.author.displayAvatarURL({ dynamic: true }) : msg.author.avatarURL,
            embeds: embeds.length > 0 ? embeds : undefined,
            files: files.length > 0 ? files : undefined,
          });
          sentSuccess = true;
        } catch (whErr) {}
      }
    }

    if (!sentSuccess) {
      const header = `📨 **[#${sourceChannel.name}]** **${msg.author.username}**:\n`;
      const fullText = content ? `${header}${content}` : header;

      await targetChannel.send({
        content: fullText,
        embeds: embeds.length > 0 ? embeds : undefined,
        files: files.length > 0 ? files : undefined,
      });
    }

    console.log(`🚀 [Forwarded & Filtered] [#${sourceChannel.name}] ➡️ [#${targetChannel.name}] (${msg.author.username})`);

  } catch (err) {
    console.error(`❌ Forward Error:`, err.message);
  }
}

// Bot Client Startup
botClient.once('clientReady', async () => {
  console.log(`===========================================`);
  console.log(`✅ Bot Logged In: ${botClient.user.tag}`);
  console.log(`===========================================`);

  const guilds = await botClient.guilds.fetch();
  targetGuild = botClient.guilds.cache.get(config.TARGET_GUILD_ID) || 
                botClient.guilds.cache.find(g => g.name.toLowerCase().includes(config.TARGET_GUILD_NAME.toLowerCase()));

  if (targetGuild) {
    console.log(`🎯 Target Server Ready: "${targetGuild.name}" (${targetGuild.id})`);
  }

  if (sourceGuild && targetGuild) {
    await syncChannelMappings();
  }
});

// Bot Client Message Listener (Responds to Admin Commands in Target Guild)
botClient.on('messageCreate', async (msg) => {
  if (!msg.guild) return;

  // Listen to Admin Commands in Target Guild (Bernard server)
  if (targetGuild && msg.guildId === targetGuild.id) {
    await handleAdminCommands(msg);
    return;
  }

  // Fallback if bot is in source guild without selfbot
  if (!selfClient && sourceGuild && msg.guildId === sourceGuild.id) {
    await forwardMessage(msg);
  }
});

// SelfClient (User Account Listener) Startup
if (selfClient) {
  selfClient.on('ready', async () => {
    console.log(`===========================================`);
    console.log(`👤 User Account Connected: ${selfClient.user.tag}`);
    console.log(`===========================================`);

    sourceGuild = selfClient.guilds.cache.find(g => g.name.toLowerCase().includes(config.SOURCE_GUILD_NAME.toLowerCase()));

    if (!sourceGuild) {
      console.error(`❌ User account "${selfClient.user.tag}" is not a member of "${config.SOURCE_GUILD_NAME}" server!`);
    } else {
      console.log(`🟢 Source Server Joined via User: "${sourceGuild.name}" (${sourceGuild.id})`);
      if (targetGuild) {
        await syncChannelMappings();
      }
    }
  });

  selfClient.on('messageCreate', async (msg) => {
    if (!msg.guild) return;
    if (sourceGuild && msg.guildId === sourceGuild.id) {
      await forwardMessage(msg);
    }
  });
}

/**
 * Handle Admin Commands in Target Guild (Bernard Server)
 */
async function handleAdminCommands(msg) {
  if (!msg.content.startsWith('!')) return;

  if (msg.content === '!sync') {
    await msg.reply('🔄 Resyncing channel mappings...');
    await syncChannelMappings();
    await msg.reply(`✅ Sync complete! ${channelMap.size} channels mapped.`);
  }

  if (msg.content === '!mappings') {
    if (channelMap.size === 0) {
      return msg.reply('📋 No channel mappings registered yet.');
    }
    let list = '📋 **Current Channel Mappings:**\n';
    channelMap.forEach((target, sourceId) => {
      list += `• <#${sourceId}> ➡️ <#${target.id}>\n`;
    });
    await msg.reply(list.slice(0, 1950));
  }

  if (msg.content === '!status') {
    await msg.reply(
      `🤖 **Forwarder Bot Status:**\n` +
      `• Source Server: ${sourceGuild ? sourceGuild.name : 'Not Found'}\n` +
      `• Target Server: ${targetGuild ? targetGuild.name : 'Not Found'}\n` +
      `• Mapped Channels: ${channelMap.size}\n` +
      `• Webhooks Enabled: ${config.USE_WEBHOOKS ? 'Yes' : 'No'}\n` +
      `• Text Sanitization: ${config.REMOVE_SOURCE_CONTACTS ? 'Active' : 'Disabled'}`
    );
  }

  if (msg.content === '!test') {
    await msg.reply('🧪 Forwarder connection test successful! Text replacement filter engine is active.');
  }
}

// Login Both
if (config.BOT_TOKEN) {
  botClient.login(config.BOT_TOKEN).catch(e => console.error('❌ Bot Login Error:', e.message));
}
if (selfClient) {
  selfClient.login(config.USER_TOKEN).catch(e => console.error('❌ User Account Login Error:', e.message));
}
