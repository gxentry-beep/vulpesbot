import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { config, save } from './config.js';

export const PREFIX = ',';

const BLACK = 0x000000;
const RED = 0xed4245;

const isOwner = (user) => user.id === config.ownerId;
const isAllowed = (user) => isOwner(user) || config.whitelist.includes(user.id);

export const verifyMessages = new Set();
for (const id of config.verifyPanels) verifyMessages.add(id);
const snipeCache = new Map();
const SNIPE_PER_CHANNEL = 3;
const SNIPE_MAX = 300;

const ROLE_KEYS = [
  ['verified', 'Verified Role'],
  ['unverified', 'Unverified Role'],
  ['muted', 'Muted Role'],
  ['moderator', 'Moderator Role'],
];

export function role(guild, key) {
  const id = config.roles[key];
  return id ? guild.roles.cache.get(id) : null;
}

function needRole(guild, key) {
  const r = role(guild, key);
  if (!r) throw new Error(`Set the ${key} role ID first with ,configure`);
  return r;
}

async function reply(msg, text) {
  try {
    await msg.reply(text);
  } catch {}
}

export function onMessageDelete(message) {
  if (message.partial) return;
  verifyMessages.delete(message.id);
  const idx = config.verifyPanels.indexOf(message.id);
  if (idx !== -1) {
    config.verifyPanels.splice(idx, 1);
    save();
  }
  if (!message.author || message.author.bot) return;
  let list = snipeCache.get(message.channelId);
  if (!list) {
    list = [];
    snipeCache.set(message.channelId, list);
  }
  const attachment = message.attachments.first();
  list.push({
    content: message.content || (attachment ? `[attachment: ${attachment.url}]` : '[no text content]'),
    author: message.author.tag,
    avatar: message.author.displayAvatarURL({ size: 64 }),
    at: Date.now(),
  });
  if (list.length > SNIPE_PER_CHANNEL) list.shift();
  if (snipes.size > SNIPE_MAX) snipeCache.delete(snipeCache.keys().next().value);
}

export async function handleCommand(msg) {
  if (msg.author.bot || !msg.content.startsWith(PREFIX)) return;
  const body = msg.content.slice(PREFIX.length).trim();
  if (!body) return;
  const name = body.split(/\s+/)[0].toLowerCase();
  const cmd = commands[name];
  if (!cmd) return;
  if (!msg.inGuild()) return reply(msg, 'Guild only.');
  if (!cmd.allowed(msg.author)) return reply(msg, 'Not allowed.');
  try {
    await cmd.run(msg);
  } catch (err) {
    console.error('[cmd]', err);
    reply(msg, `Error: ${err.message}`).catch(() => {});
  } finally {
    msg.delete().catch(() => {});
  }
}

function configPanel() {
  const e = new EmbedBuilder()
    .setTitle('Configuration')
    .setColor(BLACK)
    .setDescription('Click a button to set that role ID. Each save persists immediately.');
  for (const [key, label] of ROLE_KEYS) {
    e.addFields({ name: label, value: config.roles[key] ? `<@&${config.roles[key]}>` : 'Not set', inline: true });
  }
  return e;
}

async function configure(msg) {
  const row = new ActionRowBuilder().addComponents(
    ROLE_KEYS.map(
      ([key, label]) =>
        new ButtonBuilder().setCustomId(`cfg:${key}`).setLabel(label).setStyle(ButtonStyle.Secondary)
    )
  );
  await msg.channel.send({ embeds: [configPanel()], components: [row] });
}

async function verify(msg) {
  const e = new EmbedBuilder()
    .setTitle('Verification')
    .setDescription('Click the ✅ reaction below to verify yourself.')
    .setFooter({ text: 'verify' })
    .setColor(BLACK);
  const sent = await msg.channel.send({ embeds: [e] });
  await sent.react('✅');
  verifyMessages.add(sent.id);
  if (!config.verifyPanels.includes(sent.id)) {
    config.verifyPanels.push(sent.id);
    if (config.verifyPanels.length > 512) config.verifyPanels.shift();
    save();
  }
  console.log(`[verify] panel posted ${sent.id}`);
  if (verifyMessages.size > 512) verifyMessages.delete(verifyMessages.values().next().value);
}

async function resolveMention(msg) {
  const cached = msg.mentions.members.first();
  if (cached) return cached;
  const u = msg.mentions.users.first();
  if (!u) return null;
  return msg.guild.members.fetch(u.id).catch(() => null);
}

