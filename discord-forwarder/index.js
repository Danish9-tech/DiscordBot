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

function isTicketChannel(chan) {
  if (!chan || !chan.name) return false;
  const name = chan.name.toLowerCase().trim();

  // Allow the single create-ticket panel in Bernard server
  if (name === 'create-ticket') return false;

  // Match individual ticket channels (e.g. ticket-2330, closed-2416, ticket2330, closed2416)
  if (/^(ticket|closed)[-_]?\d+/i.test(name)) return true;
  if (name.startsWith('ticket-') || name.startsWith('closed-')) return true;

  // Match category names
  if (name.includes('closed tickets') || name.includes('open tickets')) return true;

  // Check parent category
  if (chan.parent) {
    const pName = chan.parent.name.toLowerCase().trim();
    if (pName.includes('closed tickets') || pName.includes('open tickets')) return true;
  }

  return false;
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
    // Skip ticket channels and categories completely
    if (isTicketChannel(sourceChan)) {
      console.log(`  ⏩ Skipped Ticket Channel: [#${sourceChan.name}]`);
      continue;
    }

    let matchedTarget = findTargetChannel(sourceChan, textTarget);

    if (!matchedTarget && config.AUTO_CREATE_MISSING_CHANNELS) {
      matchedTarget = await autoCreateTargetChannel(sourceChan);
    }

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

  if (isTicketChannel(sourceChan)) {
    return null;
  }

  try {


    let parentCategory = null;

    if (sourceChan.parent) {
      const catClean = sanitizeName(sourceChan.parent.name);
      let tChans;
      try {
        tChans = await targetGuild.channels.fetch();
      } catch(e) {
        tChans = targetGuild.channels.cache;
      }
      const existingCats = tChans.filter(c => c && (c.type === 'GUILD_CATEGORY' || c.type === 4));
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

async function forwardMessage(msg, options = {}) {
  // Prevent loops from Bot itself
  if (botClient.user && msg.author.id === botClient.user.id) return;

  // Never forward messages sent within Target Guild (Bernard Server)
  if (targetGuild && msg.guildId === targetGuild.id) return;

  try {
    const sourceChannel = msg.channel;
    const sourceNameClean = sanitizeName(sourceChannel.name);

    // Ignore channels listed in IGNORE_CHANNELS
    if (Array.isArray(config.IGNORE_CHANNELS) && config.IGNORE_CHANNELS.length > 0) {
      const isIgnored = config.IGNORE_CHANNELS.some(ignored => {
        const ignoredClean = sanitizeName(ignored);
        return sourceNameClean.includes(ignoredClean) || ignoredClean.includes(sourceNameClean);
      });
      if (isIgnored) return;
    }

    let targetChannel = channelMap.get(sourceChannel.id);

    if (!targetChannel && targetGuild) {
      let targetChannels;
      try {
        targetChannels = await targetGuild.channels.fetch();
      } catch (e) {
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

    if (!targetChannel) {
      console.log(`⚠️ No target channel found for #${sourceChannel.name}`);
      return;
    }

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

    if (config.ADD_PING_TAG && typeof config.ADD_PING_TAG === 'string' && config.ADD_PING_TAG.trim() && !options.skipWhatsApp) {
      const pingStr = config.ADD_PING_TAG.trim();
      if (!content.includes(pingStr)) {
        content = content ? `${content}\n${pingStr}` : pingStr;
      }
    }

    // Handle Embeds with Filtering
    const embeds = msg.embeds ? msg.embeds.map(e => sanitizeEmbed(e.toJSON ? e.toJSON() : e)) : [];

    // 1. FIRST: Forward to Discord Target Channel (Bernard Server)
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
        } catch (whErr) {
          console.error(`❌ Webhook Send Error for #${targetChannel.name}:`, whErr.message);
        }
      }
    }

    if (!sentSuccess) {
      try {
        const header = `📨 **[#${sourceChannel.name}]** **${msg.author.username}**:\n`;
        const fullText = content ? `${header}${content}` : header;

        let chanToSend = targetChannel;
        if (botClient) {
          try {
            chanToSend = await botClient.channels.fetch(targetChannel.id);
          } catch (e) {
            chanToSend = targetChannel;
          }
        }

        await chanToSend.send({
          content: fullText,
          embeds: embeds.length > 0 ? embeds : undefined,
          files: files.length > 0 ? files : undefined,
          allowedMentions: { parse: ['everyone', 'roles', 'users'] }
        });
        sentSuccess = true;
      } catch (sendErr) {
        console.error(`❌ Direct Send Error for #${targetChannel.name}:`, sendErr.message);
      }
    }

    if (sentSuccess) {
      console.log(`🚀 [Forwarded & Filtered] [#${sourceChannel.name}] ➡️ [#${targetChannel.name}] (${msg.author.username})`);
    }

    // 2. SECOND: Forward to WhatsApp Group ONLY if NOT skipped and ENABLED
    if (!options.skipWhatsApp && config.ENABLE_WHATSAPP && waReady && waSock && config.WHATSAPP_GROUP_ID) {
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
        console.log(`📱 [WhatsApp Forwarded] [#${sourceChannel.name}] ➡️ WhatsApp Group`);
      } catch (waErr) {
        console.error(`❌ WhatsApp Forward Error:`, waErr.message);
      }
    }

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
    await cleanTicketChannels();
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

    // Handle Admin commands sent in Bernard Server via User Account as well
    if (targetGuild && msg.guildId === targetGuild.id) {
      if (msg.content.startsWith('!')) {
        await handleAdminCommands(msg);
        return;
      }
    }

    if (sourceGuild && msg.guildId === sourceGuild.id) {
      await forwardMessage(msg);
    }
  });


  selfClient.on('channelCreate', async (chan) => {
    if (chan.guild && sourceGuild && chan.guild.id === sourceGuild.id) {
      const cClean = sanitizeName(chan.name);
      if (cClean.startsWith('ticket-') || cClean.startsWith('closed-')) return;
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

  if (msg.content === '!cleantickets') {
    await msg.reply('🧹 Cleaning up old ticket channels in Bernard server...');
    await cleanTicketChannels();
    await msg.reply('✅ Old ticket channels cleaned up successfully!');
  }

  if (msg.content === '!copycourses') {
    await msg.reply('📚 Starting full historical copy for all Course channels... This may take a few minutes!');
    await copyCourseChannels(msg);
  }

  if (msg.content === '!test') {
    await msg.reply('🧪 Forwarder connection test successful! Text replacement filter engine is active.');
  }
}

let isCopyingHistory = false;

async function copyCourseChannels(statusMsg) {
  if (isCopyingHistory) {
    if (statusMsg) await statusMsg.reply('⏳ History copy is already in progress. Please wait for it to complete!');
    return;
  }

  if (!targetGuild) {
    console.error('❌ Target Guild (Bernard Server) not ready.');
    if (statusMsg) await statusMsg.reply('❌ Target Guild (Bernard Server) not ready.');
    return;
  }

  isCopyingHistory = true;

  try {
    const targetCourseNames = [
      'waqar-zaka-basic-course',
      'waqar-zaka-advance-course',
      'faizan-haroon-private-course',
      'candle-and-chart-patterns',
      'chuff-gang-lectures'
    ];

    let sGuild = sourceGuild;
    if (!sGuild && selfClient) {
      sGuild = Array.from(selfClient.guilds.cache.values()).find(g => 
        g.name.toLowerCase().includes(config.SOURCE_GUILD_NAME.toLowerCase())
      );
    }

    if (!sGuild) {
      console.error(`❌ Source server "${config.SOURCE_GUILD_NAME}" not found.`);
      if (statusMsg) await statusMsg.reply(`❌ Source server "${config.SOURCE_GUILD_NAME}" not found.`);
      return;
    }

    let sourceChannels;
    try {
      sourceChannels = await sGuild.channels.fetch();
    } catch (e) {
      sourceChannels = sGuild.channels.cache;
    }

    for (const name of targetCourseNames) {
      const cleanSearchName = sanitizeName(name);
      const sourceChan = sourceChannels.find(c => c && sanitizeName(c.name) === cleanSearchName);
      const targetChan = channelMap.get(sourceChan ? sourceChan.id : '') || 
                         targetGuild.channels.cache.find(c => sanitizeName(c.name) === cleanSearchName);

      if (!sourceChan || !targetChan) {
        console.log(`⚠️ Skipping course channel "${name}": Source or Target channel not found.`);
        if (statusMsg) await statusMsg.channel.send(`⚠️ Skipping course channel "${name}": Not found in source or target server.`);
        continue;
      }

      if (statusMsg) await statusMsg.channel.send(`📥 Copying complete history for **#${sourceChan.name}**...`);
      await fetchAndForwardAllHistory(sourceChan, targetChan);
      if (statusMsg) await statusMsg.channel.send(`✅ Completed copying history for **#${sourceChan.name}**!`);
    }

    if (statusMsg) await statusMsg.channel.send(`🎉 **All course channels have been fully copied into Bernard server!**`);
  } catch (err) {
    console.error(`❌ copyCourseChannels error:`, err.message);
    if (statusMsg) await statusMsg.channel.send(`❌ Error copying courses: ${err.message}`);
  } finally {
    isCopyingHistory = false;
  }
}

async function fetchAndForwardAllHistory(sourceChan, targetChan) {
  let lastId = null;
  let allMessages = [];
  console.log(`📥 Fetching full history from Trading Mafia #${sourceChan.name}...`);

  // Ensure source channel object is fetched via selfClient if possible
  let srcChannelObj = sourceChan;
  if (selfClient) {
    try {
      srcChannelObj = await selfClient.channels.fetch(sourceChan.id);
    } catch (e) {
      srcChannelObj = selfClient.channels.cache.get(sourceChan.id) || sourceChan;
    }
  }

  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    let fetched;
    try {
      fetched = await srcChannelObj.messages.fetch(options);
    } catch (err) {
      console.error(`❌ Fetch history error for #${sourceChan.name}:`, err.message);
      break;
    }

    if (!fetched || fetched.size === 0) break;

    const msgList = Array.from(fetched.values());
    allMessages.push(...msgList);
    lastId = msgList[msgList.length - 1].id;

    console.log(`  Fetched ${allMessages.length} messages so far from #${sourceChan.name}...`);

    if (fetched.size < 100) break;
    await new Promise(r => setTimeout(r, 800));
  }

  // Sort messages chronologically (oldest first)
  allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  console.log(`🚀 Forwarding ${allMessages.length} past messages to #${targetChan.name} in Bernard server...`);

  for (let i = 0; i < allMessages.length; i++) {
    const msg = allMessages[i];
    await forwardHistoryMessage(msg, targetChan);
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log(`✨ Completed forwarding for #${sourceChan.name}!`);
}

async function forwardHistoryMessage(msg, targetChan) {
  try {
    let rawContent = msg.content || '';
    let content = sanitizeText(rawContent);

    // Collect attachment & sticker URLs (pictures, videos, PDFs, etc.)
    const files = [];
    if (msg.attachments && msg.attachments.size > 0) {
      msg.attachments.forEach(att => files.push(att.url));
    }
    if (msg.stickers && msg.stickers.size > 0) {
      msg.stickers.forEach(s => files.push(s.url));
    }

    const embeds = msg.embeds ? msg.embeds.map(e => sanitizeEmbed(e.toJSON ? e.toJSON() : e)) : [];

    const header = `📨 **[${msg.author ? msg.author.username : 'Course Note'}]** (${new Date(msg.createdTimestamp).toLocaleDateString()}):\n`;
    let fullText = content ? `${header}${content}` : header;

    let chanToSend = targetChan;
    if (botClient) {
      try {
        chanToSend = await botClient.channels.fetch(targetChan.id);
      } catch (e) {
        chanToSend = targetChan;
      }
    }

    try {
      await chanToSend.send({
        content: fullText.slice(0, 1990),
        embeds: embeds.length > 0 ? embeds : undefined,
        files: files.length > 0 ? files : undefined,
        allowedMentions: { parse: ['everyone', 'roles', 'users'] }
      });
    } catch (sendErr) {
      console.warn(`⚠️ Attachment re-upload error for #${targetChan.name}, sending as links:`, sendErr.message);
      if (files.length > 0) {
        fullText += '\n' + files.join('\n');
      }
      await chanToSend.send({
        content: fullText.slice(0, 1990),
        embeds: embeds.length > 0 ? embeds : undefined,
        allowedMentions: { parse: ['everyone', 'roles', 'users'] }
      });
    }

  } catch (err) {
    console.error(`❌ Failed to forward past message in #${targetChan.name}:`, err.message);
  }
}





async function cleanTicketChannels() {
  if (!targetGuild) return;
  try {
    const channels = await targetGuild.channels.fetch();

    const ticketChans = channels.filter(c => c && (c.type === 'GUILD_TEXT' || c.isTextBased?.()) && isTicketChannel(c));
    const ticketCats = channels.filter(c => c && (c.type === 'GUILD_CATEGORY' || c.type === 4) && isTicketChannel(c));

    if (ticketChans.size > 0 || ticketCats.size > 0) {
      console.log(`🧹 Found ${ticketChans.size} ticket channels and ${ticketCats.size} ticket categories in Bernard server. Deleting...`);

      for (const [id, chan] of ticketChans) {
        try {
          await chan.delete('Cleanup ticket channel');
          console.log(`  🗑️ Deleted ticket channel: #${chan.name}`);
        } catch (e) {
          console.error(`  ❌ Failed to delete #${chan.name}:`, e.message);
        }
      }

      for (const [id, cat] of ticketCats) {
        try {
          await cat.delete('Cleanup ticket category');
          console.log(`  🗑️ Deleted ticket category: "${cat.name}"`);
        } catch (e) {
          console.error(`  ❌ Failed to delete category "${cat.name}":`, e.message);
        }
      }

      console.log(`✨ Ticket cleanup complete!\n`);
    }
  } catch (err) {
    console.error('❌ Ticket channel cleanup error:', err.message);
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

