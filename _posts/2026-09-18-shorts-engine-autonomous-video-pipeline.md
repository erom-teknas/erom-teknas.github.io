---
title: "shorts-engine: an autonomous pipeline that turns long videos into shorts"
date: 2026-09-18 09:00:00 -0400
categories: [🧠 AI Engineering, 🎬 Video Pipelines]
tags: [ai, vibe coding, python, ffmpeg, whisper, gemini, youtube, launchd]
description: The stages, the LLM judges and the production bugs of a self-hosted pipeline that clips podcasts and streams into captioned 9:16 shorts and publishes them on a schedule.
---

## Overview 📝
shorts-engine takes long-form video (podcasts, interviews, streams) and turns it into vertical 9:16 shorts with word-timed captions. It finds the moments worth clipping, frames the active speaker, cuts between wide and close shots, burns in captions, and publishes on a daily schedule without me touching it. It runs on a single 16 GB Mac mini.

It is also the biggest thing I've built by directing AI agents instead of typing the code. The repo has 157 commits over 11 days, with about 50k lines of Python in the package and 38k lines of tests (1,791 test functions). 134 of those commits carry a `Co-authored-by: Claude` trailer: mostly Sonnet 5, with Opus 5 and Fable 5.1 on the rest. My job was the one agents are worst at: watching the output and saying "no, that clip is boring", "that flash has no sound", "why is there 30 seconds of silence at the end?".

> The repo's `AGENTS.md` is the project's memory. It's written as dated incident notes (symptom, root cause, fix, tests) so the next agent session doesn't repeat the last one's mistake. It is now 5,000+ lines, which says something about both the approach and its cost.
{: .prompt-info }

## The pipeline 🏭
Here is the whole flow, from a source video to an upload. Select a stage to see what it does, or press Play to follow one clip through it. The dashed lines are the two loops: a clip that scores too low goes back to be re-rendered, and the shelf pulls in new sources as it empties.

{% include flow.html id="shorts-engine" %}

Curation runs *before* vision on purpose. Early on, vision ran first and scanned the whole 40 minute source for faces. Moving it after curation, so it only looks at the chosen windows, took the vision stage from 746 s to 23 s and a full run from about 30 minutes to 18.

### 1. Ingest 📥
- Downloads with `yt-dlp`.
- Extracts 16 kHz mono audio and normalises it to -16 LUFS (EBU R128).
- Detects scene cuts, which the framing stage uses later.

### 2. Transcription 🎙️
- Uses `faster-whisper` with `large-v3-turbo` and word timestamps on.
- Snaps each word's timing to a 20 ms energy envelope, so a caption appears when the word is actually heard. Overlapping words are split at the quietest frame.
- Diarization uses pyannote when it's installed and a heuristic acoustic diarizer otherwise.
- Results are cached by the audio's hash, so a re-run doesn't redo a 3 hour transcription.

### 3. Curation: an LLM that reads the whole transcript 🧠
The default curator is one Gemini call that sees the *whole* transcript as numbered sentences. Each sentence is tagged with acoustic cues computed locally: an energy percentile plus `LOUD`, `SPIKE`, `REACT` and `FAST` flags. On a stream, a shout or a burst of laughter is often the best clue that something clip-worthy just happened, and text alone doesn't show that.

The model returns up to five ranked moments. Each has a title, a hook line, hashtags, 0 to 100 scores for hook, payoff and loop strength, and the sentence ranges to keep. The prompt tells the model outright that duration limits are enforced in code after it responds, and they are. A clip may not open on a greeting, filler or a sentence fragment. The default profile targets 15 s clips, within 10 to 25 s.

If the model is unavailable, the fallbacks are loud:
1. A sliding-window segmenter builds candidates (about 8,500 on a 3.5 hour source) and scores them with rules.
2. Batches of up to 150 candidates go to Gemini.
3. If that fails, a local Ollama `qwen3:8b` curates.
4. If that fails too, the rule-based score is used on its own.

There is a hard floor, `min_acceptable_curator_backend="local_llm"`, so a clip picked by rules alone is never published. Cloud calls are capped at 30 a day and tracked in a spend ledger. A local YAMNet classifier flags clips with too much copyrighted music.

