//every Redis key starts with {av}: the braces are a hash tag, so all keys live in the same slot.
//Azure Managed Redis is clustered and MULTI / Lua scripts with several keys only work inside one slot
export const k = (name) => `{av}:${name}`;
