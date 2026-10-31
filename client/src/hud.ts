// DOM HUD: timer, kill feed, chat, Tab scoreboard, knock prompt, lobby panel.
// Everything user-written is set with textContent, never innerHTML.

import type { FeedItem, LobbyInfo, Phase, Role, ScoreRow, WorldEvents } from '../../shared/protocol.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const PHASE_NAMES: Record<Phase, string> = {
  lobby: 'LOBBY',
  pregame: 'PREGAME',
  lockin: 'LOCK IN',
  touchgrass: 'TOUCH GRASS',
};

export class Hud {
  private chatOpen = false;
  private knockId: number | null = null;
  private knockExpires = 0;
  private knockTotal = 1;
  myName = '';

  show(on: boolean) { $('hud').classList.toggle('hidden', !on); }

  timer(phase: Phase, phaseEnd: number, night: number, counts: { bros: number; alive: number; collectors: number }) {
    const p = $('phase');
    p.textContent = phase === 'lockin' ? `LOCK IN · NIGHT ${night}` : PHASE_NAMES[phase];
    p.classList.toggle('lockin', phase === 'lockin');
    const left = phaseEnd ? Math.max(0, Math.ceil((phaseEnd - Date.now()) / 1000)) : 0;
    $('timer').textContent = phase === 'lobby' ? 'WAITING' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('counts').textContent = `Bros ${counts.alive}/${counts.bros} alive · Bill Collectors ${counts.collectors}`;
  }

  private lastMode: string | null = null;

  events(ev: WorldEvents) {
    const b = $('event-banner');
    const left = ev.modeEnd ? Math.max(0, Math.ceil((ev.modeEnd - Date.now()) / 1000)) : 0;
    const names: Record<string, string> = {
      blackout: `POWER CUT · ${left}s · fix the generator in the plaza (${Math.round(ev.powerFix * 100)}%)`,
      fog: `OHIO FOG · ${left}s`,
      rage: `BILL COLLECTOR RAGE · ${left}s`,
      lowgrav: `LOW GRAVITY · ${left}s · jump!`,
      disco: `DISCO MODE · ${left}s · they hear less`,
    };
    const text = ev.mode ? names[ev.mode] : '';
    b.textContent = text;
    b.classList.toggle('hidden', !text);
    if (ev.mode !== this.lastMode) {
      // a quick flash so the switch between modes reads as a transition
      const f = $('mode-flash');
      f.classList.add('on');
      setTimeout(() => f.classList.remove('on'), 500);
      this.lastMode = ev.mode;
    }
  }

  auraPop(d: number, why: string) {
    const box = $('aura-pops');
    const pop = el('div', `aura-pop ${d >= 0 ? 'up' : 'down'}`, `${d >= 0 ? '+' : ''}${d} AURA`);
    pop.appendChild(el('small', '', why));
    box.appendChild(pop);
    setTimeout(() => pop.remove(), 1900);
    while (box.children.length > 3) box.firstElementChild!.remove();
  }

  walkMode(on: boolean) {
    const s = $('walk-state');
    s.textContent = on ? 'ON' : 'OFF';
    s.classList.toggle('on', on);
  }

  toggleControls() { $('controls').classList.toggle('hidden'); }

  role(role: Role, npc: boolean) {
    const b = $('role-badge');
    b.textContent = role === 'collector' ? 'YOU ARE A BILL COLLECTOR · hunt by sound' : npc ? 'NPC MODE · find a bro to revive you' : 'BRO';
    b.style.color = role === 'collector' ? 'var(--pink)' : npc ? 'var(--muted)' : '#7cc7ff';
    $('aura').classList.toggle('hidden', role === 'collector');
  }

  aura(v: number, on: boolean) {
    $('aura-fill').style.width = `${Math.max(0, Math.min(100, v))}%`;
    $('aura-text').textContent = `AURA ${Math.round(v)}${on ? ' · RING LIGHT ON' : ''}`;
    $('aura').classList.toggle('on', on);
  }

  hint(text: string) { $('hint').textContent = text; }

  feed(items: FeedItem[]) {
    const box = $('feed');
    for (const it of items) {
      const row = el('div', 'feed-item');
      const add = (cls: string, text: string) => row.appendChild(el('span', cls, text));
      switch (it.k) {
        case 'caught': add('six', it.a!); add('ico', 'COLLECTED'); add('bro', it.b!); break;
        case 'mog': add('bro', it.a!); add('ico', 'MOGGED'); add('six', it.b!); break;
        case 'revive': add('bro', it.a!); add('ico', 'REVIVED'); add('bro', it.b!); break;
        case 'letin': add('bro', it.a!); add('ico', 'LET IN'); add('bro', it.b!); break;
        case 'smash': add('six', it.a!); add('ico', 'SMASHED'); add('', it.b!); break;
        case 'join': add('bro', it.a!); add('', 'joined'); break;
        case 'leave': add('', `${it.a} left`); break;
        case 'event': row.classList.add('event'); add('', it.text!); break;
        default: add('', it.text ?? ''); break;
      }
      if (it.a === this.myName || it.b === this.myName) row.classList.add('mine');
      box.prepend(row);
      setTimeout(() => { row.style.opacity = '0'; }, 6500);
      setTimeout(() => row.remove(), 7200);
    }
    while (box.children.length > 7) box.lastElementChild!.remove();
  }

