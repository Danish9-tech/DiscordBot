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

let waSock = null;
let waReady = false;

async function initWhatsApp() {
  if (!config.ENABLE_WHATSAPP) return;

  try {
    const { makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
    const qrcode = require('qrcode-terminal');

    const authDir = path.join(__dirname, 'whatsapp_auth');
    const { state, saveCreds } = await useMultiFileAuthState(authDir);

    waSock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
    });

    waSock.ev.on('creds.update', saveCreds);

    waSock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log('\n===========================================');
        console.log('📱 SCAN WHATSAPP QR CODE BELOW WITH YOUR PHONE:');
        console.log('===========================================');
        qrcode.generate(qr, { small: true });
        console.log('===========================================\n');
      }

      if (connection === 'close') {
        waReady = false;
        const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
        console.log('📱 WhatsApp Connection Closed. Reconnecting:', shouldReconnect);
        if (shouldReconnect) {
          setTimeout(initWhatsApp, 5000);
        }
      } else if (connection === 'open') {
        waReady = true;
        console.log('===========================================');
        console.log('🟢 WhatsApp Engine Successfully Connected!');
        console.log('===========================================');

        waSock.groupFetchAllParticipating().then(groups => {
          console.log('\n📋 Your Available WhatsApp Groups:');
          Object.values(groups).forEach(g => {
            console.log(`  🔹 Group Name: "${g.subject}" | ID: "${g.id}"`);
          });
          if (config.WHATSAPP_GROUP_ID) {
            console.log(`\n🎯 WhatsApp Signals Target Group ID: "${config.WHATSAPP_GROUP_ID}"\n`);
          } else {
            console.log('\n⚠️ Set "WHATSAPP_GROUP_ID" in config.json with one of the Group IDs above!\n');
          }
        }).catch(() => {});
      }
    });
  } catch (err) {
    console.error('❌ Failed to initialize WhatsApp:', err.message);
  }
}

initWhatsApp();


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

async function autoCreateTargetChannel(sourceChan) {
  if (!targetGuild || !config.AUTO_CREATE_MISSING_CHANNELS) return null;

  try {
    let parentCategory = null;

    if (sourceChan.parent) {
      const catClean = sanitizeName(sourceChan.parent.name);
      const existingCats = targetGuild.channels.cache.filter(c => (c.type === 'GUILD_CATEGORY' || c.type === 4));
      parentCategory = existingCats.find(c => sanitizeName(c.name) === catClean);

      if (!parentCategory) {
        parentCategory = await targetGuild.channels.create({
          name: sourceChan.parent.name,
          type: 4, // GUILD_CATEGORY
        });
        console.log(`📁 Auto-created category "${parentCategory.name}" in Bernard server`);
      }
    }

    const newChan = await targetGuild.channels.create({
      name: sourceChan.name,
      type: 0, // GUILD_TEXT
      parent: parentCategory ? parentCategory.id : undefined,
      topic: sourceChan.topic || undefined
    });

    console.log(`✨ Auto-created new channel #${newChan.name} in Bernard server`);
    channelMap.set(sourceChan.id, newChan);
    return newChan;
  } catch (err) {
    console.error(`❌ Auto-create channel error for #${sourceChan.name}:`, err.message);
    return null;
  }
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
      } else if (config.AUTO_CREATE_MISSING_CHANNELS) {
        targetChannel = await autoCreateTargetChannel(sourceChannel);
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

    // 📱 Forward to WhatsApp Group if enabled (Independent of Discord Target Channel)
    if (config.ENABLE_WHATSAPP && waReady && waSock && config.WHATSAPP_GROUP_ID) {
      try {
        const waHeader = `📌 *[#${sourceChannel.name.toUpperCase()}]*\n\n`;
        let waText = content ? `${waHeader}${content}` : waHeader;
        waText = waText.replace(/@everyone/g, '').replace(/@here/g, '').trim();

        if (files.length > 0) {
          for (const fileUrl of files) {
            if (fileUrl.match(/\.(jpeg|jpg|png|gif|webp)$/i)) {
              await waSock.sendMessage(config.WHATSAPP_GROUP_ID, { image: { url: fileUrl }, caption: waText });
            } else {
              await waSock.sendMessage(config.WHATSAPP_GROUP_ID, { text: waText });
            }
          }
        } else {
          await waSock.sendMessage(config.WHATSAPP_GROUP_ID, { text: waText });
        }
        console.log(`📱 [WhatsApp Forwarded] [#${sourceChannel.name}] ➡️ WhatsApp Group (${msg.author.username})`);
      } catch (waErr) {
        console.error(`❌ WhatsApp Forward Error:`, waErr.message);
      }
    }

    if (config.ADD_PING_TAG && typeof config.ADD_PING_TAG === 'string' && config.ADD_PING_TAG.trim()) {
      const pingStr = config.ADD_PING_TAG.trim();
      if (!content.includes(pingStr)) {
        content = content ? `${content}\n${pingStr}` : pingStr;
      }
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
            allowedMentions: { parse: ['everyone', 'roles', 'users'] }
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
        allowedMentions: { parse: ['everyone', 'roles', 'users'] }
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

    const joinedGuilds = Array.from(selfClient.guilds.cache.values());
    console.log(`📋 User account is in ${joinedGuilds.length} servers:`, joinedGuilds.map(g => `"${g.name}" (${g.id})`).join(', '));

    sourceGuild = (config.SOURCE_GUILD_ID ? selfClient.guilds.cache.get(config.SOURCE_GUILD_ID) : null) ||
                  selfClient.guilds.cache.find(g => 
                    g.name.toLowerCase().includes(config.SOURCE_GUILD_NAME.toLowerCase()) ||
                    config.SOURCE_GUILD_NAME.toLowerCase().includes(g.name.toLowerCase())
                  );

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

  selfClient.on('channelCreate', async (chan) => {
    if (chan.guild && sourceGuild && chan.guild.id === sourceGuild.id) {
      console.log(`🆕 New channel detected in Trading Mafia: #${chan.name}`);
      await autoCreateTargetChannel(chan);
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
const cleanBotToken = (config.BOT_TOKEN || '').trim().replace(/^["']|["']$/g, '');
const cleanUserToken = (config.USER_TOKEN || '').trim().replace(/^["']|["']$/g, '');

if (cleanBotToken) {
  botClient.login(cleanBotToken).catch(e => console.error('❌ Bot Login Error:', e.message));
}
if (selfClient && cleanUserToken) {
  selfClient.login(cleanUserToken).catch(e => console.error('❌ User Account Login Error:', e.message));
}

