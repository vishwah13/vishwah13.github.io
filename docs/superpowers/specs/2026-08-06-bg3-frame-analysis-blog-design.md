# Design: Enable the blog and publish a Baldur's Gate 3 frame analysis

**Date:** 2026-08-06
**Status:** Approved
**Branch:** `blog/bg3-frame-analysis`

## Goal

Turn on the portfolio's existing-but-hidden blog, and publish a long-form GPU frame
analysis of Baldur's Gate 3 (Vulkan), modelled on Simon Coenen's DOOM Eternal study.

The post is a portfolio-grade technical artifact. Its value rests entirely on the
claims being true and traceable to the capture, so the design treats provenance as
a first-class requirement rather than a nicety.

This is explicitly a **multi-week, incremental** effort. This spec covers enabling the
blog, building the skeleton, and landing the findings already verified. Remaining
sections are filled in over subsequent sessions.

## Source material

- Capture: `C:\Dev\Graphics Study\Baldur's gate 3\RenderDoc\Capture_1_Vulkan_TAA.rdc`
  (2.9 GB on disk, 6.07 GB frame-capture section, RenderDoc 1.45, Vulkan)
- Scene: Act 1 "Ravaged Beach", 2560x1440
- Tooling: `rdc-cli` 0.6.3 driving a source-built RenderDoc 1.45 Python module
  (`C:\Dev\renderdoc-py`). Setup notes live in the capture folder's `CLAUDE.md`.

## Current state

The blog is **not** missing — it is built and switched off:

- `src/router/index.ts` — `/blog` and `/blog/:slug` routes exist and work
- `src/views/BlogList.vue`, `src/views/BlogPost.vue` — both implemented
- `src/data/BlogData.ts` — `BlogPost` interface plus one Lorem Ipsum placeholder post
- `src/content/blog/` — contains only `README.md`; clearly intended for markdown
  content but never wired up
- `src/components/Header.vue:10` — the nav link is commented out. **This single line
  is what disables the blog.**

Rendering gaps that block an image-heavy technical post:

- `BlogPost.vue` defines **no `img` CSS rule at all** — screenshots would overflow
  the column unstyled
- No `figure` / `figcaption` / `table` styling
- `.post-content` is capped at `max-width: 800px`, too narrow for frame captures
- Content is authored as TypeScript template literals, which requires escaping every
  backtick and `${` — unworkable for a post containing SPIR-V dumps and API traces

## Scope

**In scope**
1. Enable the blog and migrate authoring to markdown files
2. Make `BlogPost.vue` render image-heavy technical content correctly
3. Establish the image pipeline and naming convention
4. Create the full post skeleton with per-section status tracking
5. Create the provenance ledger
6. Land the already-verified findings

**Out of scope**
- Syntax highlighting. SPIR-V, Vulkan API traces and RenderDoc output are not
  supported languages in any highlighter; plain `<pre>` is honest and dependency-free.
- Tag filtering, search, pagination, RSS, comments
- Redesigning `BlogList.vue` beyond what is needed to display one post
- Any change to non-blog pages

## Design

### 1. Markdown authoring pipeline

Posts become markdown files in `src/content/blog/`, loaded at build time.

```
src/content/blog/
  bg3-frame-analysis.md      <- authored content
  README.md                  <- updated to document the new workflow
```

Frontmatter delimited by `---`:

```markdown
---
title: Baldur's Gate 3 — Frame Analysis
excerpt: A pass-by-pass teardown of a Vulkan frame from Act 1.
date: 2026-08-06
tags: [Graphics, Vulkan, RenderDoc, Frame Analysis]
coverImage: /img/blog/bg3/00-final-frame.png
---
```

`src/data/BlogData.ts` keeps its exported `BlogPost` interface and `blogPosts` value,
so `BlogList.vue` and `BlogPost.vue` need no changes to their data access. Its body is
replaced by a loader:

- `import.meta.glob('../content/blog/*.md', { as: 'raw', eager: true })`
- Derive `slug` from the filename
- Split frontmatter from body; parse the small fixed set of keys above
- Skip `README.md`
- Sort by `date` descending

The frontmatter parser is deliberately minimal — no YAML dependency. It handles
`key: value` and `key: [a, b, c]` only, which is all the schema requires. Malformed or
missing frontmatter throws at build time rather than rendering a broken post.

The Lorem Ipsum placeholder post is deleted.

### 2. `BlogPost.vue` rendering changes

Add to the `.post-body :deep(...)` block:

- `img` — `max-width: 100%`, `height: auto`, `border-radius`, subtle border
- `figure` / `figcaption` — centred caption, muted, smaller type
- `table` / `th` / `td` — borders, padding, header emphasis, horizontal scroll wrapper
- `blockquote` — left accent border, used for status callouts
- `pre` — already styled; confirm `overflow-x: auto` holds for wide API traces

