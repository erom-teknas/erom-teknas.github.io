---
title: "explainer-engine: a fact-checked, closed-cases-only true-crime video pipeline"
date: 2026-09-18 11:00:00 -0400
categories: [🧠 AI Engineering, 🎬 Video Pipelines]
tags: [ai, vibe coding, typescript, remotion, elevenlabs, gemini, wikipedia, wikidata, youtube]
description: How an automated pipeline researches, scripts, narrates and renders short true-crime explainers, and the gates that keep an LLM from inventing facts or covering an open case.
---

## Overview 📝
explainer-engine is an automated pipeline that turns one subject into a 40 to 60 second vertical explainer video. It picks a subject, pins a Wikipedia article, writes a script from it, fact-checks every sentence against the article, narrates with ElevenLabs, renders with Remotion, and uploads to YouTube.

The genre it runs now is true crime, and that raises the stakes. A made-up date in a science explainer is embarrassing. A made-up detail about a real person and a crime is an accusation. So most of the engineering isn't the rendering at all. It's the set of gates that decide what the language model is *allowed* to say, and the rule that the pipeline only covers cases a court has closed.

Like the other projects in this category, I built it by directing AI coding agents rather than writing the code myself. It has 35 commits over three days, and 33 carry a `Co-Authored-By: Claude` trailer. It's about 34k lines of TypeScript, Python and Swift, with about 240 tests. My part was deciding the rules, and watching and *listening* to the output until it was good enough.

## The pipeline 🏭
Most of the steps below are gates: points where the pipeline can say no. Select one to see what it checks and what happens when a subject or a draft fails, or press Play to walk a subject all the way to an upload.

{% include flow.html id="explainer-engine" %}

### Picking a subject 🔎
The autopilot crawls English Wikipedia crime categories two levels deep through the MediaWiki API (`generator=categorymembers`), with hard caps on how many listings and pages it reads. It drops articles under 40,000 bytes, because a thin article can't back a script, and deduplicates subjects by their Wikidata ID.

Wikidata then narrows the list to a *pool*:
- A person must be a human (`P31 = Q5`) with **`P1399` "convicted of"** set, who died at least two years ago.
- A case must have a date (`P585`) and a named perpetrator (`P8032`) who has `P1399` on their own item.
- Some offence types are excluded outright: political violence, mass-casualty events, sexual crimes and crimes against children.

In the first measured build, 6,260 articles went in and 83 subjects came out.

> The pool is only a convenience filter; it is not the safety guarantee. Wikidata can be wrong or out of date. The guarantee is the verdict gate, which reads the actual article.
{: .prompt-warning }

### Pinning the source 📌
`source.ts` fetches the article through the MediaWiki Action API with `prop=extracts|info|pageprops|revisions` and stores the **revision id** plus an `oldid=` permalink in `source.json`. Everything after this step works against that exact revision. If the article is edited tomorrow, you can still say exactly what the video was checked against.

Some other rules at this stage:
- **Disambiguation pages and weak title matches are refused**, not guessed at.
- **Thin articles are refused:** at least 700 words and 6 paragraphs.
- **Block quotations are marked as unusable evidence.** The pipeline reads the same revision's wikitext to find them. A quote the article attributes to someone else isn't the article saying it's true.
- **Paragraphs are numbered** (`[P1]`, `[P2]`, and so on) so every later claim can point to where it came from.

## Gate 1: the confirmed-conviction verdict ⚖️
Before a single word of script is written, `verdict.ts` reads the pinned article and decides whether the case is closed. It works in two layers and fails closed.

**Layer one is plain code, with no model involved.** Regex families look for:
- *Conviction language*, including older wordings like "was sent to jail". The Mona Lisa thief's article never actually uses the word "convicted".
- *Unresolved language*: unsolved, cold case, awaiting trial, appeal pending.
- *Contested language*: overturned, pardoned, exonerated, acquitted, retrial, recanted.

No conviction phrase, or any unresolved phrase, is an instant refusal:

```ts
if (!check.conviction.length) {
  check.reasons.push('the article never states that anyone was convicted, pleaded guilty or was sentenced; ...');
  return check;
}
if (check.unresolved.length) {
  check.reasons.push(...check.unresolved.map((u) => `${u.token} ("${u.sentence}")`));
  return check;
}
```

