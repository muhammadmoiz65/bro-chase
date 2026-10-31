# Bro Chase: Memory

> Every decision and critical fact for the project. Read it before starting work.
> Add new decisions from Moiz here in the same PR as the change. Newest decision wins.
> Format: date, decision, and why or where it came from. Don't delete old entries; mark them **Replaced**.

## Identity

- **Name:** Bro Chase. Repo: `muhammadmoiz65/bro-chase`. Owner: Moiz.
- **Original game.** It is in the Silent Castle genre, but not a copy. Our own world, names, items and rules. (2026-10-31)
- **Started as "Lanternfall"** (sea fortress, a monster called the Hush, Phaser 2D). That plan is
  **Replaced** by Bro Chase. The original plan doc is [Lanternfall: game plan](https://claude.ai/artifact/XBUpgKzDeWzJdNUn5tgLkc) for history only.

## Decisions from Moiz

### Platform and look
- 2026-10-31: **Web based and online.**
- 2026-10-31: **2.5D with Three.js** (3D world, angled camera, 2D grid logic). Replaced an earlier pick of 2D top-down Phaser.
  **Replaced** by Babylon.js (next entry).
- 2026-10-31: **Switch the client engine to Babylon.js.** Moiz said "I think we need to change our game engine", saw the side-by-side
  test (`proto/engines/`, [ENGINE-TEST.md](ENGINE-TEST.md)) and chose Babylon.js on the decision card, over the recommendation to stay
  on Three.js. Still 2.5D, still a browser game, server and `shared/` unchanged. The move happens in 3 PRs: (1) engine core + world,
  (2) characters, gear looks, creator, (3) effects, post-processing, then remove Three.js. Don't add new Three.js code.
- 2026-10-31: **Brain-rot theme** (memes like 67, aura, mog, rizz, Ohio).
- 2026-10-31: **Bright game.** Only power cuts are dark. Moiz asked twice that it not be dark.
- 2026-10-31: Power cuts are **random and last 10 to 20 seconds**, with smooth transitions. Other short random modes too (fog, rage, low gravity, disco, aura rain).
- 2026-10-31: **More realistic look and better graphics** are an ongoing goal (grass, roads, trees, cars, animated characters, post-processing).
- 2026-10-31: **Every crib has a different design.**
- 2026-10-31: Upgrades **change the look** at every level (doors, defences, kicks, armour).

### The monster
- 2026-10-31: The monster is **the Opps** (hoodie, ski mask, "we outside"). Blind, hunts by sound.
  - **Replaced:** "Sixseven" (the 67 monster), then "Bill Collector". Moiz said Bill Collector "sounds wrong".
  - Moiz may still say "bill collector" or "monster". It means the Opps.
- 2026-10-31: **Players can play as an Opp.**
- 2026-10-31: **Vents** for the Opps: manholes on every block, V to travel up to 3 blocks, clank warns bros.

### Players and accounts
- 2026-10-31: **Unlimited players**, with a **4:1 player-to-Opp ratio** (one Opp per 4 bros, rounded up).
  AI fills empty Opp slots. Bot bros fill in so a player Opp keeps the ratio.
- 2026-10-31: **Guest-friendly accounts bound to the device**, with an option to set a password later.
- 2026-10-31: **Captcha for guests.**
- 2026-10-31: **Own lobbies**, including private ones.
- 2026-10-31: **Customizable character** when starting.

### Cribs and doors
- 2026-10-31: **Two doors (gates) per crib** so you can escape out the other side and run to a friend's crib.
- 2026-10-31: **Doors are locked by default and only open with the owner's approval.** No auto-open, even if the owner is idle.
- 2026-10-31: **Pregame starts with players in the world**, and each player settles in any crib they choose.

### Gameplay
- 2026-10-31: **Jump** is in. **No fences.**
- 2026-10-31: **Walk mode and footsteps** the monster can hear.
- 2026-10-31: **Coins (cash), items and upgrades** with a shop.
- 2026-10-31: **Defence items and turrets** (Rizz Blaster, Aura Lamp, Bass Drop).
- 2026-10-31: **No Goo Mat.**
- 2026-10-31: **No generator.** Power cuts end on their own.
- 2026-10-31: **Shoes** (double jump, run faster) and **armour**, with tiers.
- 2026-10-31: **Cats and dogs are environment only**, roaming the open world. Not in cribs, not part of gameplay.

### UI and feel
- 2026-10-31: **Counter-Strike style kill feed, Tab scoreboard, in-game chat.**
- 2026-10-31: **Controls shown on screen**, and an **intro** for the first seconds that explains the game and controls.
- 2026-10-31: **Aura +/-** popups for good and bad plays.
- 2026-10-31: **Kill-streak effects** like multi kill and monster kill (shipped as DOUBLE ... MONSTER MOG, sprees, SHUTDOWN).

### Process
- 2026-10-31: **Testing was skipped** ("skip testing in all threads"), then **restarted** ("all done? start testing").
  Current rule: testing is **on**. Run `npm test` and check changes before pushing, unless Moiz says to skip again.
- 2026-10-31: **Separate threads per task** are fine (graphics, gear, Opp mode, creator, testing ran in parallel).
- 2026-10-31: **Project docs:** `docs/SCOPE.md`, `docs/MEMORY.md`, `docs/IDEAS.md`. Every thread reads them first and keeps them updated.
- Every change ships in a PR. Run command for Moiz: `git pull && npm run build && npm start`.
- Keep replies to Moiz short and in plain language.

## Open questions (Moiz hasn't decided)

- Free with cosmetics, or paid? (The old plan recommended free with cosmetics only.)
- Hosting for a public server (not set up yet; the game runs locally).

## Critical facts

### Running it
- Needs **Node 22.13 or newer** (uses built-in `node:sqlite`). Moiz's MacBook has Node v22.19 and npm 10.9.3 (nvm).
- Local copy on Moiz's Mac: `~/Downloads/CT/bro-chase`, opened in VS Code.
- Run: `npm install && npm run build && npm start`, open http://localhost:3000. Stop with Ctrl+C,
  or `lsof -ti :3000 | xargs kill`.
- Dev with hot reload: `npm run dev`, open http://localhost:5173.
- Claude can't run `npm install` on the Mac through Remote Control (blocked by the Mac's permission check), so Moiz runs it.
- Env vars: `PORT` (3000), `DB_FILE` (`data/bro-chase.db`), `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET`, `POW_BITS` (16).