async function mod(msg) {
  const member = await resolveMention(msg);
  if (!member) return reply(msg, 'Ping a user: ,mod @user');
  const r = needRole(msg.guild, 'moderator');
  await member.roles.add(r, 'mod');
  await reply(msg, `Modded ${member}`);
}

async function whitelist(msg) {
  const members = msg.mentions.members;
  if (!members.size) return reply(msg, 'Ping a user: ,whitelist @user');
  let added = 0;
  for (const m of members.values()) {
    if (!config.whitelist.includes(m.id)) {
      config.whitelist.push(m.id);
      added++;
    }
  }
  if (added) save();
  await reply(msg, `Whitelisted ${added} user(s).`);
}

async function lock(msg) {
  const ch = msg.channel;
  await ch.permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: false });
  const v = role(msg.guild, 'verified');
  if (v) await ch.permissionOverwrites.edit(v, { SendMessages: false });
  await reply(msg, `Locked ${ch}`);
}

async function unlock(msg) {
  const ch = msg.channel;
  await ch.permissionOverwrites.edit(msg.guild.roles.everyone, { SendMessages: null });
  const v = role(msg.guild, 'verified');
  if (v) await ch.permissionOverwrites.edit(v, { SendMessages: null });
  await reply(msg, `Unlocked ${ch}`);
}

async function renew(msg) {
  const ch = msg.channel;
  const guild = msg.guild;
  const overwrites = ch.permissionOverwrites.cache.map((o) => ({
    id: o.id,
    allow: o.allow.bitfield,
    deny: o.deny.bitfield,
  }));
  const base = {
    name: ch.name,
    parent: ch.parentId ?? undefined,
    permissionOverwrites: overwrites,
    position: ch.position,
  };
  let extra = {};
  if (ch.type === ChannelType.GuildText) {
    extra = { topic: ch.topic, nsfw: ch.nsfw, rateLimitPerUser: ch.rateLimitPerUser };
    if (ch.defaultAutoArchiveDuration) extra.defaultAutoArchiveDuration = ch.defaultAutoArchiveDuration;
  } else if (ch.type === ChannelType.GuildAnnouncement) {
    extra = { topic: ch.topic, nsfw: ch.nsfw };
    if (ch.defaultAutoArchiveDuration) extra.defaultAutoArchiveDuration = ch.defaultAutoArchiveDuration;
  } else if (ch.type === ChannelType.GuildVoice) {
    extra = { bitrate: ch.bitrate, userLimit: ch.userLimit };
    if (ch.videoQualityMode) extra.videoQualityMode = ch.videoQualityMode;
    if (ch.rtcRegion) extra.rtcRegion = ch.rtcRegion;
  } else if (ch.type === ChannelType.GuildStageVoice) {
    extra = { bitrate: ch.bitrate, userLimit: ch.userLimit };
    if (ch.rtcRegion) extra.rtcRegion = ch.rtcRegion;
  } else {
    return reply(msg, 'Unsupported channel type');
  }
  const copy = await guild.channels.create({ ...base, ...extra });
  await ch.delete('renew');
  await copy.send(`Renewed ${copy}`).catch(() => {});
}

async function snipes(msg) {
  const list = snipeCache.get(msg.channelId);
  const entry = list?.[list.length - 1];
  if (!entry) return reply(msg, 'Nothing to snipe here.');
  const e = new EmbedBuilder()
    .setAuthor({ name: entry.author, iconURL: entry.avatar })
    .setDescription(entry.content.slice(0, 4000))
    .setFooter({ text: `Deleted ${Math.max(1, Math.round((Date.now() - entry.at) / 1000))}s ago` })
    .setColor(RED);
  await msg.channel.send({ embeds: [e] });
}

async function mute(msg) {
  const member = await resolveMention(msg);
  if (!member) return reply(msg, 'Ping a user: ,mute @user');
  const r = needRole(msg.guild, 'muted');
  await member.roles.add(r, 'mute');
  await reply(msg, `Muted ${member}`);
}

const commands = {
  configure: { run: configure, allowed: isOwner },
  verify: { run: verify, allowed: isOwner },
  mod: { run: mod, allowed: isOwner },
  whitelist: { run: whitelist, allowed: isOwner },
  lock: { run: lock, allowed: isAllowed },
  unlock: { run: unlock, allowed: isAllowed },
  renew: { run: renew, allowed: isAllowed },
  snipes: { run: snipes, allowed: isAllowed },
  mute: { run: mute, allowed: isAllowed },
};

