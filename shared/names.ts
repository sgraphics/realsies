// Gamertags like RedFox435: Adjective + Noun + 2 or 3 digits, derived from a 64-hex seed.
// Deterministic and dependency-free so the relay and the web app agree.
// No words that hint at bots or AI.

export const ADJECTIVES = [
  'Red', 'Blue', 'Lazy', 'Sly', 'Bold', 'Tiny', 'Big', 'Quick', 'Odd', 'Calm', 'Wild', 'Neon', 'Dusty', 'Rusty', 'Fuzzy', 'Lucky',
  'Grumpy', 'Happy', 'Sleepy', 'Brave', 'Silent', 'Loud', 'Shy', 'Witty', 'Salty', 'Spicy', 'Frosty', 'Sunny', 'Misty', 'Cosmic', 'Turbo', 'Mega',
  'Super', 'Retro', 'Golden', 'Silver', 'Iron', 'Crimson', 'Jade', 'Amber', 'Violet', 'Scarlet', 'Copper', 'Velvet', 'Cobalt', 'Lunar', 'Solar', 'Stormy',
  'Mellow', 'Jolly', 'Nimble', 'Dizzy', 'Clever', 'Humble', 'Noble', 'Royal', 'Secret', 'Hidden', 'Swift', 'Gentle', 'Fierce', 'Crispy', 'Soggy', 'Cheeky',
];

export const NOUNS = [
  'Fox', 'Wolf', 'Bear', 'Owl', 'Cat', 'Dog', 'Frog', 'Toad', 'Duck', 'Goose', 'Hawk', 'Crow', 'Raven', 'Tiger', 'Lion', 'Panda',
  'Otter', 'Badger', 'Moose', 'Llama', 'Yak', 'Bat', 'Shark', 'Whale', 'Squid', 'Crab', 'Lobster', 'Snail', 'Bee', 'Moth', 'Gecko', 'Lizard',
  'Cobra', 'Dragon', 'Knight', 'Wizard', 'Pirate', 'Ninja', 'Ghost', 'Goblin', 'Troll', 'Pixie', 'Elf', 'Dwarf', 'Comet', 'Rocket', 'Pickle', 'Muffin',
  'Noodle', 'Taco', 'Waffle', 'Bagel', 'Biscuit', 'Pepper', 'Mango', 'Lemon', 'Cactus', 'Acorn', 'Pebble', 'Thunder', 'Walrus', 'Beaver', 'Ferret', 'Puffin',
];

function byteAt(seed: string, i: number): number {
  const j = (i * 2) % Math.max(2, seed.length - 1);
  const v = parseInt(seed.slice(j, j + 2), 16);
  return Number.isFinite(v) ? v : 0;
}

/** RedFox435-style gamertag from a hex seed. */
export function gamertag(seed: string): string {
  const adj = ADJECTIVES[byteAt(seed, 0) % ADJECTIVES.length];
  const noun = NOUNS[byteAt(seed, 1) % NOUNS.length];
  const twoDigits = byteAt(seed, 2) % 4 === 0;
  const n = (byteAt(seed, 3) * 256 + byteAt(seed, 4)) % (twoDigits ? 90 : 900) + (twoDigits ? 10 : 100);
  return `${adj}${noun}${n}`;
}
