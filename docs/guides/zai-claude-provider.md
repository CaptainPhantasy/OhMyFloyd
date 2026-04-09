# Adding a ZAI-Backed Claude-Compatible Provider to OMP

## Background

Z.AI (zai) exposes an **Anthropic Messages API-compatible endpoint** at
`https://api.z.ai/api/anthropic`. This endpoint accepts the same request
format as `api.anthropic.com` but routes to GLM models on ZAI's
infrastructure. The GLM Coding Plan (MAX tier) provides generous quotas
against GLM-5.1, GLM-5, GLM-4.7, and others.

The goal: register a **new provider** in OMP (e.g. `zai-claude`) whose model
IDs mirror the Claude model names that Claude Code and other Anthropic
tooling expect, but whose traffic routes through ZAI. This gives you Claude
Code-shaped model slots backed by GLM, without touching the real `anthropic`
or `zai` providers.

---

## 1. ZAI Anthropic Endpoint Reference

| Item | Value |
|------|-------|
| Base URL (Coding Plan) | `https://api.z.ai/api/anthropic` |
| Auth header | `Authorization: Bearer <ZAI_API_KEY>` |
| Wire protocol | Anthropic Messages API (`anthropic-messages`) |
| Thinking toggle | `thinking: { type: "enabled" \| "disabled" }` |
| Reasoning field | `reasoning_content` (on `delta` and `message`) |
| Preserved thinking | `clear_thinking: false` (default on Coding Plan endpoint) |
| Context caching | Implicit/automatic -- no explicit cache control needed |

### Default Model Mappings (Coding Plan)

When Claude Code connects to the ZAI endpoint, ZAI's server-side mapping
translates Claude model names to GLM models:

| Claude Code Env Var | Default GLM Model |
|---|---|
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | `GLM-4.7` |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | `GLM-4.7` |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | `GLM-4.5-Air` |

You can override these to use GLM-5.1:

```json
{
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "glm-5.1",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "glm-5.1",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "glm-4.5-air"
}
```

---

## 2. GLM Model Specs (MAX Coding Plan)

All models below are available on the MAX plan.

| Model | Context | Max Output | Reasoning | Input $/MTok | Output $/MTok | Cache Read $/MTok |
|-------|---------|------------|-----------|-------------|---------------|-------------------|
| GLM-5.1 | 200K | 128K | Yes | $1.40 | $4.40 | $0.26 |
| GLM-5 | 200K | 128K | Yes | $1.00 | $3.20 | $0.20 |
| GLM-5-Turbo | 200K | 128K | Yes | $1.20 | $4.00 | $0.24 |
| GLM-4.7 | 200K | 128K | Yes | $0.60 | $2.20 | $0.11 |
| GLM-4.7-Flash | 200K | 128K | Yes | Free | Free | Free |
| GLM-4.5 | 128K | 96K | Yes | $0.60 | $2.20 | $0.11 |
| GLM-4.5-Air | 128K | 96K | Yes | $0.20 | $1.10 | $0.03 |

### MAX Plan Quotas

- **5-hour limit**: ~1,600 prompts (dynamically refreshed)
- **Weekly limit**: ~8,000 prompts
- GLM-5.1 / GLM-5 / GLM-5-Turbo consume **3x during peak hours** (14:00-18:00 UTC+8), **2x off-peak**
- Limited-time: GLM-5.1 and GLM-5-Turbo consume only **1x off-peak** through end of April

---

## 3. Thinking / Reasoning Protocol

ZAI uses a binary thinking toggle, not Anthropic's `budget_tokens` approach:

```json
{
  "thinking": { "type": "enabled" }
}
```

OMP already handles this via the `thinkingFormat: "zai"` compat flag in
`packages/ai/src/providers/openai-completions.ts`. The existing `zai`
provider models have this set. A new provider using `api: "anthropic-messages"`
with the ZAI base URL inherits this behavior from the Anthropic Messages
provider, which passes through the thinking parameter as-is.

### Preserved Thinking

