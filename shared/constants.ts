// Tunables shared by the server simulation and the client prediction.

export const TICK_RATE = 20; // server simulation ticks per second
export const SNAPSHOT_EVERY = 1; // send a snapshot every N ticks
export const INTEREST_RADIUS = 30; // tiles: entities farther than this are not sent

/** One Bill Collector for every this many bros (rounded up). */
export const BROS_PER_MONSTER = 4;

export const PLOT = 14; // tiles per plot side (crib + street)
export const CRIB_HALF = 4; // crib spans [c - 4, c + 3] on each axis

export const RADIUS = 0.35; // entity collision radius in tiles

export const SPEED = {
  sneak: 2.0, // walk mode: slow and nearly silent
  walk: 3.4, // normal: footsteps the Bill Collector can hear nearby
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
  mogCost: 18, // aura spent when the ring light stuns a Bill Collector
};

export const RING_LIGHT_RANGE = 2.4; // tiles: a Bill Collector this close to a lit ring light gets mogged
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
  pregame: 45, // scavenge before the Bill Collectors arrive
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
  generatorWork: 4, // bro-seconds of repair to end a power cut early
  generatorRange: 2.2,
  rageSpeed: 1.35,
  auraRainDrops: 14,
};

/** Aura rewards and penalties (shown as +/- popups). */
export const AURA_DELTA = { revive: 20, letIn: 15, refuse: -10, generator: 25, mogBonus: 5 };
