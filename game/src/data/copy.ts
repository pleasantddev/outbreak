// In-game text. Written to be read in half a second under fire.

export const ANNOUNCER = {
  drop: ['Lagos is quiet. It is lying.', 'You are not the only one breathing out here.', 'Find a gun before something finds you.'],
  survival: ['The city is watching who moves first.', 'Generators are still running somewhere. So is everything else.'],
  corruption: ['The ground is wrong in the {district}. Keep away from the red.', 'Power is failing across the mainland.', 'Something under the road is waking up.'],
  heartWarn: 'Everything goes quiet.',
  heart: 'THE HEART HAS AWAKENED',
  heartSub: 'Beneath {site}. Every survivor heard it.',
  carrier: '{name} HAS THE HEART',
  carrierSub: 'Hunt them. Or take it from whoever does.',
  heartDropped: 'THE HEART IS ON THE GROUND',
  extraction: 'EXTRACTION IS OPEN',
  extractionSub: 'Airport Road. Apapa Port. The Lagoon jetty. Hold one with the Heart and you walk out.',
  awakened: 'AN AWAKENED HAS ENTERED THE CITY',
  awakenedSub: 'Its heat shows on your map. Its core is worth killing for.',
  collapse: 'THE CITY IS CLOSING IN',
  blackout: 'BLACKOUT',
  blackoutSub: 'The last grid in {district} just died.',
  stalkers: 'They come out after dark. Keep your light on them.',
};

export const DEATH_LINES = ['Lagos keeps what it kills.', 'Another name for the walls.', 'The Heart did not notice you go.', 'Somebody will take your shoes.'];

export const VICTORY = {
  heart: { title: 'YOU CARRIED THE HEART OUT', sub: 'Lagos let one go tonight.' },
  survivor: { title: 'LAST ONE BREATHING', sub: 'Nobody got the Heart out. You got yourself out.' },
  contract: { title: 'CONTRACT FULFILLED', sub: 'The job is done. Nobody saw you leave.' },
};

export const LOADING_TIPS = [
  'Shoot the tyres. A danfo on three wheels is a coffin with seats.',
  'Footsteps on the floor above sound different. Listen before you climb.',
  'Stalkers freeze in a flashlight beam. They hate being seen.',
  'The Heart carrier shows on every map. So does anyone standing next to them.',
  'Awakening makes you a god for forty-five seconds and a target for the rest of the match.',
  'Runners carry ten backpack slots. Smugglers love Runners.',
  'Generators can be shot. So can the people standing in their light.',
  'Metal walls stop bullets. They do not stop Force.',
  'Contracts are private. That quiet survivor might not want you dead. Yet.',
  'Corruption hurts more the deeper you go. Its red fog hides people too.',
];

export const LORE = [
  { title: 'What the fishermen said', body: 'Three nights before, the lagoon got warm. Not the surface. The deep water. The Makoko men pulled up nets full of fish with no eyes and said nothing to anybody, because who would believe them.' },
  { title: 'The first beat', body: 'At 2:14 in the morning every phone in Lagos lost signal at once. A sound came up through the ground, low enough to feel in your teeth. People in Ikeja swore it came from Oshodi. People in Oshodi swore it came from under their beds.' },
  { title: 'The Hollow', body: 'They were neighbours. They still stand where they used to stand: at the bus stop, behind the kiosk counter, in the doorway of the church. They do not move until you do.' },
  { title: 'Awakened', body: 'Some people touched the shards and did not die. Their eyes changed first. Then their voices. Then they stopped needing doors. The Wardens shoot them on sight. The Hollow pray to them.' },
  { title: 'The Heart', body: 'Nobody knows what it is. Everybody knows what it does. It wakes up somewhere under the city every night, and whoever carries it out to the edge of Lagos can sell it for anything they want. Nobody who has sold it has been seen again.' },
];
