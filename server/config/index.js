import { fileURLToPath } from 'node:url';

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3000),
  language: process.env.LANGUAGE ?? 'es',
  voteSkipThreshold: Number(process.env.VOTE_SKIP_THRESHOLD ?? 3),
  twitchCredentialsPath: fileURLToPath(new URL('../../data/twitch.json', import.meta.url)),
  youtubeCredentialsPath: fileURLToPath(new URL('../../data/youtube.json', import.meta.url)),
};
