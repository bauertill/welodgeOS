# Brandon: Getting your machine ready

This is the "before you can start" checklist — the tools and access you need
installed once, before Claude Code can run We Lodge OS on your laptop. You've
used Claude Code already, so this assumes that part; it's just the plumbing
underneath it.

Go through this top to bottom. If something fails, don't troubleshoot it
yourself — screenshot the error and paste it into Claude Code (or ask Till).
That's faster than guessing.

## 1. A code editor

You need somewhere to open the project folder, even if Claude Code does the
actual writing.

- [ ] Install [Visual Studio Code](https://code.visualstudio.com/) (free)

## 2. Git and GitHub access

Git tracks every change to the project; GitHub is where the project itself
lives online.

- [ ] Install [Git](https://git-scm.com/downloads)
- [ ] Create a [GitHub](https://github.com/) account if you don't have one
- [ ] Ask Till to add you as a collaborator on the `welodgeOS` repository
- [ ] Confirm you can open the repository page on GitHub while logged in

## 3. Node.js and pnpm

Node runs the application; pnpm is the tool that downloads all the pieces it
depends on (this project uses pnpm rather than the `npm` that comes bundled
with Node).

- [ ] Install [Node.js](https://nodejs.org/) — the **LTS** version (the button
      labeled "Recommended for most users")
- [ ] Confirm it worked: open a terminal and run `node -v` — it should print a
      version number, not an error
- [ ] Install pnpm by running `npm install -g pnpm` in a terminal
- [ ] Confirm it worked: run `pnpm -v` — it should print a version number

## 4. Docker Desktop

The app needs a database to store events, properties and bookings. Docker is
what runs that database on your laptop without you having to install Postgres
by hand.

- [ ] Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [ ] Open it once after installing and let it finish starting up (you'll see
      a whale icon settle in your menu bar)
- [ ] Leave Docker Desktop running whenever you're working on the project

## 5. Get the project onto your machine

- [ ] Open a terminal, navigate to a folder where you keep projects, and run:
      `git clone git@github.com:bauertill/welodgeOS.git`
- [ ] Open the resulting `welodgeOS` folder in VS Code

## 6. Claude Code

- [ ] Confirm Claude Code runs inside the `welodgeOS` folder (open a terminal
      in that folder and start it as usual)

## 7. The one file you need to create by hand

The project needs a small file of secrets and settings that is deliberately
**not** stored in GitHub, called `.env`.

- [ ] In the project folder, make a copy of `.env.example` and rename the copy
      to `.env`
- [ ] Ask Till for the values to put in it (or leave the sign-in ones blank —
      see below)

You don't need real sign-in credentials to start. Once `.env` exists, the app
has a **development sign-in** button that logs you in as a test user with one
click — no Google account, no email, nothing to configure.

## 8. First run

Once everything above is checked off, ask Claude Code to run these commands
from the project folder (this is also written down in `README.md`):

```
pnpm install
./start-database.sh
pnpm run db:push
pnpm run db:seed
pnpm run dev
```

Then open <http://localhost:3000> in your browser. If you see the We Lodge
sign-in page, you're set up.

## If something goes wrong

Paste the exact error into Claude Code and ask it to fix it — that's normal,
not a sign you did something wrong. If Claude Code itself is stuck, ask Till.