  chat(from: string, role: Role, text: string, sys?: boolean) {
    const log = $('chat-log');
    const line = el('div', `chat-line${sys ? ' sys' : ''}`);
    if (!sys) {
      line.appendChild(el('span', `who${role === 'collector' ? ' six' : ''}`, `${from}: `));
      line.appendChild(document.createTextNode(text));
    } else {
      line.textContent = text;
    }
    log.appendChild(line);
    while (log.children.length > 40) log.firstElementChild!.remove();
    // fade older lines when the chat is closed
    [...log.children].forEach((c, i, a) => {
      (c as HTMLElement).style.opacity = i >= a.length - 6 ? '1' : '0';
    });
    setTimeout(() => { if (!this.chatOpen) line.style.opacity = '0'; }, 10000);
  }

  /** Toggle the chat input. Returns the text to send when closing with content. */
  toggleChat(): { open: boolean; text?: string } {
    const input = $<HTMLInputElement>('chat-input');
    if (!this.chatOpen) {
      this.chatOpen = true;
      $('chat').classList.add('open');
      input.classList.remove('hidden');
      input.focus();
      return { open: true };
    }
    const text = input.value.trim();
    input.value = '';
    this.closeChat();
    return { open: false, text: text || undefined };
  }

  closeChat() {
    this.chatOpen = false;
    const input = $<HTMLInputElement>('chat-input');
    input.blur();
    input.classList.add('hidden');
    $('chat').classList.remove('open');
  }

  get isChatOpen() { return this.chatOpen; }

  scoreboard(on: boolean) { $('scoreboard').classList.toggle('hidden', !on); }

  scores(rows: ScoreRow[], myId: string, lobbyName: string) {
    $('score-title').textContent = `Scoreboard · ${lobbyName}`;
    const fill = (tableId: string, list: ScoreRow[], cols: Array<[string, (r: ScoreRow) => string | number]>) => {
      const t = $(tableId);
      t.replaceChildren();
      const head = el('tr');
      for (const [h] of cols) head.appendChild(el('th', '', h));
      t.appendChild(head);
      for (const r of list) {
        const tr = el('tr');
        if (r.id === myId) tr.classList.add('me');
        if (!r.alive) tr.classList.add('dead');
        for (const [, f] of cols) tr.appendChild(el('td', '', String(f(r))));
        t.appendChild(tr);
      }
      if (!list.length) {
        const tr = el('tr');
        const td = el('td', 'muted', 'nobody yet');
        td.setAttribute('colspan', String(cols.length));
        tr.appendChild(td);
        t.appendChild(tr);
      }
    };
    const ping = (r: ScoreRow) => (r.ai ? 'AI' : r.ping < 0 ? 'away' : `${r.ping}ms`);
    fill('score-bros', rows.filter((r) => r.role === 'bro'), [
      ['Name', (r) => `${r.n}${r.alive ? '' : ' (NPC)'}`], ['Score', (r) => r.score], ['Mogs', (r) => r.mogs],
      ['Revives', (r) => r.revives], ['Let in', (r) => r.letIns], ["collected", (r) => r.caught], ['Ping', ping],
    ]);
    fill('score-six', rows.filter((r) => r.role === 'collector'), [
      ['Name', (r) => r.n], ['Score', (r) => r.score], ['Catches', (r) => r.catches], ['Ping', ping],
    ]);
  }

  knock(id: number, from: string, side: number, expires: number, onAnswer: (ok: boolean) => void) {
    this.knockId = id;
    this.knockExpires = expires * 1000;
    this.knockTotal = Math.max(1, this.knockExpires - Date.now());
    $('knock-text').textContent = `${from} is knocking on your ${side === 0 ? 'front' : 'back'} door. Let them in?`;
    $('knock').classList.remove('hidden');
    $('knock-yes').onclick = () => onAnswer(true);
    $('knock-no').onclick = () => onAnswer(false);
  }

  get pendingKnock() { return this.knockId; }

  clearKnock(id?: number) {
    if (id !== undefined && id !== this.knockId) return;
    this.knockId = null;
    $('knock').classList.add('hidden');
  }

  tickKnock() {
    if (this.knockId === null) return;
    const left = this.knockExpires - Date.now();
    ($('knock-bar').firstElementChild as HTMLElement).style.width = `${Math.max(0, (left / this.knockTotal) * 100)}%`;
    if (left <= 0) this.clearKnock();
  }

  lobby(info: LobbyInfo, phase: Phase, myId: string, role: Role) {
    const panel = $('lobby-panel');
    const show = !info.quick && phase === 'lobby';
    panel.classList.toggle('hidden', !show);
    if (!show) return;
    $('lobby-title').textContent = info.name;
    $('lobby-code').textContent = info.code;
    $('lobby-host').textContent = info.host === myId
      ? `You're the host. ${info.private ? 'Private lobby: share the code.' : 'Public lobby.'} Start when your squad is in.`
      : `Waiting for ${info.hostName ?? 'the host'} to start the night.`;
    $('btn-start').classList.toggle('hidden', info.host !== myId);
    $('btn-role-bro').classList.toggle('ghost', role !== 'bro');
    $('btn-role-six').classList.toggle('ghost', role !== 'collector');
  }

  result(win: boolean, mvp?: string) {
    const r = $('result');
    r.classList.remove('hidden', 'win', 'lose');
    r.classList.add(win ? 'win' : 'lose');
    $('result-title').textContent = win ? 'W. TOUCHED GRASS.' : 'L + RATIO';
    $('result-sub').textContent = `${win ? 'The bros survived the night.' : 'The Bill Collectors got everyone.'}${mvp ? ` MVP: ${mvp}` : ''}`;
    setTimeout(() => r.classList.add('hidden'), 9000);
  }
}
