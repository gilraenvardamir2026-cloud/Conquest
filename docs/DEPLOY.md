# Putting Conquest Tabletop online (Render, free plan)

This guide puts the game on the internet at an address like
`https://conquest-tabletop.onrender.com`, so you and your opponent can each
open it in a browser. It uses [Render](https://render.com)'s free plan: no
credit card, nothing to install on your computer. Expect about 15 minutes the
first time.

## What the free plan means for games

| | |
|---|---|
| **Cost** | Free. Enough monthly hours for one always-on service. |
| **Sleeping** | After 15 minutes with nobody connected, the server goes to sleep. The next visit wakes it, which takes about a minute (the page just loads slowly). |
| **During a game** | Every open game page sends the server a small signal every 25 seconds, so it stays awake as long as someone has the game open. |
| **Saved games** | None to worry about: the server forgets rooms when it restarts or sleeps. Games are meant to be played in one sitting. |
| **If the server restarts mid-game** | The players' browsers notice, put the game back exactly as it was, and give everyone their seat back. The banner shows "Restoring the game…" for a second or two. This works as long as at least one seated player still has the page open. |
| **Army lists** | Saved as files on your own computer (*Army list… → Save to file*), so restarts never touch them. |

## 1. Create a Render account

1. Go to [render.com](https://render.com) and choose **Get Started**.
2. Sign up with **GitHub**. Using the same GitHub account that holds the
   `conquest` repository makes the next step simpler.
3. When Render asks for access to your repositories, allow access to the
   `conquest` repository (or to all repositories).

## 2. Create the service from the blueprint

The repository contains `render.yaml`, which tells Render everything it needs:
build with the `Dockerfile`, use the free plan, check `/healthz` to know the
server is up.

1. In the Render dashboard choose **New → Blueprint**.
2. Pick the `conquest` repository.
3. Choose the **branch** to deploy. The work is currently on
   `claude/exciting-mccarthy-7bkteh`; once it is merged, use `main`.
4. Render shows one service, **conquest-tabletop**, on the **Free** plan.
   There is nothing to fill in (dice need no key, see step 3).
5. Choose **Apply** (or **Deploy Blueprint**).

The first build takes about 5 minutes. When the status turns **Live**, the
address is at the top of the service page. Open it: you should see the
Conquest Tabletop home page.

*Prefer clicking through by hand?* **New → Web Service**, pick the repository
and branch, set **Language** to **Docker**, **Instance Type** to **Free**,
and **Health Check Path** to `/healthz`. The result is the same.

## 3. Dice (nothing to set up)

Dice come from [drand](https://drand.love), a free public randomness beacon
run by Cloudflare, universities and others. There is no account and no key.
Each roll waits for drand's next number (at most 3 seconds) and records which
one it used; the **Check** button in the dice tray lets either player confirm
the dice in their own browser. If drand cannot be reached, the server uses its
own random numbers and marks those rolls *local*.

*Prefer RANDOM.ORG?* Create a key at [api.random.org](https://api.random.org)
(**API Keys → Create a new key**), then in Render open the service →
**Environment** → add `RANDOM_ORG_API_KEY` → **Save, rebuild and deploy**.
Keep the key only in Render, never in the code or a chat. To keep every roll
on the server instead, set `DICE_SOURCE` to `local`.

## 4. Play

1. Open the site, enter your name, choose a scenario and terrain,
   **Create battle**.
2. **Copy link** (top bar) and send it to your opponent.
3. Each of you takes a seat. Anyone else who opens the link can watch.

If the page takes a minute to appear, the server was asleep; that is normal
on the free plan.

## 5. Updating to a newer version

`render.yaml` turns automatic deploys off, so a code change never restarts the
server in the middle of your game. To update:

1. Make sure nobody is playing.
2. Render → the service → **Manual Deploy → Deploy latest commit**.

## Troubleshooting

| What you see | What to do |
|---|---|
| The page loads for about a minute | The server was asleep. Wait; it is waking up. |
| "Room not found" when opening an old link | The server slept or restarted after everyone left. Create a new battle (load your army lists again). |
| Dice say "local" | Settings → Dice shows the reason (drand unreachable, or a RANDOM.ORG problem). Dice keep working from the server's own random numbers meanwhile. |
| The deploy failed | Render → service → **Logs** shows the error. **Manual Deploy → Clear build cache & deploy** fixes most one-off failures. |
| The server keeps restarting | Check **Logs**. The free plan has 512 MB of memory; one game uses only a few MB. |

## Running the same container yourself

Anywhere Docker runs:

```sh
docker build -t conquest .
docker run -p 3001:3001 conquest
```

Then open http://localhost:3001. Rooms are kept in `/data` inside the
container. To keep them across restarts, add `-v conquest-data:/data`.