On the Coding Plan endpoint, preserved thinking is **enabled by default**.
The model retains `reasoning_content` across turns, improving cache hits and
reasoning continuity. To use it explicitly on the standard API:

```json
{
  "thinking": { "type": "enabled" },
  "clear_thinking": false
}
```

### Interleaved Thinking

GLM thinks between tool calls and after receiving tool results. The
`reasoning_content` blocks must be returned verbatim in subsequent turns
to maintain coherence.

### Turn-Level Thinking

GLM-4.7+ supports toggling thinking per turn within the same session.
Disable for lightweight turns, enable for complex reasoning -- the model
stays coherent across the switch.

---

## 4. Adding the Provider to OMP

### Architecture Constraints

- **Do NOT modify** the `zai` section in `models.json` -- those are the real GLM models
- **Do NOT modify** the `anthropic` section -- those are real Anthropic models
- Create a **new top-level provider key** (e.g. `zai-claude`) that is
  completely independent
- Models in this provider use `api: "anthropic-messages"` and
  `baseUrl: "https://api.z.ai/api/anthropic"`
- The provider uses the `ZAI_API_KEY` for auth

### Step 1: Register the Provider Descriptor

In `packages/ai/src/provider-models/descriptors.ts`, add a new descriptor
**after** the existing `zai` entry:

```typescript
catalogDescriptor(
  "zai-claude",
  "claude-sonnet-4-6",  // default model
  config => zaiClaudeModelManagerOptions(config),
  catalog("zAI Claude", ["ZAI_API_KEY"]),
),
```

### Step 2: Create the Model Manager Options

In `packages/ai/src/provider-models/special.ts`, add:

```typescript
// ---------------------------------------------------------------------------
// ZAI Claude (GLM models exposed as Claude-shaped slots)
// ---------------------------------------------------------------------------

export interface ZaiClaudeModelManagerConfig {}

export function zaiClaudeModelManagerOptions(
  _config: ZaiClaudeModelManagerConfig = {},
): ModelManagerOptions<"anthropic-messages"> {
  return { providerId: "zai-claude" };
}
```

### Step 3: Add Models to models.json

Add a new top-level `"zai-claude"` section in `packages/ai/src/models.json`.
Each model ID mirrors a Claude model name but routes to a GLM model via ZAI.

The recommended mapping for MAX plan users:

```json
"zai-claude": {
  "claude-sonnet-4-6": {
    "id": "claude-sonnet-4-6",
    "name": "GLM-5.1 (as Sonnet 4.6)",
    "api": "anthropic-messages",
    "provider": "zai-claude",
    "baseUrl": "https://api.z.ai/api/anthropic",
    "reasoning": true,
    "input": ["text"],
    "cost": {
      "input": 1.4,
      "output": 4.4,
      "cacheRead": 0.26,
      "cacheWrite": 0
    },
    "contextWindow": 200000,
    "maxTokens": 131072,
    "thinking": {
      "minLevel": "minimal",
      "maxLevel": "xhigh"
    }
  },
  "claude-opus-4-6": {
    "id": "claude-opus-4-6",
    "name": "GLM-5.1 (as Opus 4.6)",
    "api": "anthropic-messages",
    "provider": "zai-claude",
    "baseUrl": "https://api.z.ai/api/anthropic",
    "reasoning": true,
    "input": ["text"],
    "cost": {
      "input": 1.4,
      "output": 4.4,
      "cacheRead": 0.26,
      "cacheWrite": 0
    },
    "contextWindow": 200000,
    "maxTokens": 131072,
    "thinking": {
      "minLevel": "minimal",
      "maxLevel": "xhigh"
    }
  },
  "claude-haiku-4-5": {
    "id": "claude-haiku-4-5",
    "name": "GLM-4.5-Air (as Haiku 4.5)",
    "api": "anthropic-messages",
    "provider": "zai-claude",
    "baseUrl": "https://api.z.ai/api/anthropic",
    "reasoning": true,
    "input": ["text"],
    "cost": {
      "input": 0.2,
      "output": 1.1,
      "cacheRead": 0.03,
      "cacheWrite": 0
    },
    "contextWindow": 131072,
    "maxTokens": 98304,
    "thinking": {
      "minLevel": "minimal",
      "maxLevel": "xhigh"
    }
  },
  "claude-sonnet-4-5": {
    "id": "claude-sonnet-4-5",
    "name": "GLM-5 (as Sonnet 4.5)",
    "api": "anthropic-messages",
    "provider": "zai-claude",
    "baseUrl": "https://api.z.ai/api/anthropic",
    "reasoning": true,
    "input": ["text"],
    "cost": {
      "input": 1.0,
      "output": 3.2,
      "cacheRead": 0.2,
      "cacheWrite": 0
    },
    "contextWindow": 200000,
    "maxTokens": 131072,
    "thinking": {
      "minLevel": "minimal",
      "maxLevel": "xhigh"
    }
  }
}
```