Contested phrases become questions the model has to answer.

**Layer two is one LLM call at temperature 0 with a strict JSON schema.** The model returns the outcome, the defendants with verbatim evidence, whether the conviction still stands, and an answer to every flagged phrase. Then code audits the model:
- Every quote must be verbatim.
- It must be in the paragraph it cites.
- It must not come from a block quotation.
- The conviction quote must itself match the conviction patterns.

Any doubt the model reports is a refusal:

```ts
if (!['convicted', 'guilty plea'].includes(reading.outcome)) reasons.push(...);
if (!reading.convictionStands) reasons.push(...);
if (reading.appealPending) reasons.push(...);
if (reading.guiltDisputed) reasons.push(...);
if (reading.unsolved) reasons.push(...);
```

A refusal is permanent and is written to `verdict.md` with its reasons. Three real examples:
- **Zodiac Killer:** refused in layer one, with no model call.
- **Lindbergh kidnapping:** refused in layer two, because the guilt is disputed.
- **1911 theft of the Mona Lisa:** confirmed, on the wording of one specific paragraph.

## Gate 2: every sentence is checked against the article 🧾
The writer (Gemini by default, with schema-constrained JSON output) gets the numbered article and is told it is its *only* source. Along with the narration, it has to return a `facts[]` list. Each fact has a claim, the beat it belongs to, the paragraph id, and a **verbatim quote** as evidence.

A separate checker call then splits the narration into atomic claims. Every date, number, name, place, relationship and causal link is its own claim, and each gets `supported`, `unsupported` or `contradicted`, with a paragraph id and a quote.

Nobody trusts the checker either. **Code checks the checker:**
- Every quote must actually be in the article. The comparison ignores case, accents and dash variants, and quotes from block quotations don't count.
- Every number in a sentence must appear in that sentence's evidence.
- Qualifiers must survive: "more than 20,000" is not "about 20,000".
- Hedges must survive: if the article says "believed to" or "often called", so must the script.
- Every name must appear in the paragraph the claim cites.
- Every sentence must be covered by at least one claim.

Even before the model call, a cheap pass flags any number, capitalised name or quoted phrase in the narration that the article doesn't literally contain.

When something fails, the findings go back to the writer, who rewrites. Sentences that already passed are "settled" and not re-checked. This runs for up to three rounds. A draft that still fails is rejected, and the whole audit is saved to `factcheck.md`. The accepted narration is audited one more time, and visual notes that name things the narration doesn't are dropped, so the pictures can't sneak in an unchecked claim either.

One near miss shows how small the gaps can be. The shot planner's end card, which the narration checks never saw, said "The most famous painting in the world". The article says "one of the best known". End cards now go through their own hedge check (`endCardHedges`), and that wording fails.

## Gate 3: the hook, on the page and in the ear 🎣
Short-form video lives or dies in the first two seconds, so the opening has its own gate, again in two parts.

**Text rules, in code, before any voice credits are spent:**
- No opening on a date or place phrase, a subordinate clause, or "It was...".
- No questions, and no "Have you ever", "Imagine" or "Did you know".
- No stative verbs like "was born" or "became interested".
- At most 22 words per sentence.
- At most 12 words of setup before the sentence that delivers the surprise.

An LLM judge compares the writer's opening with 2 or 3 alternatives the writer also had to provide. A "strong" verdict is overridden in code unless the opening is concrete, has tension, is surprising and clear, and leaves the viewer with a question.

**Timing rules, measured on the recorded narration:**

```ts
export const HOOK_AUDIBLE_SECONDS = 1.0;  // first word heard by 1.0s
export const HOOK_POINT_SECONDS = 2.0;    // ...and 4 words said by 2.0s
export const HOOK_POINT_WORDS = 4;
export const HOOK_SETUP_WORDS = 12;
export const HOOK_TURN_SECONDS = 5.0;     // the twist lands by 5.0s
```

For a crime video, a failed timing check throws at compile time. It does not render with a warning.

