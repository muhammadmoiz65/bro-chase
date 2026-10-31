// Character customization: what a bro looks like. Shared by server (validation,
// storage, sync) and client (creator screen, renderer).
//
// A look is a handful of small integers (indexes into the lists below). On the
// wire and in the database it travels as a short dotted string, e.g. "2.3.1.0.5.4.2.1".

export const SKIN_TONES = [0xffe0c4, 0xf6c9a0, 0xe0a97c, 0xc68a5e, 0xa0673f, 0x7a4a2a, 0x553220, 0x8fe388] as const;
export const SKIN_NAMES = ['Porcelain', 'Peach', 'Honey', 'Caramel', 'Bronze', 'Cocoa', 'Espresso', 'Goblin'];

export const HAIR_STYLES = ['Bald', 'Buzz', 'Low taper fade', 'Fluffy', 'Mullet', 'Afro', 'Spikes', 'Mohawk'] as const;
export const HAIR_COLORS = [0x1b1410, 0x4a2c1a, 0x8a5a2b, 0xe8c66a, 0xf2f2f2, 0xff4fa3, 0x3fa9ff, 0x7dff6a] as const;

export const TOPS = ['Hoodie', 'Tee', 'Tank top', 'Jersey', 'Puffer', 'Suit'] as const;
export const OUTFIT_COLORS = [
  0xff3b6b, 0xff8a3d, 0xffd23f, 0x5dff8a, 0x2ec4b6, 0x3fa9ff, 0x7b5cff, 0xd9a0ff,
  0xf2f2f2, 0x8a8f9c, 0x2a2c36, 0x6b4a2b,
] as const;

export const HATS = ['None', 'Cap', 'Backwards cap', 'Beanie', 'Crown', 'Propeller hat', 'Cowboy hat', 'Traffic cone'] as const;
export const ACCESSORIES = ['None', 'Deal-with-it shades', 'Gold chain', 'Mustache', 'Headphones', 'Clown nose', 'Mewing jaw'] as const;

export interface Look {
  skin: number;
  hair: number;
  hairColor: number;
  top: number;
  topColor: number;
  pantsColor: number;
  hat: number;
  acc: number;
}

/** Field order on the wire. Never reorder: saved looks depend on it. */
export const LOOK_FIELDS: Array<[keyof Look, number]> = [
  ['skin', SKIN_TONES.length],
  ['hair', HAIR_STYLES.length],
  ['hairColor', HAIR_COLORS.length],
  ['top', TOPS.length],
  ['topColor', OUTFIT_COLORS.length],
  ['pantsColor', OUTFIT_COLORS.length],
  ['hat', HATS.length],
  ['acc', ACCESSORIES.length],
];

export const DEFAULT_LOOK: Look = { skin: 1, hair: 2, hairColor: 0, top: 0, topColor: 5, pantsColor: 10, hat: 0, acc: 0 };

export function encodeLook(l: Look): string {
  return LOOK_FIELDS.map(([k]) => l[k]).join('.');
}

/** Parse and validate a look from a string or object. Returns null if it is not a valid look. */
export function parseLook(raw: unknown): Look | null {
  let vals: unknown[];
  if (typeof raw === 'string') {
    if (raw.length > 40) return null;
    vals = raw.split('.').map((s) => (/^\d{1,2}$/.test(s) ? Number(s) : NaN));
  } else if (raw && typeof raw === 'object') {
    vals = LOOK_FIELDS.map(([k]) => (raw as Record<string, unknown>)[k]);
  } else return null;
  if (vals.length !== LOOK_FIELDS.length) return null;
  const out = {} as Look;
  for (let i = 0; i < LOOK_FIELDS.length; i++) {
    const [k, n] = LOOK_FIELDS[i];
    const v = vals[i];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= n) return null;
    out[k] = v;
  }
  return out;
}

/** A random look; used for the "Randomize" button and for players who never picked one. */
export function randomLook(rand: () => number = Math.random): Look {
  const out = {} as Look;
  for (const [k, n] of LOOK_FIELDS) out[k] = Math.floor(rand() * n);
  // keep randoms mostly human; the goblin skin and silly hats are opt-in more often than not
  if (out.skin === SKIN_TONES.length - 1 && rand() < 0.7) out.skin = Math.floor(rand() * (SKIN_TONES.length - 1));
  if (rand() < 0.4) out.hat = 0;
  if (rand() < 0.4) out.acc = 0;
  return out;
}

/** Deterministic look from an id (stable per account), for players with no saved look. */
export function lookFromId(id: string): Look {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  return randomLook(rand);
}
