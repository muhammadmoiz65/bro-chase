// Tunables shared by the server simulation and the client prediction.

export const TICK_RATE = 20; // server simulation ticks per second
export const SNAPSHOT_EVERY = 1; // send a snapshot every N ticks
export const INTEREST_RADIUS = 30; // tiles: entities farther than this are not sent

/** One Opp for every this many bros (rounded up). */
export const BROS_PER_MONSTER = 4;

export const PLOT = 14; // tiles per plot side (crib + street)
export const CRIB_HALF = 4; // crib spans [c - 4, c + 3] on each axis

export const RADIUS = 0.35; // entity collision radius in tiles

export const SPEED = {
  sneak: 2.0, // walk mode: slow and nearly silent
  walk: 3.4, // normal: footsteps the Opp can hear nearby
  zoom: 5.4, // sprint: loud
  npc: 4.2, // ghost after being caught
  monsterAi: 3.5,
  monsterAiMax: 4.7,
  monsterPlayer: 4.5,
};

export const AURA = {
  start: 60,
  max: 100,
  burnPerSec: 1.2, // ring light drain
  drop: 30, // aura gained from one aura drop
  mogCost: 18, // aura spent when the ring light stuns an Opp
};

export const RING_LIGHT_RANGE = 2.4; // tiles: an Opp this close to a lit ring light gets mogged
export const MOG_STUN_SEC = 2.6;
export const CATCH_RANGE = 0.75;

export const DOOR = {
  maxHp: 100,
  openSec: 3.5,
  knockTimeoutSec: 12,
  repairPerSec: 22,
  aiDamagePerSec: 22,
  playerSmash: 28,
  playerSmashCooldown: 0.6,
};

export const NOISE = {
  sneak: 1.2,
  walk: 4,
  zoom: 8,
  repair: 9,
  knock: 7,
  door: 5,
  smash: 10,
  mog: 9,
  lifeSec: 2.5,
};

export const REVIVE_RANGE = 1.4;
export const REVIVE_SEC = 3;

export const VISION = { lit: 8, dark: 4.5, monster: 3 };

export const PHASE_SEC = {
  pregame: 45, // scavenge before the Opps arrive
  lockin: 420, // the night
  touchgrass: 12, // results screen, then a new night
};

export const RECONNECT_GRACE_SEC = 60;

export const JUMP = { sec: 0.55, cooldown: 0.35, height: 0.9, landNoise: 3, lowGravSec: 0.95, lowGravHeight: 2.2 };

/** Short random modes during the night. Each lasts 10 to 20 seconds. */
export const EVENTS = {
  firstAfterSec: 25, // into the night
  gapMinSec: 22,
  gapMaxSec: 40,
  minSec: 10,
  maxSec: 20,
  rageSpeed: 1.35,
  auraRainDrops: 14,
};

/** Aura rewards and penalties (shown as +/- popups). */
export const AURA_DELTA = { revive: 20, letIn: 15, refuse: -10, mogBonus: 5 };

/** Cash economy: earned during a match (kept between nights while you stay in the room). */
export const CASH = {
  start: 50,
  drop: 25, // a cash pickup in the streets
  perSecAlive: 0.5, // passive income during the night while not caught
  revive: 40,
  letIn: 25,
  mog: 15,
  surviveNight: 100,
  catch: 50, // player Opps
  smash: 20,
};

export type ItemId = 'trap' | 'drink' | 'decoy' | 'bribe';
export type ShopId = ItemId | 'armor' | 'autorepair' | 'aura' | 'kicks' | 'vest';

export const DOOR_LEVEL_HP = [100, 160, 230, 320];

export const SHOP: Record<ShopId, { name: string; price: number | number[]; desc: string }> = {
  armor: { name: 'Door armor', price: [120, 220, 350], desc: 'Both crib doors get more HP (3 levels).' },
  autorepair: { name: 'Auto-repair', price: 200, desc: 'Your doors slowly fix themselves.' },
  trap: { name: 'Banana peel', price: 60, desc: 'Drop it (1). An Opp that steps on it is stunned 3s.' },
  drink: { name: 'Energy drink', price: 50, desc: 'Use it (2). 40% faster for 8s.' },
  decoy: { name: 'Decoy speaker', price: 70, desc: 'Drop it (3). Blasts noise for 7s to lure them away.' },
  bribe: { name: 'Bribe', price: 150, desc: 'Use it (4). Opps ignore you for 8s.' },
  aura: { name: 'Aura pack', price: 40, desc: '+40 aura right now.' },
  kicks: { name: 'Drip kicks', price: [90, 180, 320], desc: 'Shoes: jump again in mid-air and run faster (3 tiers).' },
  vest: { name: 'Body armour', price: [110, 210, 340], desc: 'Blocks Opp grabs: 1, 2, then 3 per night (3 tiers).' },
};

