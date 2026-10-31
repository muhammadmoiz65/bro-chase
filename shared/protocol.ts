// Messages between the browser and the game server (JSON over WebSocket).

import type { CribView, DoorSide } from './world.ts';
import type { ItemId, ShopId } from './constants.ts';

export type Role = 'bro' | 'collector';
export type Phase = 'lobby' | 'pregame' | 'lockin' | 'touchgrass';
export type EntKind = 'bro' | 'npc' | 'collector';

export interface EntView {
  id: string;
  k: EntKind;
  x: number;
  y: number;
  n: string; // display name
  l?: 1; // ring light on
  ai?: 1; // AI-controlled Bill Collector
  st?: 1; // stunned (mogged)
  rv?: number; // revive progress 0..1 for NPCs
  c?: number; // colour hue 0..359
  z?: number; // jump height
}

export interface SelfView {
  id: string;
  role: Role;
  aura: number;
  crib: number; // plot index of own crib, -1 for Bill Collectors
  cash: number;
  inv: Record<ItemId, number>;
  armor: number; // crib door level 0..3
  autorepair: boolean;
  drink: number; // seconds left
  bribe: number; // seconds left
}

export interface PropView { id: number; k: 'trap' | 'decoy'; x: number; y: number }

export interface LobbyInfo {
  code: string;
  name: string;
  private: boolean;
  quick: boolean; // the always-on quick play room
  host: string | null; // player id of the host (custom lobbies)
  hostName?: string;
}

export type ModeName = 'blackout' | 'fog' | 'rage' | 'lowgrav' | 'disco';

export interface WorldEvents {
  power: boolean; // street lamps + crib lights on
  powerFix: number; // generator repair progress 0..1 during a power cut
  fog: boolean;
  rage: boolean;
  lowgrav: boolean;
  disco: boolean;
  mode: ModeName | null; // the short random mode running now
  modeEnd: number; // ms epoch
}


export interface LobbyListing {
  code: string;
  name: string;
  players: number;
  phase: Phase;
  quick: boolean;
}

export type NoiseKind = 'step' | 'zoom' | 'land' | 'repair' | 'knock' | 'door' | 'smash' | 'mog' | 'decoy';
export interface NoiseView { id: number; x: number; y: number; r: number; k: NoiseKind }
export interface DropView { id: number; x: number; y: number; k: 'aura' | 'cash' }

export interface ScoreRow {
  id: string;
  n: string;
  role: Role;
  alive: boolean;
  score: number;
  catches: number; // Bill Collector: bros caught
  mogs: number; // bro: Bill Collectors stunned with the ring light
  revives: number;
  letIns: number;
  caught: number; // times this bro got collected
  ping: number;
  ai?: boolean;
}

export type FeedKind = 'caught' | 'mog' | 'revive' | 'letin' | 'smash' | 'join' | 'leave' | 'info' | 'event';
export interface FeedItem { k: FeedKind; a?: string; b?: string; text?: string }

export type ServerMsg =
  | { t: 'welcome'; you: SelfView; room: string; notice?: string }
  | {
      t: 'snap';
      now: number;
      phase: Phase;
      phaseEnd: number;
      R: number;
      night: number;
      you: SelfView;
      ents: EntView[];
      cribs?: CribView[]; // sent every few ticks
      noises: NoiseView[];
      drops?: DropView[];
      props: PropView[];
      counts: { bros: number; alive: number; collectors: number };
      lobby: LobbyInfo;
      ev: WorldEvents;
    }
  | { t: 'knock'; id: number; from: string; side: DoorSide; expires: number }
  | { t: 'knockDone'; id: number }
  | { t: 'feed'; items: FeedItem[] }
  | { t: 'chat'; from: string; role: Role; text: string; sys?: boolean }
  | { t: 'scores'; rows: ScoreRow[] }
  | { t: 'result'; win: boolean; night: number; mvp?: string }
  | { t: 'aura'; d: number; why: string }
  | { t: 'cash'; d: number; why: string }
  | { t: 'ping'; at: number }
  | { t: 'kicked'; reason: string };

export type ClientMsg =
  | { t: 'input'; dx: number; dy: number; zoom: boolean; sneak?: boolean }
  | { t: 'jump' }
  | { t: 'buy'; item: ShopId }
  | { t: 'item'; item: ItemId }
  | { t: 'light' } // toggle ring light
  | { t: 'use' } // open own door / knock / smash
  | { t: 'repair'; on: boolean }
  | { t: 'answer'; id: number; ok: boolean }
  | { t: 'chat'; text: string }
  | { t: 'scores' }
  | { t: 'start' } // host starts the night in a custom lobby
  | { t: 'role'; role: Role } // switch role between nights
  | { t: 'pong'; at: number };
