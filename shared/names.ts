// Gamertags: ONE word plus 2 or 3 digits, like Pickle435 or Raven72, derived from a 64-hex seed.
// Short so they fit under a pedestal at every size. Deterministic and dependency-free so the relay
// and the web app agree. No words that hint at bots or AI. (v2, 2026-11-04: was AdjectiveNoun123.)

export const WORDS = [
  'Fox', 'Wolf', 'Bear', 'Owl', 'Cat', 'Frog', 'Toad', 'Duck', 'Goose', 'Hawk', 'Crow', 'Raven', 'Tiger', 'Lion', 'Panda', 'Otter',
  'Badger', 'Moose', 'Llama', 'Yak', 'Bat', 'Shark', 'Whale', 'Squid', 'Crab', 'Snail', 'Bee', 'Moth', 'Gecko', 'Cobra', 'Dragon', 'Knight',
  'Wizard', 'Pirate', 'Ninja', 'Ghost', 'Goblin', 'Troll', 'Pixie', 'Elf', 'Comet', 'Rocket', 'Pickle', 'Muffin', 'Noodle', 'Taco', 'Waffle', 'Bagel',
  'Biscuit', 'Pepper', 'Mango', 'Lemon', 'Cactus', 'Acorn', 'Pebble', 'Thunder', 'Walrus', 'Beaver', 'Ferret', 'Puffin', 'Lobster', 'Turnip', 'Radish', 'Pretzel',
  'Nacho', 'Dumpling', 'Pancake', 'Toast', 'Cookie', 'Peanut', 'Walnut', 'Olive', 'Cherry', 'Melon', 'Kiwi', 'Coconut', 'Banjo', 'Kazoo', 'Tuba', 'Fiddle',
  'Yeti', 'Kraken', 'Gnome', 'Ogre', 'Sphinx', 'Griffin', 'Phoenix', 'Unicorn', 'Pegasus', 'Mummy', 'Viking', 'Samurai', 'Cowboy', 'Jester', 'Bard', 'Monk',
  'Sailor', 'Captain', 'Ranger', 'Scout', 'Rascal', 'Bandit', 'Rebel', 'Rookie', 'Ace', 'Joker', 'Maverick', 'Nomad', 'Drifter', 'Wanderer', 'Pilgrim', 'Hermit',
  'Blizzard', 'Tornado', 'Cyclone', 'Meteor', 'Nebula', 'Quasar', 'Pulsar', 'Galaxy', 'Aurora', 'Ember', 'Cinder', 'Spark', 'Flint', 'Boulder', 'Canyon', 'Glacier',
  'Tundra', 'Lagoon', 'Marsh', 'Willow', 'Maple', 'Cedar', 'Juniper', 'Clover', 'Thistle', 'Fern', 'Moss', 'Lotus', 'Tulip', 'Daisy', 'Poppy', 'Sprout',
  'Sparrow', 'Robin', 'Finch', 'Magpie', 'Pelican', 'Flamingo', 'Toucan', 'Parrot', 'Penguin', 'Koala', 'Wombat', 'Lemur', 'Sloth', 'Hippo', 'Rhino', 'Zebra',
];

function byteAt(seed: string, i: number): number {
  const j = (i * 2) % Math.max(2, seed.length - 1);
  const v = parseInt(seed.slice(j, j + 2), 16);
  return Number.isFinite(v) ? v : 0;
}

/** Pickle435-style gamertag from a hex seed: one word plus 2 or 3 digits. */
export function gamertag(seed: string): string {
  const word = WORDS[(byteAt(seed, 0) * 256 + byteAt(seed, 1)) % WORDS.length];
  const twoDigits = byteAt(seed, 2) % 3 === 0;
  const n = (byteAt(seed, 3) * 256 + byteAt(seed, 4)) % (twoDigits ? 90 : 900) + (twoDigits ? 10 : 100);
  return `${word}${n}`;
}
