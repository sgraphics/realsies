// Friendly copy for relay codes that are not the player's fault (shown as calm notes, never as red errors).

/**
 * bots_unavailable on a search: the bots are out of NEAR AI credits, so the relay starts no new chats at
 * all (human to human included: if the bots were known to be down, every match would be a known human).
 * The search ends and the seat goes back. The note says only that new chats are paused, nothing about who
 * else might be around.
 */
export const BOTS_NAPPING = 'The bots are napping. New chats are paused for a few minutes; chats already running finish as normal.';
