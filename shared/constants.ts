// Tunables shared by the server simulation and the client prediction.

export const TICK_RATE = 20; // server simulation ticks per second
export const SNAPSHOT_EVERY = 1; // send a snapshot every N ticks
export const INTEREST_RADIUS = 30; // tiles: entities farther than this are not sent

/** One Sixseven for every this many bros (rounded up). */
export const BROS_PER_MONSTER = 4;

export const PLOT = 14; // tiles per plot side (crib + street)
export const CRIB_HALF = 4; // crib spans [c - 4, c + 3] on each axis

export const RADIUS = 0.35; // entity collision radius in tiles

export const SPEED = {
  walk: 3.2,
  zoom: 5.2, // running
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
  mogCost: 18, // aura spent when the ring light stuns a Sixseven
};

export const RING_LIGHT_RANGE = 2.4; // tiles: a Sixseven this close to a lit ring light gets mogged
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
  walk: 2.5,
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
  pregame: 45, // scavenge before the Sixsevens arrive
  lockin: 420, // the night
  touchgrass: 12, // results screen, then a new night
};

export const RECONNECT_GRACE_SEC = 60;

export const JUMP = { sec: 0.55, cooldown: 0.35, height: 0.9, landNoise: 3 };

export const EVENTS = {
  firstAfterSec: 50, // into the night
  gapMinSec: 55,
  gapMaxSec: 85,
  outageSec: 60, // power stays out this long unless the generator is fixed
  generatorWork: 6, // bro-seconds of repair to restore power
  generatorRange: 2.2,
  fogSec: 35,
  rageSec: 22,
  rageSpeed: 1.35,
  auraRainDrops: 14,
};