### Code map
- `server/` game simulation (`game.ts`), rooms/lobbies (`rooms.ts`), accounts (`accounts.ts`), captcha, pathfinding.
- `shared/constants.ts` holds all tunables (speeds, noise, prices, phase lengths, 4:1 ratio as `BROS_PER_MONSTER`).
- `shared/gear.ts`, `shared/look.ts` gear tiers and character looks. `shared/protocol.ts` messages.
- `client/src/` renderer (`render.ts`), HUD, input, audio, avatar, creator, effects (`fx/`), upgrade models.
- Server is Express + `ws`, not Colyseus (the old plan said Colyseus).

### Controls (bro)
`WASD` move · `Shift` sprint (loud) · `C` or `Ctrl` walk (quiet) · `Space` jump · `F` ring light ·
`E` open your door / knock / smash · hold `R` repair · `Y`/`N` answer a knock · `B` shop · `1`-`4` items ·
`Tab` scores · `Enter` chat · `H` controls · `+`/`-` or wheel zoom.

### Controls (Opp)
`Q` screech (marks nearby bros) · `Space` lunge · `E` smash doors and defences · `V` vent.

### History
- v0.1 base game · v0.2 Bill Collector, walk mode, brighter, random modes · v0.3 daylight, intro, cash + shop ·
  v0.4 Opps, crib claiming, unique cribs, defences, shop fix.
- PR #1 gear + upgrade looks · PR #2 character creator · PR #3 play as Opp · PR #4 graphics + kill callouts · PR #5 vents. All merged.

### Free 3D models
- From the cloud, kenney.nl, poly.pizza and quaternius.com are blocked, but `raw.githubusercontent.com` works.
  CC0 models that load from there: Kenney starter kits (`KenneyNL/Starter-Kit-City-Builder/main/models/*.glb`,
  `KenneyNL/Starter-Kit-3D-Platformer/main/models/*.glb`, each with `models/Textures/colormap.png`) and the three.js examples
  (`mrdoob/three.js/r170/examples/models/gltf/RobotExpressive/RobotExpressive.glb`, HDR skies in `examples/textures/equirectangular/`).
- Engine test runs with `npm run proto` on port 5174 (needs the game server on 3000).

### Known issues
- `README.md` is out of date: it still mentions fences, the generator and "Opp rage / Ohio fog" naming. Update it when touching docs.
