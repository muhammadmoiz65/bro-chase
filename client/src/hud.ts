// DOM HUD: timer, kill feed, chat, Tab scoreboard, knock prompt, lobby panel.
// Everything user-written is set with textContent, never innerHTML.

import type { FeedItem, LobbyInfo, Phase, Role, ScoreRow, SelfView, WorldEvents } from '../../shared/protocol.ts';
import { DEF, DEF_KINDS, DEFENCE, GEAR, MONSTER, VENT, SHOP, type DefKind, type ShopId } from '../../shared/constants.ts';

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

  timer(phase: Phase, phaseEnd: number, night: number, counts: { bros: number; alive: number; opps: number }) {
    const p = $('phase');
    p.textContent = phase === 'lockin' ? `LOCK IN · NIGHT ${night}` : PHASE_NAMES[phase];
    p.classList.toggle('lockin', phase === 'lockin');
    const left = phaseEnd ? Math.max(0, Math.ceil((phaseEnd - Date.now()) / 1000)) : 0;
    $('timer').textContent = phase === 'lobby' ? 'WAITING' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    $('counts').textContent = `Bros ${counts.alive}/${counts.bros} alive · Opps ${counts.opps}`;
  }

  private lastMode: string | null = null;

  events(ev: WorldEvents) {
    const b = $('event-banner');
    const left = ev.modeEnd ? Math.max(0, Math.ceil((ev.modeEnd - Date.now()) / 1000)) : 0;
    const names: Record<string, string> = {
      blackout: `POWER CUT · ${left}s · lamps are dead, stay quiet`,
      fog: `OHIO FOG · ${left}s`,
      rage: `OPP RAGE · ${left}s`,
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

  auraPop(d: number, why: string, cash = false) {
    const box = $('aura-pops');
    const pop = el('div', `aura-pop ${d >= 0 ? 'up' : 'down'}`, cash ? `${d >= 0 ? '+' : '-'}$${Math.abs(d)}` : `${d >= 0 ? '+' : ''}${d} AURA`);
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

  wallet(you: SelfView) {
    $('cash').textContent = `$${you.cash}`;
    $('shop-cash').textContent = `$${you.cash}`;
    for (const k of ['trap', 'drink', 'decoy', 'bribe'] as const) {
      $(`inv-${k}`).textContent = String(you.inv[k]);
      $(`inv-${k}`).parentElement!.classList.toggle('empty', you.inv[k] <= 0);
    }
    const fx: string[] = [];
    if (you.drink) fx.push(`ENERGY DRINK ${you.drink}s`);
    if (you.bribe) fx.push(`BRIBED ${you.bribe}s`);
    if (you.vest) fx.push(`ARMOUR ${'◆'.repeat(you.shields)}${'◇'.repeat(Math.max(0, GEAR.vest[you.vest].shields - you.shields))}`);
    if (you.kicks) fx.push(GEAR.kicks[you.kicks].airJumps > 1 ? 'TRIPLE JUMP' : 'DOUBLE JUMP');
    $('effects').textContent = fx.join(' · ');
    const bro = you.role === 'bro';
    $('wallet').classList.toggle('hidden', !bro);
    $('items').classList.toggle('hidden', !bro);
    this.you = you;
    if (this.shopOpen) this.refreshShop();
  }

  private you: SelfView | null = null;
  shopOpen = false;
  onBuy: (id: ShopId) => void = () => {};
  onBuild: (k: DefKind) => void = () => {};
  onUpgrade: (k: DefKind) => void = () => {};

  toggleShop(force?: boolean) {
    this.shopOpen = force ?? !this.shopOpen;
    $('shop').classList.toggle('hidden', !this.shopOpen);
    this.shopKey = '';
    if (this.shopOpen) this.refreshShop();
  }

  private shopKey = '';
  /** Rebuild the shop only when what it lists changes; otherwise just enable/disable buttons for the cash you have.
   *  (Re-creating the buttons every snapshot swallowed clicks.) */
  private refreshShop() {
    const you = this.you;
    if (!you) return;
    const key = JSON.stringify([you.inv, you.armor, you.autorepair, you.defLv, you.defCount, you.role]);
    if (key !== this.shopKey) { this.shopKey = key; this.renderShop(); }
    $('shop-list').querySelectorAll<HTMLButtonElement>('button[data-price]').forEach((b) => {
      b.disabled = b.dataset.lock === '1' || you.cash < Number(b.dataset.price);
    });
  }

  private renderShop() {
    const you = this.you;
    if (!you) return;
    const list = $('shop-list');
    const rows: ShopId[] = ['kicks', 'vest', 'armor', 'autorepair', 'trap', 'drink', 'decoy', 'bribe', 'aura'];
    list.replaceChildren();
    list.appendChild(el('h3', 'shop-sec', `Defences (${you.defCount}/${DEF.maxPerCrib} built) · built where you stand, in or around your crib`));
    for (const k of DEF_KINDS) {
      const d = DEFENCE[k];
      const lv = you.defLv[k];
      const row = el('div', 'shop-row');
      const info = el('div', 'info');
      info.appendChild(el('b', '', `${d.name} (level ${lv}/3)`));
      info.appendChild(el('span', '', d.desc));
      const b1 = el('button', '', `Build $${d.build}`) as HTMLButtonElement;
      b1.dataset.price = String(d.build);
      b1.dataset.lock = you.defCount >= DEF.maxPerCrib || you.role !== 'bro' ? '1' : '0';
      b1.onclick = () => this.onBuild(k);
      const up = lv >= 3 ? null : d.upgrade[lv - 1];
      const b2 = el('button', 'up', up === null ? 'MAX' : `Lv${lv + 1} $${up}`) as HTMLButtonElement;
      b2.dataset.price = String(up ?? 0);
      b2.dataset.lock = up === null ? '1' : '0';
      b2.onclick = () => this.onUpgrade(k);
      row.append(info, b1, b2);
      list.appendChild(row);
    }
    list.appendChild(el('h3', 'shop-sec', 'Crib and items'));
    for (const id of rows) {
      const def = SHOP[id];
      let price: number | null;
      let label = def.name;
      if (id === 'armor') {
        price = you.armor >= 3 ? null : (def.price as number[])[you.armor];
        label = `${def.name} (level ${you.armor}/3)`;
      } else if (id === 'kicks' || id === 'vest') {
        const tier = you[id] ?? 0;
        const tiers = GEAR[id];
        price = tier >= GEAR.maxTier ? null : (def.price as number[])[tier];
        label = tier >= GEAR.maxTier ? `${tiers[tier].name} (max)` : tier ? `${tiers[tier].name} → ${tiers[tier + 1].name}` : `${def.name}: ${tiers[1].name}`;
      } else if (id === 'autorepair') price = you.autorepair ? null : (def.price as number);
      else price = def.price as number;
      if (id in you.inv) label += ` (have ${you.inv[id as keyof SelfView['inv']]})`;
      const row = el('div', 'shop-row');
      const info = el('div', 'info');
      info.appendChild(el('b', '', label));
      info.appendChild(el('span', '', def.desc));
      const btn = el('button', '', price === null ? 'OWNED' : `$${price}`) as HTMLButtonElement;
      btn.dataset.price = String(price ?? 0);
      btn.dataset.lock = price === null || you.role !== 'bro' ? '1' : '0';
      btn.onclick = () => this.onBuy(id);
      row.append(info, btn);
      list.appendChild(row);
    }
  }

  toggleControls() { $(this.wasOpp ? 'controls-opp' : 'controls').classList.toggle('hidden'); }

  private introTimer = 0;
  /** Intro card for the first seconds of a session: what the game is and the controls. */
  intro(sec = 12, opp = false) {
    const box = $('intro');
    box.classList.toggle('opp', opp);
    const bar = $('intro-bar').firstElementChild as HTMLElement;
    box.classList.remove('hidden', 'fade');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = `width ${sec}s linear`;
      bar.style.width = '0%';
    }));
    clearTimeout(this.introTimer);
    this.introTimer = window.setTimeout(() => this.closeIntro(), sec * 1000);
    $('intro-close').onclick = () => this.closeIntro();
  }

  get introOpen() { return !$('intro').classList.contains('hidden') && !$('intro').classList.contains('fade'); }

  closeIntro() {
    const box = $('intro');
    if (box.classList.contains('hidden')) return;
    clearTimeout(this.introTimer);
    box.classList.add('fade');
    setTimeout(() => box.classList.add('hidden'), 500);
    $(this.wasOpp ? 'controls-opp' : 'controls').classList.remove('hidden'); // keep a small controls card after the intro
  }

  private wasOpp = false;

  /** Opp abilities, the heartbeat glow, the queue note, and the role-specific controls card. */
  hunter(you: SelfView, phase: Phase) {
    const opp = you.role === 'opp';
    $('hud').classList.toggle('opp', opp);
    $('hunter').classList.toggle('hidden', !opp);
    const q = $('queued');
    q.classList.toggle('hidden', !you.wantOpp);
    q.textContent = you.wantOpp ? 'Queued for an Opp slot' : '';
    if (opp !== this.wasOpp) {
      this.wasOpp = opp;
      const showing = !$('controls').classList.contains('hidden') || !$('controls-opp').classList.contains('hidden');
      $('controls').classList.toggle('hidden', opp || !showing);
      $('controls-opp').classList.toggle('hidden', !opp || !showing);
    }
    if (!opp) { $('heartbeat').style.opacity = '0'; return; }
    const night = phase === 'lockin';
    const ab = (id: string, left: number, total: number) => {
      const box = $(id);
      const ready = night && left <= 0;
      box.classList.toggle('cd', !ready);
      box.querySelector('b')!.textContent = !night ? 'at night' : ready ? 'READY' : `${Math.ceil(left)}s`;
      (box.querySelector('i') as HTMLElement).style.width = `${ready || !night ? 0 : (left / total) * 100}%`;
    };
    ab('ab-screech', you.scr ?? 0, MONSTER.screechCd);
    ab('ab-lunge', you.lun ?? 0, MONSTER.lungeCd);
    ab('ab-vent', you.vcd ?? 0, VENT.cd + VENT.travelSec);
    if (you.vnt) $('ab-vent').querySelector('b')!.textContent = 'CRAWLING';
    $('heartbeat').style.opacity = String(Math.min(0.9, (you.sense ?? 0) * 1.1));
  }

  /** One thump of the heartbeat glow. */
  beat() {
    const h = $('heartbeat');
    h.classList.remove('beat');
    void h.offsetWidth;
    h.classList.add('beat');
  }

  /** Arrows at the screen edge pointing to sounds off-screen. */
  compass(marks: Array<{ x: number; y: number; a: number; o: number; loud: boolean }>) {
    const box = $('sound-compass');
    while (box.children.length < marks.length) box.appendChild(el('div', 'snd'));
    [...box.children].forEach((c, i) => {
      const m = marks[i];
      const e = c as HTMLElement;
      if (!m) { e.style.opacity = '0'; return; }
      e.style.opacity = String(m.o);
      e.style.left = `${m.x - 9}px`;
      e.style.top = `${m.y - 12}px`;
      e.style.transform = `rotate(${m.a + Math.PI / 2}rad)`;
      e.classList.toggle('loud', m.loud);
    });
  }

  role(role: Role, npc: boolean) {
    const b = $('role-badge');
    b.textContent = role === 'opp' ? 'OPP · blind, hunt by sound' : npc ? 'NPC MODE · find a bro to revive you' : 'BRO';
    b.style.color = role === 'opp' ? 'var(--pink)' : npc ? 'var(--muted)' : '#7cc7ff';
    $('aura').classList.toggle('hidden', role === 'opp');
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
        case 'caught': add('six', it.a!); add('ico', 'CAUGHT LACKIN'); add('bro', it.b!); break;
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
      line.appendChild(el('span', `who${role === 'opp' ? ' six' : ''}`, `${from}: `));
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
      ['Revives', (r) => r.revives], ['Let in', (r) => r.letIns], ['Caught', (r) => r.caught], ['Ping', ping],
    ]);
    fill('score-six', rows.filter((r) => r.role === 'opp'), [
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
    $('btn-role-six').classList.toggle('ghost', role !== 'opp');
  }

  /** `win` is the bros' result; an Opp player sees it from their side. */
  result(win: boolean, mvp?: string, role: Role = 'bro') {
    const r = $('result');
    const good = role === 'opp' ? !win : win;
    r.classList.remove('hidden', 'win', 'lose');
    r.classList.add(good ? 'win' : 'lose');
    const title = role === 'opp' ? (good ? 'W. CAUGHT EM ALL.' : 'L. THEY TOUCHED GRASS.') : (good ? 'W. TOUCHED GRASS.' : 'L + RATIO');
    $('result-title').textContent = title;
    $('result-sub').textContent = `${win ? 'The bros survived the night.' : 'The Opps got everyone.'}${mvp ? ` MVP: ${mvp}` : ''}`;
    setTimeout(() => r.classList.add('hidden'), 9000);
  }
}
