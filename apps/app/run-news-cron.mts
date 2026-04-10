// biome-ignore-all lint/suspicious/noConsole: dev script
import mongoose from 'mongoose';

import { NewsCronService } from './src/features/news/server/services/news-cron-service.js';

const MONGO_URI = process.env.MONGO_URI ?? 'mongodb://mongo:27017/growi';
process.env.NEWS_FEED_URL ??= 'http://localhost:8099/feed.json';
process.env.GROWI_SKIP_NEWS_SLEEP = 'true';

console.log(`Connecting to ${MONGO_URI}...`);
await mongoose.connect(MONGO_URI);
console.log('Connected. Running cron job...');

await new NewsCronService().executeJob();

console.log('Done.');
await mongoose.disconnect();