### How that gate got its timing rules
The first crime video opened: *"A detective finished writing his report leaning on a table in Vincenzo Peruggia's Paris apartment. The stolen Mona Lisa was hidden under that table."* It passed every text rule, and I still couldn't follow it on listening. Measuring the take showed three separate problems:

1. **The narration faded out on the twist.** ElevenLabs ends a statement on a falling pitch. "Mona" came out at -14.0 dBFS and "table." at -27.8 dBFS, 14 dB apart within one sentence.
2. **The music was as loud as the reveal.** The bed played at a fixed gain with no ducking. In the speech band, the reveal word ended 0.2 dB *above* the music.
3. **The twist arrived at 5.88 s**, behind fifteen words of setup and a name the aligner itself heard as "Peruzio's".

The fix went into the pipeline, not just that one script:
- Narration is levelled along its envelope, which brought the hook sentence's spread from 14 dB down to 5.
- Every music bed is scaled from its own measured loudness and ducked under each spoken word.
- The setup and turn limits above were added, plus a rule that fails any capitalised name the aligner mishears.

The rewritten opening leads with the Mona Lisa, and its turn now lands at 3.93 s.

## Voice and render 🎙️
- **Narration:** ElevenLabs `eleven_v3_conversational`, one take per scene, levelled to a fixed speech loudness. The standard v3 model was tried and rejected after listening. It reads at 0.48 to 0.50 s per word against 0.37 to 0.41, which broke every runtime and hook constant.
- **Word timing:** it doesn't come from ElevenLabs. A local `faster-whisper` model is used as a forced aligner, and what it hears is matched back to the script with `difflib`. Words it can't recover are recorded as `misheard`, and the hook gate uses that.
- **Render:** a video is a JSON `VideoScript` (scenes, then shots, one template per shot, from a library of 55) rendered by a single 1080x1920 Remotion composition. Timing is in word indices, not frames, so a re-voiced line re-times itself. The output is H.264 at CRF 20, loudness-normalised to -16 LUFS.
- **Faces:** Apple Vision face detection (a small Swift helper) checks every crop of a still image. The render refuses any crop that cuts off a head, after a painting in an early video showed a torso with no head. Checked against real face boxes, 11 of 14 portrait crops had failed.
- **Publishing:** a YouTube Data API resumable upload, then `thumbnails/set`. Afterwards it reads the privacy status back and fails on a mismatch. An unattended publish requires an accepted fact-check, ElevenLabs narration, a runtime of 40 to 60 s (±1 s) and a cover.

## What broke on the way 🐛
- **The gates contradicted each other.** The first live autopilot subject used up the whole day's LLM budget and was then rejected. The script shape rule required a title to be written out as "Pepper No. 30", and then the name check and the fact-checker both refused "Pepper Number 30". The runtime cap of 30 to 40 s also forced drafts down to 53 words. Widening the runtime to 40 to 60 s and reconciling the rules fixed it. With several independent validators, you need a test that they can all pass *together*.
- **Captions under the Subscribe button.** The first upload's captions sat under the Shorts UI. The safe zone was measured again: 240 px at the top, 440 px at the bottom, and a 220 px rail on the right.
- **The wrong cover.** Remotion shallow-merges `--props` over `defaultProps`, so the first unattended video inherited an older video's cover. Input props are now validated in `calculateMetadata`.
- **A budget that's enforced in code.** LLM calls are capped per day for this project and across it and a sibling pipeline (shorts-engine). A subject has a fixed per-story call budget. Autopilot defers work instead of overspending.

## Takeaways 💡
- **Ground the model, then check the grounding in code.** Every step that uses an LLM (verdict, write, check, hook) is followed by a code audit of what the model claims to have found. A quote that isn't verbatim is a failure, however confident the model sounds.
- **Fail closed where being wrong hurts people.** An article that doesn't clearly say a court closed the case is refused. Losing a good story costs nothing compared with covering an innocent person.
- **Pin your sources.** A revision id turns "the article said so" into something you can check later.
- **Measure what the viewer experiences.** The hook passed on paper and failed in the ear. The fixes came from measuring the audio, not from rereading the script.
- **AI agents made this possible in three days, and the rules made it safe.** The agents built what I specified quickly and with thorough tests. The judgement about what must never be published was the part I couldn't hand off.
