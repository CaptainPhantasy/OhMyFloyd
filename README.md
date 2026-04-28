<p align="center">
  <img src="https://github.com/CaptainPhantasy/OhMyFloyd/blob/main/assets/ohmyfloyd.png?raw=true" alt="OhMyFloyd">
</p>

<p align="center">
  <strong>The coding agent that shouldn't exist — but does, out of spite.</strong>
</p>

<p align="center">
  Maintained by <a href="https://www.FloydLabs.com">Floyd Labs</a> in a garage in Brown County, Indiana.
  Forked from <a href="https://github.com/can1357/oh-my-pi">oh-my-pi</a>.
  Supervised by two black cats who have never once paid rent.
</p>

<p align="center">
  <a href="https://github.com/CaptainPhantasy/OhMyFloyd/actions"><img src="https://img.shields.io/github/actions/workflow/status/CaptainPhantasy/OhMyFloyd/ci.yml?style=flat&colorA=222222&colorB=3FB950" alt="CI"></a>
  <a href="https://github.com/CaptainPhantasy/OhMyFloyd/blob/main/LICENSE"><img src="https://img.shields.io/github/license/CaptainPhantasy/OhMyFloyd?style=flat&colorA=222222&colorB=58A6FF" alt="License"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&colorA=222222&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://www.rust-lang.org"><img src="https://img.shields.io/badge/Rust-DEA584?style=flat&colorA=222222&logo=rust&logoColor=white" alt="Rust"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat&colorA=222222" alt="Bun"></a>
  <a href="https://discord.gg/4NMW9cdXZa"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&colorA=222222&logo=discord&logoColor=white" alt="Discord"></a>
</p>

---

## So What Is This?

Hi. I'm Douglas. I'm a guy born in 1977 who was building homemade robots while other kids had Transformers, and apparently I never grew out of it.

OhMyFloyd is what happened when I looked at $300+/month in AI subscriptions and had the same thought I've had since I was seven years old, standing in a garage with a screwdriver: *"I could make that."*

It's a fork of [oh-my-pi](https://github.com/can1357/oh-my-pi) — a genuinely excellent AI coding agent built by [Can Bölük](https://github.com/can1357) and [Mario Zechner](https://github.com/mariozechner), who actually know what they're doing. I track their upstream and carry my own patches on top. They built the engine. I put better tires on it and added a bumper sticker that says "Because spite."

[Built by Floyd Labs.](https://www.FloydLabs.com) Come see what else we're doing. We have a website now. It's a whole thing.

---

## Does It Work?

Unfortunately, yes. I was kind of hoping it wouldn't so I could go back to complaining about AI companies, but here we are.

```bash
bun install -g @oh-my-pi/pi-coding-agent
export ANTHROPIC_API_KEY="your-key-here"
omp
```

That's it. Two lines. One of them is just setting an environment variable, which is the kind of thing that reminds you we still live in the 1970s despite carrying supercomputers in our pockets.

**What you get:**

- A terminal-based AI coding agent that doesn't need Electron or a browser or a subscription or a LinkedIn account
- It writes your commit messages, which is great because mine were getting embarrassing
- It talks to your language server so it can actually see your type errors instead of guessing like a fortune teller
- It runs Python with streaming output and rich rendering, which is more than I can say for most "enterprise" tools
- It can spawn parallel subagents that coordinate better than most teams I've worked on
- A Rust native engine for the heavy lifting — grep, shell, syntax highlighting, text processing — because shelling out to external commands is how we got into this mess
- 65+ themes with auto dark/light switching because looking at code shouldn't hurt and I'm too old for eye strain
- Browser automation with stealth scripts because bot detection is a suggestion, not a law

For the actual manual — every CLI flag, config option, extension API, tool reference — the upstream has [a perfectly good README](https://github.com/can1357/oh-my-pi#readme). They wrote 1,400 lines of documentation. I wrote this instead. Priorities.

---

## What Makes This Fork Different?

Good question. I carry a focused set of patches on top of upstream. No 700-file squash commits. No mystery meat. Just things the garage needed that upstream didn't have yet:

- **Execution hardening** — Because "just run it" is how you end up on a security mailing list at 4 AM
- **Continuous learning** — The agent remembers what worked across sessions. Unlike most AI, which has the memory of a goldfish with a subscription model
- **Behavioral enforcement** — Keeps the AI from going off the rails. Bella does the same thing by sitting on my keyboard
- **Sandbox isolation** — Run suspicious code in a Debian VM instead of on my actual machine like an animal
- **GLM-5.1 support** — I'll talk to any model that doesn't charge me rent
- **Hook system consolidation** — Unified the hook runtime into the extension system and deleted three times as much code as I added. It's what passes for progress around here

The full fork registry is in [`OHMYFLOYD.md`](OHMYFLOYD.md) if you're into that kind of thing.

---

## The Cats

Because you were going to ask.

```
┌──────────────────────────────────────────────────────────┐
│  PROJECT SUPERVISORS                                      │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  Bella (Senior Project Manager)                           │
│  ├─ Role: Keyboard disruption, judgmental staring         │
│  ├─ Special skill: Knows when you're about to ship        │
│  └─ Management style: Sleeps on important documents       │
│                                                           │
│  Bowser (Technical Director)                              │
│  ├─ Role: Infrastructure guardian, midnight monitoring    │
│  ├─ Special skill: Predicts build failures before CI      │
│  └─ Debugging method: Sits on routers until bugs leave    │
│                                                           │
│  Neither has ever paid rent. Both have more authority     │
│  than the founder. This is not a joke.                    │
│                                                           │
│  Approval status: ✅ Both cats reviewed this README       │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

---

## Credits

I want to be very clear about something: the smart people here are [Mario Zechner](https://github.com/mariozechner), who built [pi-mono](https://github.com/badlogic/pi-mono) from scratch, and [Can Bölük](https://github.com/can1357), who turned it into [oh-my-pi](https://github.com/can1357/oh-my-pi) with 1,400 lines of documentation and actual engineering discipline.

I'm the guy who forked it, added a few patches, and wrote a README with cat jokes. But hey — [Floyd Labs](https://www.FloydLabs.com) is mine, and the spite is genuine.

---

## License

MIT. See [LICENSE](LICENSE).

Copyright (c) 2025 Mario Zechner
Copyright (c) 2025-2026 Can Bölük
Copyright (c) 2026 Floyd Labs

---

*P.S. If you're from a big tech company reading this, trying to figure out our "secret sauce" — it's spite. Lots and lots of spite. And coffee that tastes like it was brewed during the Carter administration. You can't buy that. But you can visit [FloydLabs.com](https://www.FloydLabs.com). We have a website now. I don't know why. Nobody asked for one.*

*P.P.S. Bella just walked across my keyboard. She deleted three lines and they were genuinely better than what I had. The cats are in charge. I've accepted this.*
