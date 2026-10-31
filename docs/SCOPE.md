# Bro Chase: Project Scope

> Every thread reads this file, [MEMORY.md](MEMORY.md) and [IDEAS.md](IDEAS.md) before starting work.
> If a request conflicts with this scope, follow the newest decision from Moiz and record it in MEMORY.md.

## One-line pitch

A brain-rot themed, online co-op survival horror game you play in the browser: bros hide in their cribs,
the blind **Opps** hunt them by sound, and when your door breaks you run to a friend's crib and hope they let you in.

## What the game is

- **Genre:** co-op survival horror / defend-your-base, in the same genre as Silent Castle, but an
  **original game** with its own world, rules, names and items. Never copy another game's content.
- **Platform:** web browser, online multiplayer. No install. Desktop first, phone supported with touch controls.
- **View:** 2.5D. A Babylon.js 3D world under an angled camera, with game logic on a flat 2D grid.
- **Theme:** brain-rot memes (67, aura, mog, rizz, Ohio, sigma, "we outside", W/L, NPC).
  Bright, funny and readable, not grim.
- **Players:** no player cap. One Opp per 4 bros (rounded up). AI fills empty Opp slots.

## Core loop (one night)

1. **Pregame (about 45s).** Everyone spawns in the plaza, picks any free crib and walks in to claim it.
   Grab cash from the streets.
2. **Lock-in (the night, about 7 min).** The Opps come out. They are blind and hunt by noise.
   Bros defend their cribs (doors, defences, ring light), sneak out for cash and aura, and help each other.
3. **Escape and knock.** Every crib has a front and a back door, locked by default. If an Opp smashes in,
   run out the other door to a friend's crib and knock. Only the owner can let you in.
4. **Caught.** A caught bro becomes an NPC ghost. A living bro standing next to them for 3 seconds revives them.
5. **Touch grass (results, about 12s).** Scores, then a new night. Cash and gear carry over while you stay in the room.

Random short modes interrupt the night for 10 to 20 seconds each: power cut, fog, Opp rage, low gravity, disco, aura rain.

## Features in scope (built)

| Area | What's in |
| --- | --- |
| Accounts | Guest account bound to the device, optional username + password later, guest captcha (Turnstile or proof-of-work) |
| Lobbies | Quick play, public lobbies, private lobbies with invite code/link, host starts the night |
| Character | Character creator before joining (skin, hair, outfit, colours, hat, drip), changeable in the lobby |
| Roles | Play as a bro or as an Opp (screech, lunge, door smashing, sound vision, vents) |
| Movement | Walk (quiet), normal, sprint (loud), jump, double/triple jump with kicks |
| Noise | Every action makes a noise ripple the Opps can hear |
| Economy | Cash from pickups, revives, let-ins, mogs, surviving. Shop (B) |
| Items | Banana peel, energy drink, decoy speaker, bribe, aura pack |
| Upgrades | Door armour (3 levels), auto-repair, kicks (3 tiers), body armour (3 tiers), each with its own look |
| Defences | Rizz Blaster turret, Aura Lamp, Bass Drop speaker, 3 levels each, can be wrecked and repaired |
| Social | Counter-Strike style kill feed, Tab scoreboard, in-game chat |
| Feel | Intro card with controls, on-screen controls (H), aura +/- popups, kill-streak callouts, particles, camera shake, post-processing, positional audio |
| World | Every crib looks different; cats and dogs roam the streets as scenery; manholes (vents) on every block |

## Out of scope (do not add)

- Fences
- Goo Mat
- A generator (power cuts end on their own)
- Pets inside cribs, or pets that affect gameplay
- Doors that open automatically, for any reason
- The "Bill Collector" or "Sixseven" as the monster (it is the Opps)
- A dark game overall (only power cuts are dark)
- Pay-to-win (if anything is ever sold, it is cosmetic)
- Copied content from Silent Castle or any other game

## Tech

| Layer | Choice |
| --- | --- |
| Client | Babylon.js + TypeScript, built with Vite (`client/`). Moving from Three.js (decided 2026-10-31) |
| Server | Node.js 22.13+, Express + `ws` WebSockets, authoritative simulation at 20 ticks/s (`server/`) |
| Shared rules | `shared/` (constants, protocol, world, gear, look) used by client and server |
| Data | SQLite via built-in `node:sqlite` (`data/bro-chase.db`) |
| Tests | `npm test` (node test runner, `test/`) |

## How we work

- Every change goes in a PR on `muhammadmoiz65/bro-chase`. Tell Moiz to run it with:
  `git pull && npm run build && npm start` (then open http://localhost:3000).
- New decision from Moiz: add it to `docs/MEMORY.md` in the same PR.
- New idea: add it to `docs/IDEAS.md` with how it makes the game better.
- Replies to Moiz are short and in plain language.
- Testing: Moiz skips or restarts testing per request. Check MEMORY.md for the current rule.