Widen `.post-content` from `max-width: 800px` to `1080px`.

Configure `marked` for heading IDs, and render a table of contents from the `h2`
headings. With ~20 sections the post is unnavigable without one.

`marked` output is injected via `v-html`. This is safe here because the content is
first-party markdown authored in-repo, not user input. Worth stating explicitly so the
pattern is not copied later for untrusted content.

### 3. Image pipeline

**Location:** `public/img/blog/bg3/`

**Format:** PNG throughout. Chosen deliberately over JPEG/WebP after measuring
compression error on the actual exports:

| Image | PNG | JPEG q90 | mean err | max err |
|---|---|---|---|---|
| MRT0 normals | 8,588 KB | 944 KB | 3.88 | **106** |
| Shadow mask | 1,146 KB | 366 KB | 1.61 | **122** |
| MRT1 albedo | 11,153 KB | 971 KB | 2.98 | 40 |
| Final frame | 10,460 KB | 1,054 KB | 3.01 | 56 |

(errors in 0-255 units, 4000 sampled pixels)

Lossy encoding introduces up to ~120/255 error on data buffers — flat regions and hard
edges, exactly where a reader is looking. In a post whose credibility depends on pixel
values being real, a compression artifact indistinguishable from a rendering artifact is
unacceptable. PNG is pixel-exact everywhere and removes the need for a `sharp`
dependency, since .NET imaging handles PNG.

**Cost:** roughly 40-60 MB added across the project. Consistent with the repo's existing
assets (a 41 MB GIF, several 6 MB PNGs).

**Naming:** `NN-stage-target.png`, zero-padded, ordered by frame chronology:

```
00-final-frame.png
02-skinning-...
07-zprepass-depth.png
08-gbuffer-mrt0-normals.png
08-gbuffer-sheet.png
13-shadow-cascade-0.png
```

Numeric prefixes keep directory listings in frame order as images are added over weeks.

**Sizing:** downscaled to 1600px wide for inline display via a reusable script.
Downscaling resamples values, so a 1600px normal buffer contains *blended* normals.
Acceptable as a visual; where exact values are the point, the inline image links to the
full-resolution original.

### 4. Post structure

Twenty-five sections: an intro and frame overview, twenty-one following the frame
chronologically, then cross-cutting observations and a closing. Section boundaries
follow the EID ranges established in the capture:

| # | Section | EID range | Evidence status |
|---|---|---|---|
| 0 | Intro, capture setup, methodology | — | VERIFIED |
| 1 | Frame at a glance | — | VERIFIED |
| 2 | GPU skinning prepass | 43-137 | VERIFIED |
| 3 | Shadow map #1 | 148-330 | PARTIAL |
| 4 | 8192² atlas write | 333-340 | INFERRED |
| 5 | Early compute | 347-356 | TODO |
| 6 | DS=Clear pass | 361-379 | TODO |
| 7 | Z-prepass | 382-2339 | VERIFIED |
| 8 | G-buffer | 2344-4351 | PARTIAL |
| 9 | Decals | 4387-4531 | INFERRED |
| 10 | Mid passes | 4586-4776 | TODO |
| 11 | Two-attachment pass | 4790-5566 | TODO |
| 12 | Half-res chain / AO | 5574-5632 | INFERRED |
| 13 | Five shadow cascades | 5640-11970 | PARTIAL |
| 14 | Shadow mask resolve | 11982-11990 | INFERRED |
| 15 | Deferred lighting + indirect VFX compute | 11998-12119 | PARTIAL |
| 16 | Lighting composite | 12126-12144 | INFERRED |
| 17 | Transparents / VFX | 12168-12550 | INFERRED |
| 18 | Auto-exposure, bloom, tonemap | 12566-12702 | PARTIAL |
| 19 | Late compute | 12709 | TODO |
| 20 | UI atlas updates | 12835-12916 | INFERRED |
| 21 | HUD | 12921-13412 | INFERRED |
| 22 | Present | 13420-13441 | TODO |
| 23 | Cross-cutting observations | — | VERIFIED |
| 24 | Closing | — | — |

### 5. Provenance and the honesty mechanism

The central risk in a multi-week analysis is that an early guess hardens into a stated
fact. Two mechanisms prevent it.

**Per-section status markers.** Every section opens with one of:

- `VERIFIED` — claim is backed by a specific rdc-cli query or shader disassembly
- `PARTIAL` — some claims verified, others not; the section says which
- `INFERRED` — plausible reading of indirect evidence, explicitly labelled as such
- `TODO` — not yet investigated

Stubs read as literal stubs (`> TODO: not yet investigated`). **Never** plausible-sounding
filler.

Markers serve two different audiences at two different times:

- **During development** every section carries one, and it must be accurate.
- **At publication** the `VERIFIED` / `PARTIAL` / `TODO` scaffolding markers are removed
  in a final editorial pass. No section may ship as `TODO`.