/** Player gear tiers. Index 0 = none. Gear stays with you between nights while you stay in the room. */
export const GEAR = {
  kicks: [
    { name: 'No kicks', speed: 1, airJumps: 0 },
    { name: 'Fresh Kicks', speed: 1.1, airJumps: 1 },
    { name: 'Turbo Kicks', speed: 1.2, airJumps: 1 },
    { name: 'Sky Kicks', speed: 1.3, airJumps: 2 },
  ],
  vest: [
    { name: 'No armour', shields: 0 },
    { name: 'Hoodie Vest', shields: 1 },
    { name: 'Steel Plate', shields: 2 },
    { name: 'Gold Sigma Suit', shields: 3 },
  ],
  maxTier: 3,
  shieldStunSec: 1.4, // the Opp who hit your armour is knocked back this long
  shieldSafeSec: 1.5, // can't be grabbed again right after the armour blocks a grab
};

export const ITEM = {
  trapStunSec: 3,
  drinkSec: 8,
  drinkSpeed: 1.4,
  decoySec: 7,
  decoyNoise: 14,
  bribeSec: 8,
  autoRepairPerSec: 3,
  maxTrapsPerPlayer: 4,
};

/** Defences you build in your crib's plot. Each type has 3 levels (upgrades apply to all of that type you own). */
export type DefKind = 'blaster' | 'lamp' | 'bass';
export const DEF_KINDS: DefKind[] = ['blaster', 'lamp', 'bass'];

export const DEFENCE: Record<DefKind, {
  name: string; desc: string; build: number; upgrade: [number, number];
  range: [number, number, number]; every: [number, number, number];
}> = {
  blaster: {
    name: 'Rizz Blaster', desc: 'Turret. Fires foam at Opps; 5 hits stuns them.',
    build: 150, upgrade: [150, 250], range: [5, 6, 7], every: [1.0, 0.7, 0.5],
  },
  lamp: {
    name: 'Aura Lamp', desc: 'Fixed ring light. Mogs anything that gets close. Dead in power cuts.',
    build: 120, upgrade: [120, 200], range: [2.4, 3, 3.6], every: [7, 5, 3.5],
  },
  bass: {
    name: 'Bass Drop', desc: 'Speaker. Blasts Opps backwards. Loud: others hear it.',
    build: 180, upgrade: [180, 280], range: [3, 3.5, 4], every: [6, 5, 4],
  },
};

export const DEF = {
  maxPerCrib: 6,
  hp: 120,
  repairPerSec: 30,
  oppDamagePerSec: 20, // AI Opps wreck defences they brush past
  playerSmash: 35,
  blasterStunHits: 5,
  blasterStunSec: 2,
  bassStunSec: 1.1,
  bassNoise: 8,
  stunGraceSec: 2.5, // after any stun wears off, defences leave that Opp alone this long (no stun-lock)
};

/** Playing as an Opp: abilities, plus the bot bros that fill bro slots so the 4:1 ratio holds. */
export const MONSTER = {
  screechCd: 14, // Q: echo pulse cooldown
  screechRange: 18, // tiles: bros inside this get pinged for the hunter
  screechNoise: 12, // everyone nearby hears it too (fair warning)
  echoSec: 3.2, // how long pings stay on the hunter's screen
  lungeCd: 5, // Space: short burst
  lungeSec: 0.35,
  lungeSpeed: 2.6, // speed multiplier while lunging
  senseRange: 9, // the heartbeat gets stronger as a bro gets closer than this
  maxBots: 16,
};

/** Vents: one manhole per block. Opps (players and AI) crawl in and pop out somewhere else. */
export const VENT = {
  useRange: 1.4, // tiles from the grate centre
  travelSec: 1.6, // time underground; the exit grate rattles the whole time
  cd: 10, // seconds between trips
  maxHop: 3, // plots: the farthest a trip can go
  noise: 10, // clank radius at both grates
  aiMinGain: 14, // tiles an AI must save before it bothers
};
