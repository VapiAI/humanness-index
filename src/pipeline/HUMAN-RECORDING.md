# Human baseline: voice recording brief

The **Human** baseline is part of the Humanness Index: the four original
source-voice actors (Clara, Emma, Godfrey, Nelliot) read the same 20
customer-support lines the TTS models read. In the arena these recordings go
head to head against the cloned TTS versions of the **same voice** ("which one
sounds more human?"), and Human anchors the scale at **100**, the reference
the field is measured against rather than a perfect-score ceiling. It battles
only on the voices recorded so far (Clara and Nelliot today); this brief is
how we collect each remaining voice's readings (see `RUNBOOK.md` for how they
are cleaned and ingested).

## How to record

- Each actor reads **all 20 lines** below, **exactly as written** — keep the
  "um"s, the "...", and the little false starts / self-corrections. Read it
  naturally, like a real support call, not "performed."
- **One line per file.** A little silence at the head/tail is fine (we trim).
- Quiet room, consistent mic + distance + level, no background noise/music.
- Format: **WAV (or any lossless), mono, 44.1 kHz or higher** preferred. A clean
  phone recording (m4a) is OK in a pinch — we loudness-normalize and convert to
  MP3 on ingest.

## Where to put the files

One folder per actor (already created), filename = the line id:

```
src/pipeline/results/source-voices/human-readings/
  clara/    clip-01.wav … clip-20.wav
  emma/     clip-01.wav … clip-20.wav
  godfrey/  clip-01.wav … clip-20.wav
  nelliot/  clip-01.wav … clip-20.wav
```

**80 files total** (4 actors × 20 lines). The number in the filename MUST match
the line id below (`clip-07.wav` = line clip-07). `.wav`, `.flac`, `.mp3`, and
`.m4a` are all accepted.

## The 20 lines (read verbatim)

**clip-01** — Okay so I'm pulling up your account right now and it looks like... oh wait, that's not the right one. Let me search by your email instead. Yeah okay, here we go, I can see the charge you're talking about.

**clip-02** — So the issue with your order is that it was... it got flagged by our system for some reason, which is why it hasn't shipped yet. I'm going to go ahead and, um, manually push that through for you. You should get a confirmation email within the hour.

**clip-03** — Right, so what you'll want to do is go into your account settings and then click on... sorry, not account settings. Go to the billing tab first. From there you should see an option to update your payment method.

**clip-04** — I totally understand, and that's... yeah, that's really frustrating, I'm sorry about that. What I can do is issue a refund for the full amount, and that should hit your account in, um, three to five business days. Does that work for you?

**clip-05** — So I'm looking at the notes on your account and it says that. Hang on, let me read this. Okay so it looks like a technician already came out on Thursday but wasn't able to get in. Were you home that day or did they maybe have the wrong, um, the wrong unit number?

**clip-06** — The good news is your warranty does cover this, so we can get a replacement sent out no problem. I just need to... actually, do you have the serial number handy? It should be on the bottom of the device or on the box if you still have it.

**clip-07** — Hmm, that's interesting. I'm noticing there was a slight delay around the time you submitted it. Oh wait, sorry, I was looking at the wrong timestamp there. Let me switch over to the correct one. Yeah, okay, now I'm seeing it properly. So it looks like the system flagged it automatically, which is probably why you got that notification.

**clip-08** — Alright, let me try searching by your email instead, that might be quicker. Okay, here we go, that pulled it up right away. Yeah, I can see the charge you're talking about. It was authorized but not fully captured, so that's why it might look a little odd on your statement. That actually makes sense given the timing.

**clip-09** — So I can see here that the package was marked as delivered on Tuesday, but if you're saying it never arrived then what we'll do is... let me just. Yeah, I'm going to open a lost package investigation for you. That usually takes about forty-eight hours to resolve.

**clip-10** — Bear with me one second, I'm just waiting for this screen to load. There we go. Okay so it looks like your subscription renewed on the twelfth, which is why you're seeing that charge. Do you want me to cancel it going forward or were you wanting a refund on this one specifically?

**clip-11** — Yeah so the reason you're seeing two charges is because the first one was a pre-authorization and the second one is the actual charge. The pre-auth should drop off in, um, two to three business days. If it doesn't, give us a call back and we'll sort it out.

**clip-12** — I'm going to put you on a brief hold while I check with my supervisor on that. Actually, you know what, let me just look it up myself real quick. Okay yeah, so we can absolutely do that for you, no problem at all.

**clip-13** — So the way the return process works is you'll get an email with a prepaid shipping label, and then you just... you can drop it off at any post office or schedule a pickup. Once we receive it back, the refund goes through automatically. Usually takes about a week from that point.

**clip-14** — Let me pull up the tracking on that. Okay so it left our warehouse on... Monday. And it looks like it's currently sitting at a sorting facility in Memphis. So it hasn't moved since Wednesday, which is, um, not ideal. Let me flag that with our shipping team.

**clip-15** — Right, so I see what happened here. Your old plan was grandfathered in at the lower rate, and when the system updated it... it switched you to the current pricing. That shouldn't have happened. Let me get you back on the original rate.

**clip-16** — I appreciate your patience with this, I know it's been a long call. So just to recap what we've done today. We've issued the refund, we've updated your shipping address, and I've added a note to your account so if this happens again they'll know the context. Sound good?

**clip-17** — Okay I'm looking at your device history and it shows... huh, that's weird. It shows three replacements in the last year. Have you been having ongoing issues with this model or is this a new thing?

**clip-18** — So what I'd recommend is. Let me think about the best way to explain this. Basically your current plan doesn't include international coverage, but we have an add-on that's ten dollars a month that would cover you while you're traveling. Do you want me to add that on temporarily?

**clip-19** — I can see the appointment was scheduled for between two and four, and it looks like the technician arrived at... three forty-seven. So they were within the window, but I understand that's still cutting it close. If you need to reschedule we can definitely find a better time.

**clip-20** — Yeah no, you're absolutely right, that's our mistake. I don't know why it was set up that way. Let me fix that for you right now. Okay, done. You should see that reflected on your next statement. And again, I'm really sorry about the confusion.
