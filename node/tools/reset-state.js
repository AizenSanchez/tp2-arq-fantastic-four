//leaves the Redis state as new: deletes every {av}:* key and seeds again from state/*.json
//usage: node tools/reset-state.js   (reads REDIS_URL or node/infra.json, like the app)
import { createClient } from "redis";

import config from "../config.js";
import { k } from "../keys.js";
import { createRedisAdapter } from "../repository/redis-adapter.js";

if (!config.redisUrl) {
  console.error("no Redis url: set REDIS_URL or node/infra.json");
  process.exit(1);
}

const client = createClient({ url: config.redisUrl });
client.on("error", (err) => console.error("Redis error:", err));
await client.connect();

let deleted = 0;
for await (const keys of client.scanIterator({ MATCH: k("*"), COUNT: 500 })) {
  //keys of one slot, so one DEL can carry several of them
  if (keys.length) deleted += await client.del(keys);
}
await client.quit();

//the adapter seeds on creation (SET NX seeded), now that nothing is there
const repository = await createRedisAdapter(config.redisUrl);
await repository.close();

console.log(`reset: ${deleted} keys deleted, state seeded again`);