async function resolvePanel(reaction) {
  let message = reaction.message;
  if (verifyMessages.has(message.id)) return message;
  if (message.author && !message.author.bot) return null;
  if (reaction.partial) await reaction.fetch();
  if (message.partial) await message.fetch();
  message = reaction.message;
  if (!message.embeds.some((e) => e.footer?.text === 'verify' || e.title === 'Verification')) return null;
  verifyMessages.add(message.id);
  if (!config.verifyPanels.includes(message.id)) {
    config.verifyPanels.push(message.id);
    if (config.verifyPanels.length > 512) config.verifyPanels.shift();
    save();
  }
  return message;
}

export async function onReactionAdd(reaction, user) {
  if (user.bot || reaction.emoji.name !== '✅') return;
  let message;
  try {
    message = await resolvePanel(reaction);
  } catch (err) {
    return console.error('[verify] fetch failed:', err.message);
  }
  if (!message) return;
  const guild = message.guild;
  if (!guild) return;
  let member = guild.members.cache.get(user.id);
  if (!member) member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return console.error('[verify] member not found:', user.id);
  const r = role(guild, 'verified');
  if (!r) return console.error('[verify] verified role not configured, run ,configure');
  if (member.roles.cache.has(r.id)) {
    reaction.users.remove(user.id).catch(() => {});
    return;
  }
  try {
    await member.roles.add(r, 'verification');
    console.log(`[verify] granted ${r.name} to ${user.tag}`);
  } catch (err) {
    console.error('[verify] role add failed:', err.message);
  }
}

export async function onReactionRemove(reaction, user) {
  if (user.bot || reaction.emoji.name !== '✅') return;
  let message;
  try {
    message = await resolvePanel(reaction);
  } catch (err) {
    return console.error('[unverify] fetch failed:', err.message);
  }
  if (!message) return;
  const guild = message.guild;
  if (!guild) return;
  let member = guild.members.cache.get(user.id);
  if (!member) member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return console.error('[unverify] member not found:', user.id);
  const verifiedRole = role(guild, 'verified');
  const unverifiedRole = role(guild, 'unverified');
  if (!verifiedRole && !unverifiedRole) return console.error('[unverify] no roles configured, run ,configure');
  if (verifiedRole && member.roles.cache.has(verifiedRole.id)) {
    await member.roles
      .remove(verifiedRole, 'unverified')
      .catch((err) => console.error('[unverify] verified remove failed:', err.message));
  }
  if (unverifiedRole && !member.roles.cache.has(unverifiedRole.id)) {
    await member.roles
      .add(unverifiedRole, 'unverified')
      .catch((err) => console.error('[unverify] unverified add failed:', err.message));
  }
  console.log(`[unverify] unverified ${member.user.tag}`);
}

export async function handleButton(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: 'Owner only.', flags: MessageFlags.Ephemeral });
  }
  const m = /^cfg:(verified|unverified|muted|moderator)$/.exec(interaction.customId);
  if (!m) return;
  const key = m[1];
  const input = new TextInputBuilder()
    .setCustomId('value')
    .setLabel(`${key} role ID`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('123456789012345678')
    .setRequired(false);
  if (config.roles[key]) input.setValue(config.roles[key]);
  const modal = new ModalBuilder()
    .setCustomId(`cfgmodal:${key}`)
    .setTitle(`Set ${key} role`)
    .addComponents(new ActionRowBuilder().addComponents(input));
  await interaction.showModal(modal);
}

export async function handleModal(interaction) {
  if (interaction.user.id !== config.ownerId) return;
  const m = /^cfgmodal:(verified|unverified|muted|moderator)$/.exec(interaction.customId);
  if (!m) return;
  const key = m[1];
  const value = interaction.fields.getTextInputValue('value').trim();
  if (value && !/^\d{17,20}$/.test(value)) {
    return interaction.reply({ content: 'That is not a valid role ID.', flags: MessageFlags.Ephemeral });
  }
  config.roles[key] = value || null;
  save();
  const panel = interaction.message;
  if (panel?.editable) await panel.edit({ embeds: [configPanel()] }).catch(() => {});
  await interaction.reply({
    content: `Saved ${key} role: ${value ? `<@&${value}>` : 'cleared'}`,
    flags: MessageFlags.Ephemeral,
  });
}