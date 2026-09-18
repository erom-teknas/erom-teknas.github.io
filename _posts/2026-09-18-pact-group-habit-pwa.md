---
title: "Pact: a group habit tracker with a live leaderboard, built in a day with AI agents"
date: 2026-09-18 10:00:00 -0400
categories: [🧠 AI Engineering, 📱 Web Apps]
tags: [ai, vibe coding, react, supabase, postgres, pwa, vercel]
description: How Pact keeps a shared habit leaderboard honest with an append-only Postgres ledger, two habit modes in one schema, and Supabase Realtime.
---

## Overview 📝
[Pact](https://pact-deploy.vercel.app) is a small PWA for group habit challenges. Friends join a group with a six character PIN, agree on five daily habits, and compete on a leaderboard that updates live while everyone checks in. A done habit is one point, and finishing all of your habits for the day adds a one point "perfect day" bonus.

The first commit and the tenth merged PR are about 25 hours apart. I did not write most of that code by hand. I directed autonomous AI coding agents (Claude Opus 5 worker agents, run and supervised by firstmate, an open source orchestrator for a crew of coding agents). I made the product calls, reviewed the PRs, and tested on the live app myself. Every feature and fix commit carries a `Co-authored-by: Claude Opus 5` trailer. This post covers the design decisions that held up and the bugs that got through anyway.

> "Vibe coding" is a fair label for how the code got typed. It is not a fair label for how it got checked. Every PR had to pass unit tests, database tests against the real migrations, and Playwright end to end runs, both against a local stand-in and against a real Supabase stack.
{: .prompt-info }

## Stack 🧰
- **Frontend:** React 19, Vite 8, TypeScript 6 and React Router. TanStack Query holds all server state; there is no Redux or Zustand. Styling is one token based CSS file (no Tailwind).
- **PWA:** `vite-plugin-pwa` with `injectManifest` and a hand written service worker. It precaches only the app shell. Data always comes from Supabase over the network and is never served from the cache. Updates use `registerType: 'prompt'`, so a new version never swaps in under someone mid check-in.
- **Backend:** Supabase: Postgres, Auth (email OTP plus guest sign-in) and Realtime.
- **Hosting:** Vercel, git connected. `main` deploys to production and every PR gets a preview. `vercel.json` sets a strict CSP (`script-src 'self'`, `worker-src 'self'`, and `connect-src` limited to the Supabase host). That CSP comes back later as a bug.
- **Tests:** Vitest with two projects. One runs unit tests in jsdom pinned to `TZ=UTC`. The other runs the real SQL migrations on PGlite, an in-process Postgres. Playwright covers the end to end flows.

## All the rules live in Postgres 🐘
The main architectural decision is that the client is dumb. Every business rule is a Postgres function, every function is `security definer` with `search_path = ''`, and the platform migration takes every write path away from the client before granting the RPCs back one by one:

```sql
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all tables in schema public from anon;
-- Private bookkeeping tables are not readable at all.
revoke all on public.pin_attempts from authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
-- ...then each RPC is granted by name
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
```

The last line matters most: a function added in a later migration is not callable until someone grants it on purpose. RLS policies are all select only, scoped through helpers like `my_group_ids()`. The app reads through RPCs anyway, but the policies still matter because Supabase Realtime applies them to `postgres_changes`.

This made the AI assisted workflow much safer. An agent editing a React component cannot give out points by mistake, because the browser has no write path to the points.

### PIN joins
Groups are joined with a code like `K7QX3M`. The column check is `^[2-9A-HJKMNP-Z]{6}$`: 31 symbols with the look-alikes (0/O, 1/I/L) removed, which is about 887 million codes. On a collision, `create_group` retries the insert on `unique_violation`. Guessing is rate limited to 10 misses per user per 15 minutes. The miss is recorded instead of raised, so the attempt row still commits:

```sql
if (select count(*) from public.pin_attempts
    where user_id = v_uid and not succeeded
      and attempted_at > now() - interval '15 minutes') >= 10 then
  raise exception 'pin_rate_limited';
end if;
```

The generator does `get_byte % 31` on random bytes. 256 is not a multiple of 31, so the first eight characters of the alphabet come up slightly more often. It doesn't matter at this scale, but it's worth knowing before quoting an entropy figure.

## Points are a ledger, never a total 📒
The leaderboard is always `sum(points)` over an append-only `ledger_entries` table. A trigger rejects updates. Undoing a check-in or losing a dispute is just another entry with negative points. That makes every score auditable and every change reversible.

The core is `reconcile_day_points()`. It never adds points directly. It works out what the member *should* have for that day, compares that with what the ledger *does* have, and appends the difference:

```sql
v_want_habit := v_done * public.points_per_habit();
v_want_bonus := case when v_slots > 0 and v_done = v_slots
                     then public.perfect_day_bonus() else 0 end;
if v_want_bonus <> v_have_bonus then
  insert into public.ledger_entries (..., points, reason, ...)
  values (..., v_want_bonus - v_have_bonus,
    case when v_want_bonus > v_have_bonus then 'perfect_day'
         else 'perfect_day_lost' end, ...);
```

A per-member-per-day advisory lock serialises concurrent check-ins, so two taps at once can't both see "4 of 5 done" and both award the bonus.

Streaks are computed rather than stored, with the classic gaps-and-islands trick. Subtracting a row number from each perfect day's date gives every consecutive run the same group key:

```sql
islands as (
  select pf.user_id, pf.day,
         pf.day - (row_number() over (partition by pf.user_id order by pf.day))::int as grp
  from perfect pf
)
```

Ties on points are broken by `verified_share`, the share of your check-ins backed by something stronger than the honor system. `previous_rank` is the same query restricted to ledger rows before today, which drives the "moved up since yesterday" arrow.

Challenge phases (`proposing`, `voting`, `upcoming`, `active`, `finished`) aren't stored either. A `case` over the timestamps derives them from `now()`. Every read RPC calls `sync_challenge()` first. A pg_cron job runs every minute as a backstop, but nothing depends on it, which is why the whole schema still loads on PGlite, where there is no cron.

## Two habit modes in one schema 🗳️
Pact started with one mode. Each member proposes up to five ideas, everyone casts a ballot of up to five picks, and the top five become the group's habits. Vote totals stay hidden until voting closes so nobody bandwagons. Ties go to the earliest proposal (`row_number() over (order by votes desc, seq)`). Voting closes at the deadline, or early once everyone has voted.

Voting is fun, but it assumes the group wants the *same* habits. Plenty of groups want to compete while each person works on their own things. So PR #7 added a personal mode, where each member picks their own five and there is no vote.

The tempting version is a second set of tables. What shipped is one table with a nullable owner:

- A shared habit is a `challenge_habits` row with `user_id` null, a `candidate_id` and a vote count.
- A personal habit is the same row with `user_id` set.
- A check constraint (`challenge_habits_origin`) enforces which fields each kind must have, and partial unique indexes keep the two kinds of slot apart.
- A personal challenge is created already resolved, with no voting deadlines, and another check constraint ties `habit_mode` to that schedule.

Check-ins, timers, spot-checks, disputes and the ledger needed no mode-specific code at all. The one rule that makes it fair lives in `member_habit_count(challenge, user)`. Every scoring query counts *your* habits, never the challenge's. The project's `AGENTS.md` states it plainly for future agent sessions: "never count a challenge's habits without the member." Personal members can't check in until they have filled all five slots (`habits_incomplete`). So in both modes everyone plays for the same maximum points per day.

## The live leaderboard ⚡
`useLive` opens one Realtime channel per challenge and listens to `postgres_changes` on the tables that affect scores, filtered by `challenge_id`. It doesn't use Presence or Broadcast.

The important part is what the client does with an event: nothing clever. It never applies row payloads. Any event triggers a debounced (250 ms) `invalidateQueries` on the `['challenge', id]` key prefix, and TanStack Query refetches `get_leaderboard`. The ledger stays the only source of truth, and a flood of events from five people checking in at once collapses into one refetch.

For the cases where the websocket isn't there:
- It refetches on every `SUBSCRIBED`, to catch up after a reconnect.
- It polls every 20 seconds whenever the channel isn't joined, and shows a "polling" status.
- It refreshes when the tab becomes visible again.

The only optimistic update is the tick on your own check-in. Points and ranks are never guessed on the client.

Days are calendar dates in the challenge's IANA time zone, which is validated against `pg_timezone_names`. A day stays open for late logging until 10:00 the next morning (`late_log_grace()`). A timed habit counts for the day it was *started*. Countdowns in the browser correct for clock skew using the `server_now` returned by `get_challenge`.

## Keeping the honor system honest 🕵️
- **Random spot-checks.** After a done check-in, Pact may ask a question like "Share a detail only someone who did it would know" with a 15 minute window. There is at most one per member per day. The per-check-in chance is solved so a member who completes everything is checked on `spot_checks_per_week / 7` of their days: `1 - (1 - rate)^(1 / slots)`. Answering changes no points. The counts show on the leaderboard, and there is an "Open book" award at the end.
- **Timed habits.** The server records when a timer starts. `complete_timed_session` requires the server's wall-clock time since the start to be at least the target, and the client's reported active time to be at least the target and no more than the elapsed time plus 2 seconds. The client only counts foreground time: `performance.now()` deltas on a 250 ms tick, reset on `visibilitychange`, with a cap per tick so a suspended tab can't bank time.
- **Flags and disputes.** Each member gets 3 anonymous flags per rolling week. Flagging an honor check-in only triggers an extra spot-check. Flagging a timed one opens a dispute: the accused has 12 hours to respond, then everyone else votes anonymously. A quorum of half the group is required, and the check-in is voided only if "fake" votes outnumber "legit". Anonymity comes from RLS: the `flags` and `dispute_votes` tables are only readable by whoever wrote the row.

## Bugs that got through anyway 🐛
The tests were thorough, and bugs still showed up within hours of the first deploy, found by clicking through the live app. Each of these is a lesson about *where* the tests weren't looking.

**A one person group voted itself into tracking (#3).** I created a group alone, proposed five ideas and voted. "Everyone has voted" was true with one member, so the challenge resolved instantly. Fifty seconds later a second account joined a challenge that was already in the tracking phase, with no vote to cast. The fix was `challenge_min_voters() = 2` for opening and closing voting early. The PR also added three SQL tests that fail without the change, and a Playwright spec that replays the exact sequence.

**Production sign-in was unreachable (#5).** Signing in to the live app ended in "Something went wrong". The edge logs showed six 429s from `/auth/v1/otp` and not a single POST to `/auth/v1/verify`. Three problems had stacked up:
- The hosted project issued 8-digit codes, but the input had `maxLength={6}`, which silently cut off the emailed code.
- Supabase Auth reports failures on `error.code`, not in the message, so every auth error fell through to the generic text.
- No test covered email sign-in, because every e2e journey started with "Continue as guest".

The lasting lesson is from the commit message: a hosted project's auth settings are "a second source of truth that nothing in the repo checks". Both sides now match the committed `supabase/config.toml`, and the local Supabase stand-in can simulate a project's OTP length and email budget.

**A challenge couldn't start today (#4).** Both the date picker and the server required voting to close before day 1's midnight, which is already in the past for a same-day start. The rule now is that voting must close before day 1 is *over*, and day 1 is logged retroactively inside the late-log window.

**The perfect day confetti was blank in production (#9).** `canvas-confetti` draws in a `blob:` web worker by default, and the production CSP says `worker-src 'self'`. Locally it was fine; on the live site the canvas stayed empty. It now draws on the main thread, and the e2e spec applies the same CSP directive and asserts that pixels actually appear.

## Testing the real thing 🧪
Two parts of the test setup did most of the work:

1. **Real migrations on PGlite.** The `db` Vitest project runs every migration on an in-process Postgres, so about 60 database tests exercise the actual SQL (triggers, RLS, advisory locks) with no Docker.
2. **A local Supabase stand-in.** `local/server.mjs` (about 1.1k lines) serves Auth, `/rest/v1/rpc` and Realtime `postgres_changes` on top of PGlite. Playwright runs against it on every PR, and a second CI job runs the same suite against a real `supabase start` stack, which is how RLS and Realtime behaviour gets checked for real.

`tests/e2e/live-leaderboard.spec.ts` shows the idea. Two browsers check in, the spec watches websocket `framereceived` events, and it asserts that the viewer's leaderboard changed *without* a reload or navigation, in both habit modes.

In total that's about 19k lines: 10k of TypeScript and CSS, 3.9k of SQL across eight migrations, 3.6k of tests, and around 130 unit, database and end to end tests.

## Takeaways 💡
- **Put the rules where the agent can't route around them.** With every write going through a granted RPC, and points kept as an append-only ledger, a UI change has no way to corrupt the scores.
- **Derive what you can instead of storing it**: totals, streaks, phases and ranks. There's less state to go out of sync, and less for an agent to forget to update.
- **Your tests only cover what they can see.** Hosted auth settings, a production CSP and a group of one were all outside the test environment until a bug put them in it. Each of those fixes brought that part of production into the tests.
- **AI agents move fast, and the review and test gates are what make the speed safe.** A day of directed agent work produced a working, deployed app, but only because each PR had to prove itself first.

Try it: [pact-deploy.vercel.app](https://pact-deploy.vercel.app)
