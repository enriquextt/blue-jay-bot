import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseIrcLine, toChatMessage } from '../server/chat/twitch.js';

function flatten(object, prefix = '') {
  return Object.entries(object).flatMap(([key, value]) => (
    typeof value === 'object' ? flatten(value, `${prefix}${key}.`) : [`${prefix}${key}`]
  ));
}

test('parseIrcLine separa etiquetas, prefijo, comando y texto', () => {
  const parsed = parseIrcLine('@badges=moderator/1;mod=1;display-name=Ana\\sB :ana!ana@ana.tmi.twitch.tv PRIVMSG #canal :!sr hola mundo');

  assert.equal(parsed.command, 'PRIVMSG');
  assert.deepEqual(parsed.params, ['#canal']);
  assert.equal(parsed.trailing, '!sr hola mundo');
  assert.equal(parsed.tags['display-name'], 'Ana B');
  assert.equal(parsed.prefix, 'ana!ana@ana.tmi.twitch.tv');
});

test('parseIrcLine entiende PING sin etiquetas ni prefijo', () => {
  const parsed = parseIrcLine('PING :tmi.twitch.tv');
  assert.equal(parsed.command, 'PING');
  assert.equal(parsed.trailing, 'tmi.twitch.tv');
});

test('toChatMessage normaliza el mensaje y detecta moderadores y propietario', () => {
  const line = (tags) => `@${tags} :ana!ana@ana.tmi.twitch.tv PRIVMSG #canal :!skip`;

  assert.deepEqual(toChatMessage(parseIrcLine(line('mod=0;badges='))), {
    platform: 'twitch', user: 'ana', text: '!skip', isMod: false,
  });
  assert.equal(toChatMessage(parseIrcLine(line('mod=1;badges=moderator/1'))).isMod, true);
  assert.equal(toChatMessage(parseIrcLine(line('mod=0;badges=broadcaster/1'))).isMod, true);
});

test('toChatMessage ignora lo que no es un mensaje de chat', () => {
  assert.equal(toChatMessage(parseIrcLine(':tmi.twitch.tv 001 bot :Welcome')), null);
  assert.equal(toChatMessage(parseIrcLine('PING :tmi.twitch.tv')), null);
});

test('es.json y en.json tienen exactamente las mismas claves', async () => {
  const load = async (locale) => JSON.parse(await readFile(new URL(`../public/locales/${locale}.json`, import.meta.url), 'utf8'));
  assert.deepEqual(flatten(await load('es')).sort(), flatten(await load('en')).sort());
});
