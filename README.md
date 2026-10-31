# Bro Chase

Survive the night. Don't get caught.

A brain-rot themed, online co-op survival horror game in the browser (2.5D, Babylon.js). Every bro gets a
crib with a front and a back door, locked by default. Opps are blind and hunt by sound. When one
smashes in, run out the other door to a friend's crib and knock: they decide whether to let you in.

## Features

- No player cap: the neighbourhood grows a crib for every bro who joins
- One Opp per 4 bros (rounded up); AI fills slots, players can take one while the 4:1 ratio holds
- Ring light (mogs an Opp that gets close, burns aura), jumping yard fences, noise ripples
- Night events: power failure (fix the generator), aura rain, Ohio fog, Opp rage
- NPC mode when caught; a living bro next to you for 3 seconds revives you
- Counter-Strike style kill feed, Tab scoreboard, in-game chat
- Quick play, public lobbies, and private lobbies with invite codes / links; the host starts the night
- Guest accounts bound to the device, optional username + password to sign in on other devices
- Guest captcha: Cloudflare Turnstile if configured, otherwise a built-in proof-of-work check
- Touch controls on phones

## Run it locally

Needs Node 22.13 or newer.

```bash
npm install
npm run build
npm start          # open http://localhost:3000
```

For development with hot reload: `npm run dev` and open http://localhost:5173.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | HTTP + WebSocket port |
| `DB_FILE` | `data/bro-chase.db` | SQLite file for accounts |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET` | unset | Use Cloudflare Turnstile as the guest captcha |
| `POW_BITS` | `16` | Difficulty of the built-in proof-of-work captcha |

## Controls

`WASD` move · `Shift` zoom (loud) · `Space` jump · `F` ring light · `E` open your door / knock / smash ·
hold `R` repair or fix the generator · `Y`/`N` answer a knock · `Tab` scores · `Enter` chat