### Step 4: Wire Auth

The `ZAI_API_KEY` env var is already recognized by OMP's auth storage for
the `zai` provider. For the new `zai-claude` provider, the catalog descriptor
with `["ZAI_API_KEY"]` handles key resolution automatically.

### Step 5: Rebuild

```bash
cd /Volumes/SanDisk1Tb/OhMyFloyd
bun fix:ts
bun check:ts
bun --cwd=packages/coding-agent run build:binary
```

---

## 5. Usage

After building, the new provider appears in the model selector:

```bash
# Use GLM-5.1 through the Claude Sonnet slot
omf --model zai-claude/claude-sonnet-4-6

# Use GLM-4.5-Air through the Haiku slot
omf --model zai-claude/claude-haiku-4-5
```

You can also set it as your default model role:

```bash
omf config set model.default zai-claude/claude-sonnet-4-6
omf config set model.smol zai-claude/claude-haiku-4-5
omf config set model.slow zai-claude/claude-opus-4-6
```

---

## 6. How ZAI's Server-Side Model Mapping Works

When you send a request to `https://api.z.ai/api/anthropic` with a Claude
model name (e.g. `claude-sonnet-4-6`), ZAI's server transparently maps it
to the corresponding GLM model. The mapping is controlled server-side by
your Coding Plan subscription level.

This means:
- You do NOT need to rewrite model IDs in the request body
- The Claude model name goes over the wire, ZAI routes it to GLM
- Response format matches Anthropic Messages API with the addition of
  `reasoning_content` for thinking

If you want to force a specific GLM model instead of relying on server-side
mapping, use the actual GLM model ID (e.g. `glm-5.1`) as the model name
in the request. Both approaches work on the Anthropic endpoint.

---

## 7. Important Caveats

### Do Not Mention Competing Tools in API Calls

Anthropic actively filters API traffic for references to certain competing
coding tools. If such references appear in your requests (system prompts,
messages, headers, user-agent strings), Anthropic may block the request.
Since ZAI's Anthropic endpoint proxies through an Anthropic-compatible
layer, the same filtering may apply. Keep system prompts and tool metadata
clean of competing product names.

### Quota Consumption

GLM-5.1 and GLM-5 are premium models on the Coding Plan. During peak hours
(14:00-18:00 UTC+8) they consume 3x quota. For routine tasks, prefer
GLM-4.7 (the default) to conserve quota. Reserve GLM-5.1 for complex
multi-step engineering work where its 8-hour sustained execution capability
matters.

### Vision

The text models in this provider do not support image input. For vision
tasks, use `glm-5v-turbo` or `glm-4.6v` from the standard `zai` provider,
or use the Vision MCP Server included with all Coding Plan tiers.

### Context Caching

ZAI implements implicit context caching. Repeated system prompts and
conversation prefixes are automatically cached and billed at the reduced
cache-read rate. No explicit cache control parameters are needed.

### Preserved Thinking on Coding Plan

The Coding Plan endpoint enables preserved thinking by default. This means
`reasoning_content` from previous turns persists in context, improving
cache hits and reasoning quality. OMP's Anthropic Messages provider already
handles `reasoning_content` correctly in multi-turn conversations.
