// Messages between the browser and the game server (JSON over WebSocket).

import type { CribView, DoorSide } from './world.ts';

export type Role = 'bro' | 'sixseven';
export type Phase = 'lobby' | 'pregame' | 'lockin' | 'touchgrass';
export type EntKind = 'bro' | 'npc' | 'sixseven';

export interface EntView {
  id: string;
  k: EntKind;
  x: number;
  y: number;
  n: string; // display name
  l?: 1; // ring light on
  ai?: 1; // AI-controlled Sixseven
  st?: 1; // stunned (mogged)
  rv?: number; // revive progress 0..1 for NPCs
  c?: number; // colour hue 0..359
  z?: number; // jump height
}

export interface SelfView {
  id: string;
  role: Role;
  aura: number;
  crib: number; // plot index of own crib, -1 for Sixsevens
}

export interface LobbyInfo {
  code: string;
  name: string;
  private: boolean;
  quick: boolean; // the always-on quick play room
  host: string | null; // player id of the host (custom lobbies)
  hostName?: string;
}

export interface WorldEvents {
  power: boolean; // street lamps + crib lights on
  powerFix: number; // generator repair progress 0..1 during an outage
  fog: boolean;
  rage: boolean;
}

export interface LobbyListing {
  code: string;
  name: string;
  players: number;
  phase: Phase;
  quick: boolean;
}

export interface NoiseView { id: number; x: number; y: number; r: number }
export interface DropView { id: number; x: number; y: number }

export interface ScoreRow {
  id: string;
  n: string;
  role: Role;
  alive: boolean;
  score: number;
  catches: number; // Sixseven: bros caught
  mogs: number; // bro: Sixsevens stunned with the ring light
  revives: number;
  letIns: number;
  caught: number; // times this bro got 67'd
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
      counts: { bros: number; alive: number; sixsevens: number };
      lobby: LobbyInfo;
      ev: WorldEvents;
    }
  | { t: 'knock'; id: number; from: string; side: DoorSide; expires: number }
  | { t: 'knockDone'; id: number }
  | { t: 'feed'; items: FeedItem[] }
  | { t: 'chat'; from: string; role: Role; text: string; sys?: boolean }
  | { t: 'scores'; rows: ScoreRow[] }
  | { t: 'result'; win: boolean; night: number; mvp?: string }
  | { t: 'ping'; at: number }
  | { t: 'kicked'; reason: string };

export type ClientMsg =
  | { t: 'input'; dx: number; dy: number; zoom: boolean }
  | { t: 'jump' }
  | { t: 'light' } // toggle ring light
  | { t: 'use' } // open own door / knock / smash
  | { t: 'repair'; on: boolean }
  | { t: 'answer'; id: number; ok: boolean }
  | { t: 'chat'; text: string }
  | { t: 'scores' }
  | { t: 'start' } // host starts the night in a custom lobby
  | { t: 'role'; role: Role } // switch role between nights
  | { t: 'pong'; at: number };