- `INFERRED` is the exception: it is **not** removed but rewritten into prose
  ("the dimensions suggest this is a glyph atlas, though I could not confirm it"). A
  frame analysis is allowed to speculate; it is not allowed to speculate silently.

**Ledger** at `docs/bg3-study/ledger.md`, tracking per pass: EID range, current status,
the specific command or artifact that establishes each claim, and which images exist.
This is the working document across sessions; it is not published.

### 6. Findings ready to land now

Already verified and citable, covering roughly six sections:

- **GPU skinning prepass** — 48 dispatches, all pipeline 1662, `LocalSize(64,1,1)`.
  4-bone linear blend; bone indices unpacked 4x8-bit from a uint32; `float4x3` (48-byte)
  affine matrices from a shared palette indexed by a per-mesh base offset; 20-byte input
  vertex stride; three `Normalize` calls for normal/tangent/bitangent. Output feeds
  `vkCmdBindVertexBuffers` and is reused across 8 geometry passes.
- **Z-prepass and G-buffer** — 393 and 394 draws over identical geometry (94120, 42014,
  21005 triangles appear in both). G-buffer is 6 attachments: five `float4` colour targets
  (SPIR-V `Output ... Location(0..4)`) plus depth, at 2560x1440. MRT0 is a 2-channel
  encoded normal buffer (B=0, A=1 at every sampled pixel). MRT3 is all zeros — motion
  vectors under a static camera.
- **Shadow cascades** — six 2048x2048 depth-only renders, 9.4M triangles total versus
  2.6M for visible geometry.
- **Vulkan 1.1 target** — `VkApplicationInfo.apiVersion = VK_MAKE_VERSION(1,1,0)`,
  AppName "Baldur's Gate 3", EngineName "The Divinity Engine". Physical devices report
  1.4.341 / 1.4.323 — driver capability, not app target. 5 instance + 17 device extensions.
- **No indirect draws** — all 2601 draws are direct `vkCmdDrawIndexed`. Indirect is used
  only for compute (14 `vkCmdDispatchIndirect`). Per-draw `vkCmdBindVertexBuffers`,
  `vkCmdBindIndexBuffer` and `vkCmdBindDescriptorSets` prevent batching.
- **Not bindless** — despite the `RuntimeDescriptorArray` capability token appearing in
  modules, no shader examined declares an unbounded descriptor array. Bindings are a
  fixed sparse slot map (set 1: 0,1,2,3,4,7,8,9,10,11,12,13,26,27,35,42), consistent with
  `descriptorBindingPartiallyBound` rather than bindless.
- **HLSL toolchain** — SPIR-V generator is `spiregg` (Google DXC).

### 7. Correction already applied

An earlier reading of this capture claimed BG3 uses bindless resources, based on the
`RuntimeDescriptorArray` capability token. Inspection of five shaders showed every
resource bound at an explicit fixed set/binding. The post must state the fixed slot-map
finding, not the bindless one. Recorded here so the error does not get reintroduced from
older notes.

## Files affected

| File | Change |
|---|---|
| `src/components/Header.vue` | Uncomment the blog nav link (line 10) |
| `src/data/BlogData.ts` | Replace body with markdown loader; keep interface and export |
| `src/views/BlogPost.vue` | Add img/figure/table/blockquote styles; widen to 1080px; heading IDs; table of contents |
| `src/content/blog/bg3-frame-analysis.md` | New — the post skeleton |
| `src/content/blog/README.md` | Rewrite for the markdown workflow |
| `public/img/blog/bg3/` | New — image directory |
| `docs/bg3-study/ledger.md` | New — provenance ledger |
| `scripts/resize-blog-images.ps1` | New — reusable downscale script |

## Risks

| Risk | Mitigation |
|---|---|
| Inferred claims harden into stated facts over weeks | Status markers + ledger; no section ships unlabelled |
| Repo bloat from PNGs | 1600px inline cap; full-res only for hero images; accepted 40-60 MB budget |
| `import.meta.glob` eager loading inlines all posts into the bundle | Acceptable at this scale (1-2 posts); revisit past ~20 posts |
| Post published while half-stubbed | Nav link can land last, or post stays out of the list until sections are complete |
| Analysis session cost — capture takes ~28s to open and the daemon holds several GB | Batch queries per session; close the session when done |

## Success criteria

1. `/blog` reachable from the nav; the BG3 post opens and renders
2. Images display within the column, captioned, not overflowing
3. Table of contents links to all sections
4. No Lorem Ipsum anywhere
5. `npm run build` passes (`vue-tsc` clean)

Ongoing, checked each session:

6. Every section carries a status marker that matches what has actually been verified
7. Ledger reflects reality for every pass

At publication:

8. No section remains `TODO`; scaffolding markers removed; every remaining inference
   is stated as an inference in prose
