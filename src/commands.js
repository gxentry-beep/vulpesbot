import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
} from 'discord.js';
import { config, save } from './config.js';

export const PREFIX = ',';

const isOwner = (user) => user.id === config.ownerId;
const isAllowed = (user) => isOwner(user) || config.whitelist.includes(user.id);

export const verifyMessages = new Set();
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
  await cmd.run(msg);
}

function configPanel() {
  const e = new EmbedBuilder()
    .setTitle('Configuration')
    .setColor(0x2b2d31)
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
    .setColor(0x57f287);
  const sent = await msg.channel.send({ embeds: [e] });
  await sent.react('✅');
  verifyMessages.add(sent.id);
  if (verifyMessages.size > 512) verifyMessages.delete(verifyMessages.values().next().value);
}

async function mod(msg) {
  const member = msg.mentions.members.first();
  if (!member) return reply(msg, 'Ping a user: ,mod @user');
  const r = needRole(msg.guild, 'moderator');
  await member.roles.add(r);
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
    .setColor(0x5865f2);
  await msg.channel.send({ embeds: [e] });
}

async function mute(msg) {
  const member = msg.mentions.members.first();
  if (!member) return reply(msg, 'Ping a user: ,mute @user');
  const r = needRole(msg.guild, 'muted');
  await member.roles.add(r);
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

export async function onReactionAdd(reaction, user) {
  if (user.bot || reaction.emoji.name !== '✅' || !verifyMessages.has(reaction.messageId)) return;
  if (reaction.partial) await reaction.fetch();
  if (!verifyMessages.has(reaction.message.id)) return;
  const guild = reaction.message.guild;
  if (!guild) return;
  const member = guild.members.cache.get(user.id);
  if (!member) return;
  const r = role(guild, 'verified');
  if (!r || member.roles.cache.has(r.id)) return;
  await member.roles.add(r);
}

export async function handleButton(interaction) {
  if (interaction.user.id !== config.ownerId) {
    return interaction.reply({ content: 'Owner only.', ephemeral: true });
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
    return interaction.reply({ content: 'That is not a valid role ID.', ephemeral: true });
  }
  config.roles[key] = value || null;
  save();
  const panel = interaction.message;
  if (panel?.editable) await panel.edit({ embeds: [configPanel()] }).catch(() => {});
  await interaction.reply({
    content: `Saved ${key} role: ${value ? `<@&${value}>` : 'cleared'}`,
    ephemeral: true,
  });
}