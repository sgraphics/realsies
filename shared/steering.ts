// Steering catalogue steer-v1: the only text the relay may add to a bot request besides the committed
// persona prompt (message 0), the skin message (message 1) and the player's own lines. A brain chooses an
// intent; the relay appends the matching string below as a system message. Anyone verifying a bot chat checks
// every system message after message 1 against this list byte for byte, so nobody can ghost-write through the
// model. Generated from relay/src/bot/intents.ts; relay/test/steering-shared.test.ts fails if they drift.
// sha256 of JSON [[id, text], ...] in this order: 9a87ff905c41b0e823a5842a052d20b8c4b22729b7f008b5bcd3d77baa023338

export const STEER_VERSION = 'steer-v1';

export const STEERING_SHA256 = '9a87ff905c41b0e823a5842a052d20b8c4b22729b7f008b5bcd3d77baa023338';

/** [id, exact text] for every steering message steer-v1 can produce. */
export const STEERING: readonly (readonly [string, string])[] = [
  ["opener/one", "[steer-v1/opener] Open the chat with your first message: a casual hello, maybe with a quick first question to size them up. One short line, under 12 words. Write only the message."],
  ["opener/multi", "[steer-v1/opener] Open the chat with your first message: a casual hello, maybe with a quick first question to size them up. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["probe/one", "[steer-v1/probe] Your turn to test them. Your message must be a question a real person could answer easily but a bot might fumble, like what they can see or hear right now or what they ate today. One short line, under 12 words. Write only the message."],
  ["probe/multi", "[steer-v1/probe] Your turn to test them. Your message must be a question a real person could answer easily but a bot might fumble, like what they can see or hear right now or what they ate today. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["challenge/one", "[steer-v1/challenge] Your turn to test them. Your message must give them a playful little test to prove they are human, something a real person would get right or bother to do. If their latest message asked you something you have not answered, give it two or three words at most first. Casual, not hostile. One short line, under 12 words. Write only the message."],
  ["challenge/multi", "[steer-v1/challenge] Your turn to test them. Your message must give them a playful little test to prove they are human, something a real person would get right or bother to do. If their latest message asked you something you have not answered, give it two or three words at most first. Casual, not hostile. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["accuse/one", "[steer-v1/accuse] Your message must tease them that they might be a bot, pointing at something in what they said or how they write, and see how they react. Light and joking, not rude. One short line, under 12 words. Write only the message."],
  ["accuse/multi", "[steer-v1/accuse] Your message must tease them that they might be a bot, pointing at something in what they said or how they write, and see how they react. Light and joking, not rude. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["nudge/one", "[steer-v1/nudge] They have gone quiet. Say something to get them talking again, maybe joking that the silence is suspicious. One short line, under 12 words. Write only the message."],
  ["nudge/multi", "[steer-v1/nudge] They have gone quiet. Say something to get them talking again, maybe joking that the silence is suspicious. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["verdict/one", "[steer-v1/verdict] The chat ends in a few seconds. Tell them casually what you reckon so far, real person or bot, or fire one last quick question. One short line, under 12 words. Write only the message."],
  ["verdict/multi", "[steer-v1/verdict] The chat ends in a few seconds. Tell them casually what you reckon so far, real person or bot, or fire one last quick question. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["reply/one", "[steer-v1/reply] Reply directly to what they just said. If they asked you something, answer it. One short line, under 12 words. Write only the message."],
  ["reply/multi", "[steer-v1/reply] Reply directly to what they just said. If they asked you something, answer it. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["react/one", "[steer-v1/react] React to their last message in just a few words, like a laugh, surprise or agreeing. One short line, under 12 words. Write only the message."],
  ["afterthought/one", "[steer-v1/afterthought] Add a quick afterthought to your own last message, something you forgot to say, without repeating yourself. One short line, under 12 words. Write only the message."],
  ["afterthought/multi", "[steer-v1/afterthought] Add a quick afterthought to your own last message, something you forgot to say, without repeating yourself. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["clarify/one", "[steer-v1/clarify] Clarify or fix something you said earlier, the way people do when they reread their own text. One short line, under 12 words. Write only the message."],
  ["clarify/multi", "[steer-v1/clarify] Clarify or fix something you said earlier, the way people do when they reread their own text. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["late_answer/one", "[steer-v1/late_answer] Go back to something they said or asked earlier that you skipped, and answer it now, as if you only just noticed. One short line, under 12 words. Write only the message."],
  ["late_answer/multi", "[steer-v1/late_answer] Go back to something they said or asked earlier that you skipped, and answer it now, as if you only just noticed. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["tangent/local/one", "[steer-v1/tangent/local] Your message must change the subject, as if it just popped into your head: something going on in your town or your street today. If their latest message asked you something you have not answered, give it two or three words at most first. One short line, under 12 words. Write only the message."],
  ["tangent/local/multi", "[steer-v1/tangent/local] Your message must change the subject, as if it just popped into your head: something going on in your town or your street today. If their latest message asked you something you have not answered, give it two or three words at most first. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["tangent/news/one", "[steer-v1/tangent/news] Your message must change the subject, as if it just popped into your head: something you saw online or heard about today. If their latest message asked you something you have not answered, give it two or three words at most first. One short line, under 12 words. Write only the message."],
  ["tangent/news/multi", "[steer-v1/tangent/news] Your message must change the subject, as if it just popped into your head: something you saw online or heard about today. If their latest message asked you something you have not answered, give it two or three words at most first. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["tangent/sport/one", "[steer-v1/tangent/sport] Your message must change the subject, as if it just popped into your head: a match, a team or a sport you follow. If their latest message asked you something you have not answered, give it two or three words at most first. One short line, under 12 words. Write only the message."],
  ["tangent/sport/multi", "[steer-v1/tangent/sport] Your message must change the subject, as if it just popped into your head: a match, a team or a sport you follow. If their latest message asked you something you have not answered, give it two or three words at most first. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["tangent/music/one", "[steer-v1/tangent/music] Your message must change the subject, as if it just popped into your head: music you have been listening to, or a gig. If their latest message asked you something you have not answered, give it two or three words at most first. One short line, under 12 words. Write only the message."],
  ["tangent/music/multi", "[steer-v1/tangent/music] Your message must change the subject, as if it just popped into your head: music you have been listening to, or a gig. If their latest message asked you something you have not answered, give it two or three words at most first. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["tangent/food/one", "[steer-v1/tangent/food] Your message must change the subject, as if it just popped into your head: what you ate today or what you want to eat. If their latest message asked you something you have not answered, give it two or three words at most first. One short line, under 12 words. Write only the message."],
  ["tangent/food/multi", "[steer-v1/tangent/food] Your message must change the subject, as if it just popped into your head: what you ate today or what you want to eat. If their latest message asked you something you have not answered, give it two or three words at most first. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["tangent/weather/one", "[steer-v1/tangent/weather] Your message must change the subject, as if it just popped into your head: the weather where you are right now. If their latest message asked you something you have not answered, give it two or three words at most first. One short line, under 12 words. Write only the message."],
  ["tangent/weather/multi", "[steer-v1/tangent/weather] Your message must change the subject, as if it just popped into your head: the weather where you are right now. If their latest message asked you something you have not answered, give it two or three words at most first. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["tangent/work/one", "[steer-v1/tangent/work] Your message must change the subject, as if it just popped into your head: something from your work, school or daily routine. If their latest message asked you something you have not answered, give it two or three words at most first. One short line, under 12 words. Write only the message."],
  ["tangent/work/multi", "[steer-v1/tangent/work] Your message must change the subject, as if it just popped into your head: something from your work, school or daily routine. If their latest message asked you something you have not answered, give it two or three words at most first. Send it as two or three very short texts, each on its own line. Write only the message."],
  ["tangent/hot_take/one", "[steer-v1/tangent/hot_take] Your message must change the subject, as if it just popped into your head: a mild, harmless hot take about everyday life. If their latest message asked you something you have not answered, give it two or three words at most first. One short line, under 12 words. Write only the message."],
  ["tangent/hot_take/multi", "[steer-v1/tangent/hot_take] Your message must change the subject, as if it just popped into your head: a mild, harmless hot take about everyday life. If their latest message asked you something you have not answered, give it two or three words at most first. Send it as two or three very short texts, each on its own line. Write only the message."],
];

const TEXTS = new Set(STEERING.map(([, text]) => text));

export function isSteeringMessage(content: string): boolean {
  return TEXTS.has(content);
}

export function steeringIdOf(content: string): string | undefined {
  return STEERING.find(([, text]) => text === content)?.[0];
}
