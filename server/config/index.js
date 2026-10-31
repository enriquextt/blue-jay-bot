import { fileURLToPath } from 'node:url';

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  language: process.env.LANGUAGE ?? 'es',
  voteSkipThreshold: Number(process.env.VOTE_SKIP_THRESHOLD ?? 3),
  twitchCredentialsPath: fileURLToPath(new URL('../../data/twitch.json', import.meta.url)),
  youtubeCredentialsPath: fileURLToPath(new URL('../../data/youtube.json', import.meta.url)),
  baseListPath: fileURLToPath(new URL('../../data/baselist.json', import.meta.url)),
  blacklistPath: fileURLToPath(new URL('../../data/blacklist.json', import.meta.url)),
  databasePath: fileURLToPath(new URL('../../data/blue-jay.db', import.meta.url)),
  widgetAssetsPath: fileURLToPath(new URL('../../data/widget-assets', import.meta.url)),
  libraryConfigPath: fileURLToPath(new URL('../../data/library.json', import.meta.url)),
};
