// Keeps track of rooms: the always-on quick play room plus player-made lobbies
// (public ones are listed, private ones are joined by invite code).

import { randomInt } from 'node:crypto';
import { Room, type Hooks } from './game.ts';
import { PHASE_SEC } from '../shared/constants.ts';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_TTL_SEC = 60;

export class Rooms {
  private rooms = new Map<string, Room>();
  readonly quick: Room;

  constructor(private onStats: Hooks['onStats'], private phaseSec = PHASE_SEC) {
    this.quick = this.make('QUICK', 'Quick Play: Ohio After Dark', false, true, null);
  }

  private make(code: string, name: string, priv: boolean, quick: boolean, host: string | null): Room {
    const room = new Room(code, name, priv, quick, host, {
      onStats: this.onStats,
      onEmpty: (r) => {
        if (r.quick) return;
        if (r.emptySince && Date.now() / 1000 - r.emptySince > EMPTY_TTL_SEC) this.close(r.code);
      },
    }, this.phaseSec);
    this.rooms.set(code, room);
    room.start();
    return room;
  }

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 6; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  create(name: string, priv: boolean, hostId: string): Room {
    if (this.rooms.size > 500) throw new Error('Too many lobbies right now, try again soon.');
    return this.make(this.newCode(), name, priv, false, hostId);
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  close(code: string) {
    const r = this.rooms.get(code);
    if (!r || r.quick) return;
    r.stop();
    this.rooms.delete(code);
  }

  /** Public lobbies for the browser, quick play first. */
  list() {
    return [...this.rooms.values()]
      .filter((r) => !r.isPrivate)
      .map((r) => r.listing())
      .sort((a, b) => Number(b.quick) - Number(a.quick) || b.players - a.players);
  }

  stopAll() {
    for (const r of this.rooms.values()) r.stop();
  }
}