### 4. Vision and framing 🎯
All of this runs locally:
- **Faces:** YuNet (a 232 KB OpenCV ONNX model), falling back to MediaPipe BlazeFace, then Haar cascades.
- **Active speaker:** mouth movement from face-mesh landmarks, correlated with word timing and audio RMS, then bound to the diarized speakers.
- **Layout:** the director chooses per shot between `single_speaker`, `dual_split` and `wide_letterbox`. The crop path is smoothed with Kalman and Bezier filters so it never jitters.
- **Pacing:** it alternates wide shots and punch-ins, each 1.8 to 6 s long, on speaker changes and emphasis. Punch-ins require enough confidence. When it isn't sure who is talking, it stays wide rather than zooming in on the wrong person.

### 5. Render 🎬
Rendering is plain FFmpeg filtergraphs, not a browser renderer:
- Captions are ASS subtitles burned in with the `ass=` filter, in five bundled OFL fonts.
- Dead air is removed with jump cuts: any gap between words over 350 ms shrinks to 120 ms, using `select`/`aselect` plus `setpts`.
- It adds a 1 to 5 s "flash-forward" cold open that teases the payoff, a CC0 music bed, meme sound effects and profanity bleeps.
- Encoding uses `h264_videotoolbox` on the Mac, falling back to NVENC, then libx264.

### 6. The watchability judge 👀
Curation guesses from text. The watchability judge checks the *finished* clip. A 360p, 24 fps proxy goes to Gemini, which answers four questions that can be checked:
- Does it open without needing context?
- Is there a reason to keep watching?
- Does the payoff land?
- At what second would a viewer drop off?

Then it gives one `watchability_score`. The prompt asks for it "calibrated like a real retention percentage", not a virality guess.

At first the judge only logged a prediction (accept at 55 or above). Now it closes the loop. Below a target of 70, the pipeline repairs the clip by extending the start or end, or swaps in a reserve candidate, and asks again. It is capped at 2 attempts per clip and 10 judge calls per source, and costs about $0.002 to $0.003 per clip.

### 7. Autopilot and publishing 📅
There is no custom daemon. `autopilot` is a set of CLI verbs (`discover`, `fill-shelf`, `publish-slot`, `status`, `cleanup`) run by macOS launchd:
- **Discovery** runs nightly and checks tracked channels for new uploads. It uses the 1-unit `playlistItems` and `videos.list` calls, not the 100-unit `search.list`, to stay inside the YouTube API quota.
- **Fill-shelf** runs every 4 hours and keeps a shelf of about 10 rendered, judged clips ready.
- **Publish-slot** fires five times a day and uploads the next clip with a resumable upload. It reads the privacy status back from the API instead of assuming it. English sources publish publicly; everything else stays private.

## War stories 🔥
The best way to understand a system is through what broke in production. These are the ones I found most interesting.

### Two schedulers, one clip, two uploads
On 17 September the same clip went up twice at 18:00, and again at 20:00.

That afternoon both launchd flavours had been installed: a LaunchAgent (a per-user job) at 16:30 and a LaunchDaemon (system-wide) two minutes later. So every publish slot started **two** `publish-slot` processes in the same second. There was a lock, but it was the classic check-then-act kind:

```python
if lock_path.exists():
    existing_pid = int(lock_path.read_text(...).strip())
    if existing_pid > 0 and _pid_is_alive(existing_pid):
        raise LockHeld(...)
lock_path.write_text(str(os.getpid()), encoding="utf-8")
```

Two processes starting together both see no live pid, both write their own, and both upload. The fix is to let the kernel decide:

```python
fd = os.open(str(lock_path), os.O_RDWR | os.O_CREAT, 0o644)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except OSError as exc:
    os.close(fd)
    ...
    raise LockHeld(f"{name} is already running (pid {holder}, lock {lock_path})") from exc
```

`flock` is atomic, and the kernel releases it when the holder exits or is killed, so a crash leaves no stale lock to clean up. The subtle part is that the lock file is **never unlinked**. Deleting it on release brings the race back in a new form: one process opens the old inode just before the unlink and locks it, a third process creates a new file at the same path and locks that, and both run.

