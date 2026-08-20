import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client, Events, GatewayIntentBits, Partials, ActivityType } from 'discord.js';
import { config, saveNow } from './config.js';
import { PREFIX, handleCommand, handleButton, handleModal, onMessageDelete, onReactionAdd, onReactionRemove } from './commands.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const token = readFileSync(join(__dirname, '..', 'token.txt'), 'utf8').trim();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
});

client.once(Events.ClientReady, (c) => {
  c.user.setActivity(`prefix ${PREFIX}`, { type: ActivityType.Watching });
  console.log(`[bot] ready as ${c.user.tag}`);
});

client.on(Events.MessageCreate, (msg) => {
  handleCommand(msg).catch((err) => console.error('[cmd]', err));
});

client.on(Events.MessageDelete, onMessageDelete);

client.on(Events.MessageReactionAdd, (reaction, user) => {
  onReactionAdd(reaction, user).catch((err) => console.error('[verify]', err));
});

client.on(Events.MessageReactionRemove, (reaction, user) => {
  onReactionRemove(reaction, user).catch((err) => console.error('[unverify]', err));
});

client.on(Events.GuildMemberAdd, (member) => {
  const id = config.roles.unverified;
  if (!id) return console.error('[join] unverified role not configured, run ,configure');
  member.roles.add(id, 'auto role on join').then(
    () => console.log(`[join] gave unverified to ${member.user.tag}`),
    (err) => console.error('[join] role add failed:', err.message)
  );
});

client.on(Events.InteractionCreate, (interaction) => {
  if (interaction.isButton()) handleButton(interaction).catch((err) => console.error('[btn]', err));
  else if (interaction.isModalSubmit()) handleModal(interaction).catch((err) => console.error('[modal]', err));
});

client.on(Events.Error, (err) => console.error('[ws]', err));
process.on('unhandledRejection', (err) => console.error('[unhandled]', err));

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    saveNow();
    client.destroy();
    process.exit(0);
  });
}

client.login(token);