The rest of the fix was operational. The daemon installer now removes the LaunchAgents, the agent installer refuses to run while the daemons exist, and `autopilot status` flags more than one installed publish job. The regression tests race real OS processes: 6 contenders for the lock (the old lock failed 5 out of 5 rounds) and 4 `publish-slot` processes on one shelf (the old code uploaded the clip up to 4 times; now it's exactly once).

This was actually the *second* duplicate-upload bug. The first was a lookup by `clip_id` alone. `clip_001` is only unique within one source video, so publishing marked the wrong source's row as published, the real row stayed due, and the next tick uploaded the file again. The fix matches on `(pool_video_id, clip_id)` and raises on any ambiguous match. Before any retry, a separate crash-safety layer also checks the channel's real uploads for a matching title.

### The phantom track: 30 seconds of silence from a music file
Some renders played 22 to 25 seconds of real content, then dead air until 48 to 60 seconds. Other clips from the same run were fine.

`ffprobe` showed nothing wrong at first: the video stream, audio stream and `format.duration` were all correct. But the file had a **third stream**: `codec_tag=text`, SubtitleHandler, one frame, about 50 seconds long. macOS QuickTime and Finder take the longest track as the file's length.

That third stream turned out to be **chapters**. FFmpeg's `-map_chapters` defaults to copying chapters from the first input that has any, and explicit `-map` flags don't affect it because chapters aren't a stream. The mov muxer then writes them out as a text track. Two of the 46 bundled CC0 music beds had a leftover `Tempo: 120.0` chapter spanning 0 to 75.007 s, from whatever tool had cut them. The music rotation starts each bed at a random offset, so only clips that drew one of those two tracks got a phantom track, with a length of 75.007 s minus the offset.

The fix is three flags on every output:

```python
CONTAINER_HYGIENE_FLAGS = [
    "-map_chapters", "-1",
    "-dn",
    "-sn",
]
```

`-map_chapters -1` is the real fix; `-dn` and `-sn` (drop data and subtitle streams) are defence in depth. There's also a read-back gate: every render must contain exactly one video and one audio stream, with durations within 0.5 s of each other. The lesson I keep coming back to is that a container-vs-video duration check would *not* have caught this, because those two agreed. Only a per-stream check could.

### Kernel panics on a 16 GB Mac
The Mac mini had three watchdog kernel panics in about 18 hours. The Whisper model stayed loaded through later stages and could overlap with Ollama, which was measured at 6.6 GB resident while idle, leaving about 0.5 GB free. FFmpeg had no thread cap either.

The fix:
- Release the ASR engine as soon as transcription finishes.
- Unload Ollama with `keep_alive=0`.
- Cap FFmpeg at 4 threads.
- Add `ensure_stage_headroom`, which refuses to start a stage without enough free memory.

For a pipeline that runs unattended, failing to start is much better than taking the whole machine down.

### launchd has no login shell
The overnight run had no Gemini key, because launchd doesn't source your shell profile. The fallback chain quietly shelved clips picked by the rule-based scorer. The log even printed a key source, because it rendered the environment variable's *name* unconditionally.

The fix:
- A small env shim resolves the key at run time. It is never written into the world-readable plist.
- The `min_acceptable_curator_backend` floor, so a degraded curator can never feed the publish queue again.

The same PR fixed a shelf write race, where every writer staged through the same `.tmp` file. Each read-modify-write now happens under a blocking `flock`.

### LLM reasoning leaked into public descriptions
The whole-transcript curator set `headline = reasoning[:200]`. So two public videos went out with descriptions that referred to "Sentence 141", with an unmasked swear word included. It was an easy fix and a good reminder: anything a model writes for *you* has to be kept apart from anything it writes for the audience.

### Flashes with no sound
I rejected a batch where one clip had 7 visual flashes and 1 sound effect, because flashes and sounds were scheduled independently. The fix turned the relationship around: a flash can only exist at the onset of a validated sound, and `enforce_flash_sound_invariant` strips any orphan. Encode an aesthetic rule as an invariant, not a tuning knob.

## What directing agents at this scale taught me 💡
- **Taste doesn't delegate.** Agents wrote well-tested code for every rule I stated. Almost every bug that reached production was a rule nobody had stated yet: no silent tail, no flash without a sound, no clip picked by rules alone.
- **Make the agents write down every incident.** The dated sections in `AGENTS.md` are why later sessions knew not to re-cut the music files (their SHA-256 hashes are pinned for licence credits) or unlink a lock file.
- **Prefer invariants checked on the output.** Stream counts, flash/sound pairing and the curator floor are all checked on what actually gets produced, not on what the code meant to do.
- **Races are the same in hobby projects.** Two schedulers and a check-then-act lock is a distributed systems bug on a single Mac mini. `flock`, idempotent reconciliation and tests that race real processes fixed it, as they would anywhere.
