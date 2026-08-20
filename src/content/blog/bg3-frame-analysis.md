---
title: Baldur's Gate 3 — Anatomy of a Vulkan Frame
excerpt: A pass-by-pass teardown of a single Baldur's Gate 3 frame, captured with RenderDoc — 2601 draws, 78 dispatches, and a renderer that targets Vulkan 1.1 on purpose.
date: 2026-08-06
tags: [Graphics, Vulkan, RenderDoc, Frame Analysis]
coverImage: /img/blog/bg3/00-final-frame.png
---

> **This study is in progress.** Sections are marked VERIFIED, PARTIAL, INFERRED or
> TODO as I work through the capture. Nothing here is filler — if I haven't confirmed
> something against the capture yet, the section says so.

Baldur's Gate 3 runs on Larian's Divinity Engine, and its Vulkan backend is a
fascinating thing to take apart: a 2023 game-of-the-year renderer that deliberately
targets a **Vulkan 1.1** feature floor, uses no bindless resources, and issues every
one of its 2601 draw calls directly.

This is a teardown of one frame from Act 1 — the Ravaged Beach, just after the
nautiloid crash.

![The frame this study analyses](/img/blog/bg3/00-final-frame.png)
*The analysed frame: 2560×1440, 2601 draws, 78 dispatches, 60 render passes.*

## Method

**Status: VERIFIED**

Three captures, all Vulkan, taken with RenderDoc 1.45: the **Ravaged Beach** in Act 1
(2.68 GB), the **Emerald Grove** (3.03 GB), and a **Goblin Camp dialogue close-up**
(3.46 GB). The walkthrough below follows the beach frame; the other two are used to
separate architecture from scene-specific coincidence.

Everything here was pulled with `rdc-cli` driving a source-built RenderDoc 1.45 Python
module — matching the capture's serialise version was necessary, since an earlier 1.41
build refused the file outright ("Vulkan capture is incompatible version 32, newest
supported by this build is 23").

Two things make BG3 harder to read than a typical sample:

- **No debug markers.** Pass names are RenderDoc's auto-generated ones, so every pass
  had to be identified from its attachments, dimensions and shader I/O rather than a label.
- **Stripped shader names.** The SPIR-V carries no reflection names — everything is
  `_12`, `_child0`. Semantics had to be recovered from types, decorations and the
  arithmetic itself.

## Frame at a glance

**Status: VERIFIED**

| Metric | Value |
|---|---|
| Resolution | 2560 × 1440 |
| API | Vulkan (targets 1.1) |
| Events | 2882 |
| Draw calls | 2601 (2562 indexed, 39 non-indexed) |
| Dispatches | 78 (14 indirect) |
| Render passes | 60 |
| Resources | 4774 |
| Visible geometry | ~2.6M triangles |
| Shadow geometry | ~9.4M triangles |

That last pair is the headline: **shadows cost roughly 3.6× more triangles than
everything you can actually see.**

## GPU Skinning

**Status: VERIFIED**  ·  EID 43–137

The frame opens with 48 compute dispatches, all sharing pipeline `1662` — one shader
run 48 times over different buffers. No textures are bound; the shader reads three
storage buffers and writes a fourth.

It is linear-blend skinning. The SPIR-V shows every step:

```
_101 >> 8 & 255 ; >> 16 & 255 ; >> 24 & 255   <- unpack 4 bone indices from a uint32
_115 = *&_4._child2                            <- palette base offset (uniform block)
_117 = &_7._child0[_115 + boneIndex]           <- index the shared bone-matrix palette
_118 = *_117  (float4x3)                       <- fetch 4 bone matrices

_128 = _118 * _81    <- matrix0 * weight0
_129 = _121 * _86    <- matrix1 * weight1
_139 = _124 * _91    <- matrix2 * weight2
_146 = _127 * _96    <- matrix3 * weight3
_132 = _130 + _131 ; _141 = _132 + _140 ; _148 = _141 + _147    <- sum

_154 = _66 * 20      <- vertex stride = 20 bytes
_169 = float4(pos.xyz, 1.0)
_170 = _169 * _153   <- skinned position
_171 = _154 + 12     <- remaining 8 bytes: packed normal/tangent
```

Implementation details worth noting:

- `LocalSize(64,1,1)`, four bones per vertex
- **20-byte input vertex stride** — 12 bytes position, 8 bytes packed attributes
- Bone matrices are **`float4x3`** (48-byte affine), not `float4x4`
- One **shared palette buffer** for all skeletons; each mesh indexes a window into it
  via a base offset from its uniform block, which is how 48 dispatches share a pipeline
- Three `Normalize` calls — normal, tangent and bitangent re-orthonormalized after blending

**Why do it as a prepass at all?** The output buffer is later bound with
`vkCmdBindVertexBuffers`, and this frame consumes that skinned geometry **eight times**:
the Z-prepass, the G-buffer, five shadow cascades and a shadow-atlas pass. Skinning in the
vertex shader would re-blend every skinned vertex eight times per frame — and the six
depth-only passes would each pay for it while needing nothing but position. Doing it once
up front eliminates seven redundant evaluations.

## The First Shadow Map

**Status: PARTIAL**  ·  EID 148–330

37 draws, 712K triangles, into a 2048×2048 depth-only target — and this one is not a
shadow map at all. It's a **shadow atlas**.

![The shadow atlas](/img/blog/bg3/02-shadow-atlas.png)
*Left: the whole 2048² target at the end of the pass. Right: the top-left corner magnified.
The repeating text is RenderDoc's `UNDEFINED IMG` pattern — memory that was never written.*

At the end of the pass, exactly **one tile of roughly 128×128 pixels** in the top-left
corner contains depth. Every other pixel of the 4-megapixel target is uninitialised. In
this scene there is a single local shadow-casting light, and it was allocated a small tile
because it is distant and physically small on screen.

Larian describe the system directly. It's **"Tile-based Omnidirectional Shadows"**
[Doghramachi15] — shadows for local lights packed as tiles into an atlas, with **tile size
varying by on-screen size and distance**, up to 2K per tile (512 on low settings). Omni
lights use a **tetrahedron shadow map** — four faces instead of a cube map's six — which
fits one light into one tile and means fewer draws duplicated across face boundaries.

The atlas itself is **8K on High settings, 2048 on Low**.

The payoff they cite is architectural: with all local shadows in one atlas, **every light
can be shaded in the single clustered lighting pass**. Before, each shadow-casting light
needed its own pass. It also lets the forward pass for alpha-blended objects reuse exactly
the same lighting path.

So this frame's 37 draws and 712K triangles are the cost of filling one 128px tile. Shadow
geometry cost is set by what a light can see, not by the resolution you store it at.

## An 8192² Atlas

**Status: PARTIAL**  ·  EID 333–340

One draw into an **8192×8192** target.

(An earlier version of this section counted twelve more draws at EID 12835–12916 as part of
the same group. They are not — they are a blur pyramid at 1280×720 and below, covered
further down. `rdc stats` had grouped them together and reported one representative target
size for the whole group.)

I originally guessed this was a glyph or UI atlas, on the strength of its size and the
position of the later draws near the HUD. The capture says otherwise. There is exactly one
8192×8192 texture in the whole frame and its format is **`R16_UNORM`** — a single channel
of 16-bit normalised data. That is shadow-distance storage. A text or UI atlas would be
`R8` or a colour format with alpha.

It also lines up with the size Larian give for the shadow atlas: **8K on High**. And the
first of these draws lands at EID 333, immediately after the shadow atlas pass at 148–330
finishes — the shape of a rendered tile being blitted into the atlas proper.

> INFERRED: the format and timing both point at the shadow atlas. With the late draws now
> known to belong elsewhere, the oddity of writing to a shadow atlas near the HUD
> disappears — this is a single early draw, exactly where an atlas write belongs.

Worth a footnote: the largest texture in the capture is **32688 × 26352**, `BC3_UNORM`,
861 megapixels of compressed data. Non-power-of-two at that scale is the signature of a
packed virtual-texture or asset atlas.

## Early Compute — Light Clustering

**Status: VERIFIED**  ·  EID 347–356

A single dispatch, and the only **3D** workgroup in the frame:

```
ExecutionMode LocalSize(4, 4, 4)      <- 64 threads, arranged 3-dimensionally
dispatch dimensions (9, 5, 12)
```

`9×4 = 36`, `5×4 = 20`, `12×4 = 48` — a **36 × 20 × 48 grid**. Against a 2560×1440 screen
that's roughly **72×72 pixel tiles with 48 depth slices**. It binds seven read-write storage
buffers and no textures at all.

A 3D grid over the view frustum, filled with buffer writes, running before any geometry is
drawn, is light clustering — assigning lights to froxels so the shading pass can look up
only the lights affecting each cluster. Larian call the technique "our clustered lighting",
and this is where the clusters get built.

The capture also carries the volume textures such a renderer needs:

| Volume | Reading |
|---|---|
| **285 × 160 × 128** | 2560/285 ≈ 9 px, 1440/160 = 9 px — a **9×9 pixel froxel grid with 128 depth slices** |
| 64×64×128, 64×64×64 | smaller volumes, likely fog scattering / integration steps |
| 32×32×32, 256×128×32 | small lookup volumes |

That 285×160×128 grid is volumetric fog, and Larian confirm the approach in as many words:
**"Froxel based (frustum voxels)"**, with two global fog layers, local fog volumes, and
artist controls for colour, density, height and noise. They also note it wasn't originally
planned — it went in because quality wasn't good enough without it.

So there are *two* separate 3D grids in play: a coarse 36×20×48 one for light clustering,
and a fine 285×160×128 one for volumetrics.

## Fill Stencil Pass

**Status: VERIFIED**  ·  EID 361–379

Five draws, one triangle each, into a depth-stencil target. Every one of them uses the
same stencil configuration:

```
function      = AlwaysTrue
passOperation = Replace
```

What varies is the reference value and write mask:

| EID | reference | writeMask |
|---|---|---|
| 367 | 1 | 255 |
| 370 | 2 | 2 |
| 373 | 4 | 4 |
| 376 | 8 | 8 |
| 379 | 16 | 16 |

`1, 2, 4, 8, 16` — one fullscreen draw per stencil bit. The first clears the byte and
sets bit 0; the next four OR in a single bit each.

This is the setup pass for BG3's **opaque object fading** system, and it is the more
interesting of the two ways Larian implemented it. See **Fading Opaque Objects** below.

## Depth Pre-pass

**Status: VERIFIED**  ·  EID 382–2339

393 draws, 2.62M triangles, writing depth only at 2560×1440 — no colour attachment.

The giveaway that this is a prepass rather than a shadow render is that the *next*
pass draws the same geometry: triangle counts 94120, 42014 and 21005 appear in both,
in the same order. BG3 lays down depth first, then shades.

## G-Buffer

**Status: PARTIAL**  ·  EID 2344–4351

394 draws, 2.62M triangles, into **six attachments** — five `float4` colour targets
plus depth, all at 2560×1440. The fragment shader confirms it:

```
Output float4* _7  : [[Location(0)]];
Output float4* _8  : [[Location(1)]];
Output float4* _9  : [[Location(2)]];
Output float4* _10 : [[Location(3)]];
Output float4* _11 : [[Location(4)]];
```

![The five G-buffer targets](/img/blog/bg3/07-gbuffer-sheet.png)
*All five colour targets at the end of the G-buffer pass, Ravaged Beach.*

**A warning about looking at these buffers.** Every one of them stores real data in its
alpha channel, and on several the alpha is very low — MRT2 sits at `a = 0.031` (8/255)
across most of the screen. If you composite such an image, or simply display it on a dark
page, the viewer blends the RGB toward the background and you see almost nothing. My first
pass at this misread MRT2 as "black except the characters" for exactly that reason. Every
G-buffer image here has alpha forced to 1 so you are seeing the stored RGB.

To separate what is architectural from what is scene-specific, here is the same G-buffer
from a second capture — the Emerald Grove, with dense foliage, water and a four-person
party instead of open sand:

![The same five targets in the Emerald Grove](/img/blog/bg3/07-gbuffer-sheet-grove.png)
*The same five colour targets in a second capture, Emerald Grove.*

| Target | Contents | Confidence |
|---|---|---|
| MRT0 | Encoded normals, 2-channel | **VERIFIED** — B is exactly 0.0 and A exactly 1.0 at every sampled pixel in both captures; only R and G vary, which is why it renders yellow-green |
| MRT1 | Albedo, with data in alpha | **VERIFIED** as albedo; alpha varies per material (1.00 / 0.85 / 0.96 across character, stone, dirt) but its meaning is unconfirmed |
| MRT2 | Material scalars + packed flags | **VERIFIED** — RGB are three clamped scalars; **alpha is a packed bitfield**. See below |
| MRT3 | Motion vectors | **VERIFIED** — see below |
| MRT4 | Four bit-packed integer quantities | **VERIFIED** — not a colour at all. See below |

### MRT2 and MRT4 are bit-packed, not colours

I spent two sessions sampling these two buffers and reasoning about what the values might
mean. That was the wrong approach, and it produced a wrong answer: I concluded MRT4 held a
per-material *colour* — a translucency tint — because it renders as vivid flat colours per
object, green on foliage, orange on the worg's hide.

Reading the actual shader settles it. The G-buffer pixel shader ends like this:

```
*_7  = _639;                              <- MRT0
*_8  = _642;                              <- MRT1
*_9  = _656;                              <- MRT2
*_10 = {0.0000, 0.0000, 0.0000, 0.0000};  <- MRT3, literal zero
*_11 = _573;                              <- MRT4
```

**MRT2's alpha is a packed bitfield:**

```
_646 = Select(_630, 1, 0)     <- a boolean flag
_647 = _646 << 3              <- placed at bit 3   (value 8)
_650 = _627 & 7               <- a 3-bit id, 0-7
_651 = _650 << 4              <- placed at bits 4-6 (16 / 32 / 64)
_653 = _649 | _651
_655 = ConvertUToF(_653) * 0.0039        <- integer, divided by 255
```

RGB are three separate `clamp(x, 0, 1)` scalars, but alpha is an **integer built from a
flag and a 3-bit id, then normalised into the 8-bit channel**. That is why every alpha
value I sampled across three captures was a discrete number — 8/255, 21/255, 51/255,
69/255. They were never continuous quantities; they are packed integers.

**MRT4 is denser still — four quantities across four channels:**

```
_559 = _558 mod 256            <- low 8 bits of A
_561 = floor(_558 / 256)       <- high bits of A
_563 = _562 mod 32             <- low 5 bits of B
_564 = _563 * 8 + _561         <- B's low 5 bits, then A's high 3
_567 = _548 mod 4              <- low 2 bits of C
_568 = _567 * 64 + _566        <- C's low 2 bits, then B's high 6
_571 = _557 * 4 + _570         <- D, then C's high 2
_573 = {_559, _564, _568, _571} * 0.0039
```

Four values, hand-packed with fields **straddling channel boundaries**, then divided by 255
into an RGBA8 target. Nothing in MRT4 is a colour. The striking per-object colours are bit
patterns being displayed as RGB, and (1,1,1,1) on stone and metal simply means every bit
happened to be set.

The lesson is worth stating plainly: **a G-buffer channel is a place to put bits, not
necessarily a picture.** Two sessions of careful pixel sampling produced a confident and
wrong physical story, and thirty lines of disassembly replaced it with the truth.

MRT3 being a literal `{0,0,0,0}` here is also the direct explanation for the empty motion
buffer in the beach frame — this shader draws static geometry and hard-codes zero velocity.

> Caveat: this is one G-buffer shader variant, used for static scene geometry. Skinned and
> skin/fur materials use different shaders and may pack different fields. What is
> established is the *structure* — packed integer data — not the meaning of every field.

### MRT3 is confirmed motion vectors

In the Ravaged Beach frame MRT3 is all zeros, which I put down to a static camera. That was
consistent with motion vectors but didn't prove them — an unused buffer looks identical.

Two more captures settle it. The Grove also has a static camera, yet MRT3 is **not** empty
there: motion appears precisely on the **wind-animated foliage** and nowhere else. And the
cinematic makes it unmistakable:

![Motion vectors during a cinematic](/img/blog/bg3/07-mrt3-motion-vectors.png)
*MRT3 during dialogue. The three characters are animating; the entire set is black.*

Characters move, the environment doesn't, and the buffer shows exactly that. This is what
feeds the TAA in the capture's filename.

![G-buffer normals](/img/blog/bg3/07-gbuffer-mrt0-normals.png)
*MRT0 — two-channel encoded normals. The green-yellow cast is the empty blue channel.*

![G-buffer albedo](/img/blog/bg3/07-gbuffer-mrt1-albedo.png)
*MRT1 — albedo, unlit.*

## Decals

**Status: VERIFIED**  ·  EID 4387–4531

45 draws that write back into the G-buffer, and they split cleanly into two completely
different systems:

- **40 draws of 12 triangles** — `numIndices: 36`, i.e. a box. Conventional deferred decal
  volumes.
- **5 draws of 28,800 triangles** — a screen-space tile mesh. These are gameplay surfaces,
  and they get their own section, **Gameplay Surfaces**, below.

## Mid Passes — Emissive

**Status: VERIFIED**  ·  EID 4586–4776

39 draws of small props (6,240 / 3,392 / 1,024 / 847 triangles) followed by 5 larger ones.
The render target at the end of the block is an almost entirely black image scattered with
**orange embers and fire**, matching the burning wreckage in the scene.

The shader confirms it. It emits a single `float4` built like this:

```
_120 = _117 * _119        <- an emissive colour (float3 uniform) times an intensity scalar
_121 = _120 * _115
_122 = _121 * _61
_126 = {_122.x, _122.y, _122.z, 1.0000}
```

A colour constant scaled by an intensity term, with alpha hard-set to 1.0. That is emissive
accumulation — geometry rasterized so self-illuminating materials can deposit their
contribution, everything else staying black.

## Velocity

**Status: VERIFIED**  ·  EID 4790–5566

132 draws, 529K triangles, 2560×1440, two attachments (one colour plus depth).

I had this one wrong. Because the pass re-renders the same major meshes as the Depth
Pre-pass and G-Buffer — **94,120 / 42,014 / 21,005** triangles, same counts, same order —
and because its output is near-black with only a faint red-green glow at the edge of frame,
I read it as a second emissive pass.

The shader says otherwise. Its output is not a `float4` colour but a **`float2`**:

```
_162 = {_158, -_160}            <- a jitter offset, Y negated
_163 = Fma(_151, _156, _162)    <- the reprojected previous-frame position
_164 = _141 - _163              <- current position MINUS previous position
*_7  = _164
```

A difference of two screen-space positions is a **motion vector**. This is a dedicated
velocity pass, and the reason it looks black is the same reason MRT3 does: the camera is
static, so static geometry has no screen-space motion. The faint red and green at the frame
edge is genuine velocity on wind-moved vegetation, `x` in red and `y` in green.

That also explains why it must re-submit the whole scene. Velocity is a per-pixel quantity
derived from geometry transforms; you cannot compute it without rasterizing the geometry
again.

So the heaviest meshes in this frame are transformed **three times before a single light is
evaluated** — Depth Pre-pass, G-Buffer, Velocity — and then once more for each of the six
depth-only shadow passes.

### This complicates the MRT3 story

If there is a dedicated velocity pass, what is the G-buffer's MRT3 doing? The static
G-buffer shader writes it as a literal `{0,0,0,0}`, which rules out camera-motion velocity —
a moving camera gives static geometry non-zero screen velocity, so a camera-aware buffer
could not hard-code zero.

The most consistent reading is that **MRT3 carries the object-animation contribution**
(zero by construction for static meshes, vivid on the animating characters in the cinematic
capture) while **this pass produces the full screen-space vector including camera
reprojection**. Both are motion; they are not the same quantity.

> TODO: confirm by tracing a skinned material's G-buffer shader and comparing what it
> writes to MRT3 against what this pass computes for the same pixel.

## Half-Resolution Chain — Ambient Occlusion

**Status: VERIFIED**  ·  EID 5574–5632

A series of single-draw fullscreen passes at **1280×720** — exactly half resolution — with
four attachments. One of them produces a buffer that renders as flat red.

Flat red because the output is a **single scalar**:

```
Output float* _4 : [[Location(0)]];
```

One channel, so only R carries data. The shader binds three sampled 2D images and runs a
bounded sampling loop:

```
if(!_174) break;
_146 = Dot(_145, _145)      <- squared distance to a sampled neighbour
_229 = Dot(_228, _228)
_230 = Dot(_157, _228)      <- surface normal against the sample direction
```

Sampling neighbours in a loop, weighting each by squared distance and by the dot product
against the surface normal, accumulating one scalar — that is screen-space **ambient
occlusion**, computed at quarter the pixel cost and later upsampled.

## Sky, Atmosphere and Clouds

**Status: PARTIAL**  ·  EID 4540–4581

Baldur's Gate 3 has **no dynamic time of day**. So why build a dynamic sky at all?

Larian's answer is that it was **for development, not for the game**. A static skydome
texture has to be re-baked every time an artist tweaks the lighting; a dynamic system means
they don't. The player-facing case barely needs it — the camera mostly looks down, and in
cinematics you rarely see sky. What shipped is deliberately modest: atmospheric scattering,
stars and moon, and volumetric clouds they describe as "still quite a basic
implementation".

The capture backs this with a distinctive texture. There is a **256 × 128 × 32** volume —
textbook dimensions for a precomputed atmospheric scattering lookup — and tracing its usage
shows exactly where atmosphere gets applied:

| Read at | What is happening |
|---|---|
| EID 4549 | a single fullscreen draw — the sky itself |
| EID 4564 | a compute dispatch that writes a 64×64×128 volume |
| EID 12031–12096 | **all fourteen** tile-classified lighting dispatches |
| EID 12197–12212 | the transparent/VFX passes |

Every lighting variation samples it, which is aerial perspective: distant surfaces need the
atmosphere between them and the camera folded into their shading, not painted on afterwards.

### Clouds cast shadows from a painted map

The clouds can optionally cast shadows onto the world, driven by a **cloud coverage map
that artists paint by hand** — choosing where shadow falls and where it doesn't, to get
overcast atmospheres and shafts of light through gaps. It's a nice example of a system
whose real purpose is art direction rather than simulation: not "where would clouds be" but
"where does this scene want shade".

> INFERRED: the 256×128×32 volume's identification as a scattering LUT comes from its
> dimensions and usage pattern. I have not traced the sky shader itself, and the cloud
> coverage map has not been located in the capture.

## Shadow Cascades

**Status: PARTIAL**  ·  EID 5640–11970

The largest block of work in the frame: five depth-only passes, every one 2048×2048,
totalling 1323 draws and roughly 9.4M triangles.

![A shadow cascade](/img/blog/bg3/12-shadow-cascade.png)
*One 2048² cascade — an orthographic sun projection across the beach terrain.*

Draw counts climb across the cascades (153, 280, 375, 434, 81), consistent with
progressively larger world-space coverage. The three heaviest draws in the entire
frame — 229,376, 180,224 and 163,840 triangles — are all in these passes, and they are
instanced terrain draws of 14, 11 and 10 patches respectively. See **Terrain** below.

> TODO: extract the cascade projection matrices and confirm the split distances.

## Shadow Mask Resolve

**Status: VERIFIED**  ·  EID 11982–11990

![Screen-space shadow mask](/img/blog/bg3/13-shadow-mask.png)
*Red where lit, black where shadowed — the cascades resolved into screen space.*

The shader settles what this is. It contains four **`ImageSampleDrefExplicitLod`**
instructions — depth-*comparison* samples, the hardware shadow-lookup instruction that
compares a stored depth against a reference and returns a filtered occlusion result rather
than a colour. Nothing but shadow sampling uses `Dref`.

It also declares **thirteen `Image<float, 2DArray>`** textures. That's a structural detail
worth having: the cascades are **array slices of a single texture**, not five separate
shadow maps, which is what lets one shader index whichever cascade a pixel falls into.
Twenty-four `FClamp` operations do the rest — clamping and blending cascade contributions
so the transitions between them don't show as hard bands.

The output is a screen-space mask: sun visibility per pixel, resolved once, then read by
the lighting rather than each light re-sampling the cascades.

## Tile-Classified Clustered Lighting

**Status: VERIFIED**  ·  EID 11998–12119

This is my favourite thing in the frame, and I had it wrong at first — I assumed the
indirect dispatches here were VFX simulation. They're the lighting.

21 dispatches: 7 direct, then **14 `vkCmdDispatchIndirect`** whose group counts are
produced on the GPU:

```
55098, 0, 511, 0, 42, 0, 0, 1222, 690, 6, 31, 0, 0, 0
```

Add them up and you get **57,600**. The screen is 2560×1440. Divide it into 8×8 pixel
tiles:

```
2560 / 8 = 320 tiles across
1440 / 8 = 180 tiles down
320 x 180 = 57,600 tiles       <- exactly the sum of the dispatch counts
```

Every tile on screen is accounted for, exactly once, across fourteen dispatches.

### What's happening

Larian compile **optimised variations of their clustered lighting shader**, each handling
only one, two or three shading models — **14 combinations** in total. A **classification
compute pass** examines each 8×8 tile, determines which shading models it actually needs,
and writes per-variation tile counts and index lists. Then one **indirect dispatch per
variation** shades only the tiles belonging to it.

The capture backs every part of this:

| Evidence | Value |
|---|---|
| Indirect dispatch count | **14** — matching the 14 documented variations |
| Sum of group counts | **57,600** — exactly the 8×8 tile count at 2560×1440 |
| Workgroup size of every lighting dispatch | `LocalSize(8, 8, 1)` — 64 threads, one tile per group |
| EID 11998 | `LocalSize(1,1,1)`, one resource — the indirect-args setup |
| EID 12004 / 12009 / 12016 | `LocalSize(8,8,1)` — the classification pre-passes |
| Bound resources per variation | **38** at EID 12031, **42** at EID 12066 — genuinely different shaders, not one shader re-dispatched |

### What the numbers say about this scene

Six of the fourteen variations dispatch **zero** groups. Those shading-model combinations
simply don't occur anywhere on screen, and they cost nothing beyond an empty dispatch.

One variation takes **55,098 of 57,600 tiles — 95.7% of the screen**. That's the Ravaged
Beach for you: overwhelmingly terrain and rock under one shading model, with small islands
of complexity. The 6-tile and 31-tile variations are presumably the character's skin and
hair, or the fire.

This is the payoff of the technique. Rather than run an uber-shader that branches over
every shading model for all 57,600 tiles, 95.7% of the screen runs a shader that only
knows about the one model it needs.

> Note the contrast with the geometry passes: BG3 will happily drive *lighting* from the
> GPU with indirect dispatch, but every one of its 2601 draws is direct. Compute-side
> indirect ports cleanly to DirectX 11; GPU-driven geometry submission does not.

## Lighting Composite

**Status: PARTIAL**  ·  EID 12126–12144

Two consecutive single-draw fullscreen passes, and the first fully lit image of the frame
appears at the end of them.

They run near-identical shaders — 1,518 and 1,514 lines — and diffing their bindings shows
they differ by **exactly one texture**, `DescriptorSet(1), Binding(7)`. Two variants of one
composite, one of which needs an extra input.

The scale is the striking part. Each declares **84 sampled 2D images** and performs about
**52 texture samples**, with **no loops at all** — entirely unrolled. That is a gather:
G-buffer targets, the shadow mask, ambient occlusion, the fog volume and the rest, combined
in one pass rather than accumulated over many.

> INFERRED: the "big gather" reading follows from the binding count and sample count. I have
> not identified which of the 84 inputs is which, so the exact composition is unconfirmed.

## Volumetric Fog

**Status: VERIFIED**  ·  volume written EID 12114–12119

Larian call this **"perhaps the most impactful change that we made visually"** — and it was
not initially planned. It went in late, because they felt the quality "was just not good
enough yet" without it.

What shipped is **froxel based** (frustum voxels), with **two global fog layers**, support
for **local fog volumes**, and artist controls for colour, density, height and noise.

The capture shows the grid. There is a **285 × 160 × 128** volume, and against a 2560×1440
screen that works out to:

```
2560 / 285 = 9.0 px      1440 / 160 = 9.0 px      128 depth slices
```

**9 × 9 pixel froxels across 128 slices through the view frustum.** Usage tracing shows the
full lifecycle: written at the end of the lighting block (EID 12114–12119), then read by the
scene composite and by every transparent draw through to EID 12550.

### Why it mattered so much

The system it replaced was ordinary depth-based fog, and Larian are blunt about its
limits — scenes looked flat, and pushing the fog forward to add depth "quickly drowns out
all the lighting". A depth-based fog is a function of distance alone; it cannot know that
there is a fire to your left or a lit window behind a building.

A froxel volume can. Because it stores in-scattered light per cell, you can **see where the
lights are** — including lights whose sources are hidden behind geometry. Larian's example
is being able to feel the fire, and the blue glow of a tree, as volume in the air rather
than as a flat wash over the image.

That is also what makes the particle trick above possible. Once you have a volume that
knows how much light reaches every point in the frustum, lighting the VFX is a lookup.

## Transparency and VFX

**Status: VERIFIED**  ·  EID 12168–12550

53 draws. Fire and embers appear in the render target across this range — and the way they
are lit is one of the neater economies in the frame.

Tracing which events read the **285 × 160 × 128** volumetric fog volume gives a clear
answer: after being integrated at EID 12114–12119, it is sampled at **12179, 12188, 12197,
12202, 12207 … 12528, 12536, 12545, 12550** — throughout this entire pass, draw after draw.

The particles are being lit *by the fog*. Larian describe it as a **"free VFX lighting
approximation"**: rather than evaluating lights per particle, they sample the **in-scatter
luminance** already computed in the froxel volume and use that as the particle's lighting.
The volume knows how much light is arriving at every point in the frustum, which is most of
what a particle needs to know, and it has already been paid for.

It is a good illustration of a general principle — the cheapest lighting is lighting you
already computed for something else.

## Post Processing

**Status: PARTIAL**  ·  EID 12566–12702

Three dispatches here, and they are not all post-processing:

- **12566** — the **fade blending pass** (see **Fading Opaque Objects** below). Not
  exposure or bloom.
- **12572** — reads a texture, writes a storage buffer and a texture. Unidentified.
- **12576** — reads a texture and writes two storage buffers, the shape of a luminance
  histogram reduction for auto-exposure.

Then a chain of single-draw fullscreen passes through the half-resolution targets, ending
in a graded image.

Two small 3D textures are consumed right at the end of that chain — a **32×32×32** at EID
12694 and a **64×64×64** at 12702. A 32³ volume read during final post is the standard
shape of a **colour-grading LUT**: the graded look is a lookup, not a formula, which is what
lets artists author it in a colour tool and ship it as a texture.

![The post-processing chain](/img/blog/bg3/17-post-chain.png)
*Render targets sampled across the back half of the frame.*

> TODO: confirm the histogram, and separate the bloom mips from the tonemap.

## Late Compute — Upsample and Composite

**Status: PARTIAL**  ·  EID 12709

```
ExecutionMode LocalSize(64, 1, 1)
dispatch dimensions (160, 90, 1)
inputs   2560×1440  and  320×180
output   2560×1440
```

`160 × 90` is the same 16×16 pixel tile grid the surface-decal system uses — 2560/16 and
1440/16 — with 64 threads per group covering the tile's 256 pixels four at a time.

The signature is a **⅛-resolution image combined with a full-resolution one**: 320×180 is
exactly 2560/8 by 1440/8. That is an upsample-and-composite, the standard way a bloom or a
half/quarter-res effect gets folded back into the full-resolution image.

> INFERRED: the shape is unambiguous but which effect is being composited is not. Bloom is
> the most likely candidate given its position after the tonemap chain.

## A Blur Pyramid

**Status: VERIFIED**  ·  EID 12835–12916

I had these twelve draws filed as "UI atlas updates", writing into the 8192² target. Both
halves of that were wrong, and the way it went wrong is worth recording.

Their render targets form a pyramid:

```
1280x720  ->  672x392  ->  352x212  ->  672x392  ->  1280x720
```

Down, down, then back up. And the shader is twelve lines of arithmetic:

```
_30 = sample(uv0)
_32 = sample(uv1)
_35 = sample(uv2)
_38 = sample(uv3)
_39 = _30 + _32 + _35 + _38
_40 = _39 * 0.2500        <- average of four taps
```

Four UVs supplied as vertex inputs, four samples of the same texture, averaged. A **4-tap
box filter**, applied down a resolution pyramid and then back up it with alpha blending —
the standard construction for a wide, cheap blur.

**Nothing here touches the 8192² texture.** The mistake came from `rdc stats`, which groups
render passes by their load-op signature and reports a single representative target size
for each group. These passes and the shadow-atlas pass share a signature, so the tool
displayed one size — 8192×8192 — for a group containing targets from 1280×720 downward. A
summary view had silently merged two unrelated systems.

> INFERRED: a down-then-up blur pyramid immediately before the HUD is either a late bloom
> or a blurred backdrop for translucent UI panels. I have not traced which pass consumes
> the result.

## UI

**Status: VERIFIED**  ·  EID 12921–13412

109 draws composing the hotbar, portrait and minimap. After everything else in this frame,
the shaders are almost startlingly plain — 49 lines, three bound resources, and a **single
texture sample**:

```
Output float4* _3 : [[Location(0)]];
```

Textured quads with alpha blending. The most complex renderer in the frame ends by drawing
rectangles.

## Present

**Status: PARTIAL**  ·  EID 13420–13441

The frame closes with a single compute dispatch reading one texture and writing another,
then a one-draw pass. The render target at EID 13441 is the finished image — scene, HUD,
minimap and hotbar composited together, exactly what reaches the screen.

![The completed frame](/img/blog/bg3/00-final-frame.png)
*EID 13441 — the final presented image.*

Thirteen thousand four hundred and forty-one events to get here.

## Terrain

**Status: VERIFIED (capture) / ATTRIBUTED (design rationale from Larian's GPC talk)**

Early on I flagged the three largest draws in the frame — 229,376, 180,224 and 163,840
triangles — as "suspiciously round, probably terrain." They are terrain, and the exact
numbers turn out to say a great deal.

### One instanced draw, 16,384 triangles per patch

| EID | numIndices | numInstances | total triangles |
|---|---|---|---|
| 330 | 49,152 | **10** | 163,840 |
| 11604 | 49,152 | **11** | 180,224 |
| 11970 | 49,152 | **14** | 229,376 |

The index count is identical every time — **49,152 indices = 16,384 triangles per patch** —
and only the instance count changes. That number decomposes exactly:

```
64 x 64 quads  x  4 triangles per quad  =  16,384
```

Which is precisely the geometry Larian describe: a **64 m² patch at one vertex per metre**,
with an **extra centre vertex** turning each quad into a four-triangle fan. In *Divinity:
Original Sin 2* terrain patches were one vertex every 2 m and each patch was **its own draw
call**, with a further **unique draw call per painted material layer**, all alpha tested.
BG3 collapses that to one instanced draw with per-instance culling.

The varying instance counts are that culling working: 10, 11 and 14 patches survive for
three different shadow views. In the G-buffer pass the same terrain appears as instanced
draws of 3, 2, 10, 3 and 5 patches.

### The vertex format is two integers

```
Input uint2* _3 : [[Location(0)]];
```

That is the *entire* per-vertex input — a packed grid coordinate. Height comes from a
texture sampled in the vertex shader (244×244 in this frame). It's why Larian could
quadruple the tessellation and note it "didn't add anything in our map data": the mesh is
a shared template, and the map data is a heightfield.

### Holes are cut with NaN

An instanced draw can't skip patches, so cutting a hole in the terrain — for a cave mouth
or a building interior — needs a trick. Larian keep a per-quad hole flag and, where a hole
exists, **set the centre vertex to NaN**, which kills all four of that quad's triangles at
rasterization. Their slide calls it a "~~Hack~~ Creative workaround."

It's visible in the shipped terrain vertex shader:

```
float4 _209 = Phi({nan, nan, nan, nan}, {nan, nan, nan, nan}, _22);
```

A branch merge whose result is a `float4` of NaN. There are few things more satisfying in
a frame capture than finding the exact line where a studio admitted to a hack.

### Layer blending

Terrain shading uses **brushes** with height-based blending: at most four layers blended
per pixel, drawn from many more layers overall, with a **keys map** generated offline
holding the eight most contributing layers per texel — and, per Larian, stored at twice the
height map's resolution.

The bound textures at a G-buffer terrain draw line up with that:

| Texture | Size | Reading |
|---|---|---|
| Vertex-stage heightfield | 244×244 | height data |
| Pixel-stage | 242×242 | height/derived data |
| Pixel-stage | **485×485** | ≈ 2× the 242² map — the keys map |
| Pixel-stage | 483×463 | a second ~2× map |
| Pixel-stage | **12 × 1024×1024** | terrain brush texture sets |

The 485×485 against 242×242 is the two-to-one relationship the talk describes (the maps are
sized to world extent rather than to powers of two, so it isn't exactly 484).

> INFERRED: twelve 1024² textures is consistent with **four layers × three maps each**,
> matching the documented four-layers-per-pixel maximum — but I have not confirmed the
> grouping.

## Fading Opaque Objects

**Status: VERIFIED (capture) / ATTRIBUTED (technique from Larian's GPC talk)**

Two of the passes above only make sense together, and they implement one of the nicer
ideas in this renderer.

BG3 constantly has to fade opaque geometry: rooftops and walls vanish as you walk behind
them, an entire floor disappears when you enter a building, characters fade in the
selection UI. The standard solution is a dither/dissolve pattern with a `clip`/`discard`
in the pixel shader — which has two costs Larian called out in their
[GPC 2024 talk](https://www.youtube.com/watch?v=zuDjcoabX7U): it **disables early Z** for
every material that might fade, and you can **see the dither pattern**.

Their answer is to move the dither into the **stencil buffer**, so no pixel shader
modification is needed at all — only a depth-stencil state swap on the fading object.

### The Fill Stencil pass (EID 361–379)

A 4×4 Bayer ordered-dither pattern is written into the low stencil bits, then the object's
opacity is compared against it with `function = GREATER` and a read mask over those bits.
Same visual result as a dithered discard, but the pixel shader is untouched and early Z
survives.

Larian's slide notes they use `SV_StencilRef` where the hardware supports it, and fall
back to **"separate draw per bit"** otherwise. **This capture is running the fallback** —
that's exactly what the five draws at reference `1, 2, 4, 8, 16` are.

And the capture explains *why*. Writing an arbitrary stencil reference from a shader on
Vulkan requires **`VK_EXT_shader_stencil_export`**, and that extension is **not among the
17 this build enables**. On the Vulkan backend the fast path simply isn't available, so
the fallback is forced. Four bits of Bayer pattern plus bit 4 — the talk's 1-indexed
"bit 5", value 16 — is five draws.

### Hiding the pattern (EID 12566)

The clever part. To avoid the dither being *visible*, Larian took inspiration from
**"Inferred Lighting: Fast dynamic lighting and shadows for opaque and translucent
objects"** [Kircher09], which uses a discontinuity-sensitive filter to reconstruct
lighting from a lower-resolution buffer, and reuses the same filter data to reconstruct
stippled transparency.

So the fill pass also sets bit 4 to 1 and leaves bit 5 at 0. After fading objects render,
those two bits carry the information a reconstruction filter needs: an **inverse mask** of
where fading objects were drawn, and the **stipple pattern** of which of their pixels
passed. The mask is inverted for a specific reason — there is no "set to one" stencil
operation to increment or decrement against, so they zero instead, which lets multiple
fading objects overlap correctly.

A **fade blending compute pass** then reconstructs the image during post-processing. In
this capture that is the dispatch at EID 12566, and its signature matches the described
technique exactly:

```
ExecutionMode LocalSize(16, 16, 1)                <- 16x16 screen tile
Image<float, 2D>*        set 1, binding 0         <- the lit scene
Image<uint,  2D>*        set 1, binding 1         <- the stencil buffer
StorageImage<float, 2D>* set 1, binding 2         <- output
```

An integer texture bound alongside a colour texture is the tell — that is the stencil
being read as data. Inside, the shader caches both into groupshared arrays with a halo,
then runs a bounded 4-wide loop:

```
uint2 _86  = _85 * {16, 16}          <- tile origin
uint4 _107 = ImageFetch(...)         <- stencil sample
float4 _111 = ImageFetch(...)        <- colour sample
bool _165 = _163 < 4; if(!_165) break;    <- the 4x4 neighbourhood walk
```

Per Larian, it checks a 4×4 stencil neighbourhood to decide whether to blend and to derive
opacity from the ratio of set bits, then samples a 3×3 colour neighbourhood — deliberately
smaller, to avoid shifting the image — collecting foreground and background pixels and
expanding to 4×4 only if it finds none. Foreground pixels blend toward the average
background and vice versa.

The result is a fade that costs no early-Z, needs no per-material shader work, supports
overlapping fading objects, and has no visible dither pattern. The blend is genuinely low
resolution while an object is near-transparent — few pixels pass the stencil test — but
the fade moves fast enough that it isn't noticeable.

This is also a good illustration of why frame captures and developer talks are worth
reading together. The capture alone shows five odd fullscreen draws with escalating
stencil references and an unexplained compute dispatch. The talk alone doesn't tell you
which path ships on Vulkan. Together they explain both the technique and why this backend
takes the slower route.

## Gameplay Surfaces

**Status: VERIFIED (capture) / ATTRIBUTED (technique from Larian's GPC talk)**

BG3 is constantly covered in gameplay surfaces — blood, water, ice, fire, poison — that
spawn in noisy, arbitrary shapes, grow, shrink and overwrite each other. They're deferred
decals, but the shapes come from a gameplay AI grid rather than from artist-placed volumes,
and that makes the usual approaches awkward. Larian
[described the problem](https://www.youtube.com/watch?v=zuDjcoabX7U) as: many small decals
means overdraw, one big masked decal means seams when surfaces grow, and one huge decal
over the whole terrain wastes enormous work on empty space — because a deferred decal has
to sample depth, unproject to world space, convert to grid space and sample the mask
*before* it can discover there's nothing there. Two texture samples to early-out is not
much of an early-out.

Their solution is to **dynamically generate the decal mesh in screen space**: a fixed
shared vertex buffer of screen tiles, with an index buffer generated per surface type by a
compute shader. Tiles containing no surface of that type get all-zero indices, producing
degenerate triangles that never rasterize.

The capture shows this working, and pins down numbers the talk doesn't give.

### The tile grid is 16×16 pixels

Each of the five tile draws issues **86,400 indices — 28,800 triangles**. At 2560×1440:

```
2560 / 16 = 160 tiles across
1440 / 16 =  90 tiles down
160 x 90  = 14,400 tiles
14,400 x 2 triangles = 28,800      <- exactly the draw size
```

And the generating compute shader at EID 4382 is `LocalSize(16, 16, 1)` — one thread per
pixel of one tile, matching "for every pixel in a tile: check which surface is there".

### One buffer, five regions

All five draws bind the **same vertex buffer** and the **same index buffer**, and select
their slice with `firstIndex`:

| EID | numIndices | firstIndex |
|---|---|---|
| 4514 | 86,400 | 0 |
| 4516 | 86,400 | 86,400 |
| 4521 | 86,400 | 172,800 |
| 4526 | 86,400 | 259,200 |
| 4531 | 86,400 | 345,600 |

So "an index buffer per surface type" is, concretely, one compute-generated buffer with a
contiguous per-type region — 432,000 indices for the five surface types active in this
frame. Every draw always covers the full tile grid; the culling happens entirely through
degenerate triangles.

### The depth test really is gone

Larian's slide claims the technique means "no typical decal depth/stencil test anymore."
The capture confirms it, and the contrast with the conventional decals in the same pass
makes it unambiguous:

| | Box decal (4396) | Tile draw (4514) |
|---|---|---|
| depth test | **enabled** | **disabled** |
| depth write | disabled | disabled |
| index count | 36 (a cube) | 86,400 |
| vertex buffer | per-decal | shared |

Because a tile only exists where its surface is actually visible, occlusion has already
been resolved at index-generation time.

One caveat the talk doesn't cover: the tile draws *do* still have a stencil test enabled —
`GREATER_OR_EQUAL`, reference and mask both **64**, keeping on pass and fail. That is a
different bit from the ones the fading system uses (16 and 32), and it isn't a depth-derived
decal bound, so it's most likely a receiver mask marking which pixels can accept surfaces.

> INFERRED: I have not traced what writes stencil bit 64, so the receiver-mask reading is
> unconfirmed.

### Forty surface types

The generating shader declares three descriptor arrays of fixed size **40**:

```
UniformConstant Image<float, 2D>[40]* _15 : [[DescriptorSet(1), Binding(6)]];
UniformConstant Image<float, 2D>[40]* _16 : [[DescriptorSet(1), Binding(7)]];
UniformConstant Image<float, 2D>[40]* _17 : [[DescriptorSet(1), Binding(8)]];
```

Forty possible surface types with three texture maps each — of which five were present in
this frame. Note these are **fixed-size** arrays, not unbounded ones; more on that
distinction below.

## Three Captures

**Status: VERIFIED**

A single frame cannot tell you which of its properties are architectural and which are
coincidences of one scene. So there are three captures, chosen to be as different as
possible:

- **Ravaged Beach** — open sand, one character, distant vistas
- **Emerald Grove** — dense foliage, water, a four-person party
- **Goblin Camp cinematic** — dialogue close-up, three characters, no HUD

![The Grove capture](/img/blog/bg3/00-final-frame-grove.png)
*Emerald Grove, Sacred Pool.*

![The cinematic capture](/img/blog/bg3/00-final-frame-cinematic.png)
*Goblin Camp, mid-dialogue. Skin, fur, hair, cloth and metal at close range.*

The scene-dependent numbers move a great deal:

| | Beach | Grove | Cinematic |
|---|---|---|---|
| Draw calls | 2,601 | **3,723** | **1,939** |
| Total dispatches | 78 | 139 | **141** |
| Skinning dispatches | 48 | 110 | ~127 |
| Visible geometry | 2.62M tris | 4.65M tris | 1.04M tris |

The cinematic has the **fewest draws but the most dispatches** — a tight shot containing
little geometry but three heavily animated characters.

The structural numbers do not move at all:

| | Beach | Grove | Cinematic |
|---|---|---|---|
| Resolution | 2560×1440 | 2560×1440 | 2560×1440 |
| G-buffer attachments | 6 | 6 | 6 |
| Fill Stencil draws | 5, refs 1/2/4/8/16 | identical | identical |
| Lighting shader variations | 14 | 14 | 14 |
| Lighting / post blocks | 21 / 3 | 21 / 3 | 21 / 3 |
| Terrain patch | 49,152 indices | **49,152** | **49,152** |

The terrain figure is the one I'd point at. Three completely different landscapes,
different patch counts, different instance counts per draw — and the index count per patch
is identical to the byte, because the patch mesh is a fixed template and only the
heightfield changes. Likewise the Fill Stencil pass runs its five draws in all three,
including scenes where nothing is fading, confirming the Vulkan fallback is paid
unconditionally every frame.

### The cinematics system shows up as shadow maps

The cinematic capture opens with **eight small 2048² depth-only passes** before the
Z-prepass. The other two captures have exactly one. The triangle counts among those eight
repeat — 69,851 appears twice, 345,039 twice — meaning the *same character geometry* is
being rendered into several shadow maps from different positions.

That is a dedicated character lighting rig: extra lights attached to the characters for a
dialogue shot, each casting its own shadow. Larian have described using separate light
channels for characters versus environment for exactly this reason. It's also the clearest
cost of the cinematics system visible in a capture — eight extra shadow renders before the
frame proper begins.

### One tile short

The tile classifier gave the sharpest cross-capture result. Fourteen indirect dispatches in
all three. The group counts sum to:

| Capture | Sum | Screen tiles |
|---|---|---|
| Beach | **57,600** | 57,600 |
| Grove | **57,599** | 57,600 |
| Cinematic | **57,600** | 57,600 |

Two frames partition the screen exactly. The Grove is **one tile short** — and since the
other two are perfect, it isn't a systematic property of the technique but something about
that scene. A single tile needing more shading models than any of the fourteen combinations
covers would explain it, as would one needing none at all. It is far too precise to be
noise.

The distribution shifts hard with content. On the beach one variation covered 95.7% of the
screen; in the Grove 84.7%; in the cinematic 81.2% with a much longer tail — exactly what
you would expect as sand and rock give way to foliage, water, and then skin, fur, hair,
cloth and metal.

> TODO: identify the Grove's missing tile.

## A DirectX 11 Renderer Speaking Vulkan

**Status: VERIFIED (capture findings) / ATTRIBUTED (Larian statements)**

Taken one at a time, several findings in this frame look like odd omissions for a 2023
AAA renderer. Taken together — and read alongside what Larian have said publicly — they
resolve into a single coherent cause.

The key external fact: **Baldur's Gate 3 ships two backends, Vulkan and DirectX 11.**
Larian's Senior Graphics Programmer Wannes Vanderstappen has explained why. Vulkan
arrived because *"Baldur's Gate was shipped in early access on PC and Google Stadia,
which needed Vulcan"*, and DirectX 11 could not be dropped because *"the engine code
team only moved to BG3 after pre-production happened because we were still working on
the Definitive Edition of Original Sin 2"* ([80.lv](https://80.lv/articles/baldur-s-gate-3-dev-explained-why-it-supports-two-apis)).

So: Vulkan was added to a DirectX 11-era engine, under deadline pressure, by a team that
arrived after pre-production. If the renderer must keep working on DX11, a large set of
Vulkan-only techniques are off the table — not through ignorance, but because they'd
require maintaining a second, divergent rendering path.

Everything below is what that constraint looks like from inside a frame capture.

### It targets Vulkan 1.1 — on purpose

From the capture's `vkCreateInstance` chunk:

```
AppName       = Baldur's Gate 3
EngineName    = The Divinity Engine
APIVersion    = VK_MAKE_VERSION(1, 1, 0)
```

The physical devices in this machine report `1.4.341` and `1.4.323`. Those are two
different numbers that are easy to conflate: `VkApplicationInfo.apiVersion` is what the
*application* asks for, `VkPhysicalDeviceProperties.apiVersion` is what the *driver*
supports. BG3 sits on a 1.1 baseline and buys modern features à la carte through
**17 device extensions** rather than requiring 1.2 or 1.3 core:

```
VK_EXT_descriptor_indexing      VK_KHR_timeline_semaphore
VK_KHR_synchronization2         VK_EXT_buffer_device_address
VK_KHR_push_descriptor          VK_EXT_mutable_descriptor_type
VK_KHR_shader_float16_int8      VK_EXT_subgroup_size_control
VK_EXT_depth_clip_enable        VK_KHR_shader_integer_dot_product
VK_EXT_memory_budget            VK_EXT_memory_priority
VK_KHR_image_format_list        VK_KHR_driver_properties
VK_EXT_hdr_metadata             VK_KHR_swapchain
VK_EXT_shader_demote_to_helper_invocation
```

### It is not bindless

`VK_EXT_descriptor_indexing` is enabled and the `RuntimeDescriptorArray` capability
token appears in the SPIR-V — which looks like bindless at a glance. It isn't. Across
five shaders (G-buffer, decals, VFX, lighting compute, UI), **every resource is bound
at an explicit fixed set and binding**. Not one unbounded descriptor array.

The surface-tile shader above is the closest thing to an exception, and it proves the
rule: it declares `Image<float, 2D>[40]` — a descriptor **array**, but a *fixed-size*
one. That is an ordinary sized array of forty descriptors, not the unbounded
`RuntimeDescriptorArray` that makes a renderer bindless. Larian use arrays where a
system has a known upper bound; they don't index a global unbounded resource table.

What's actually there is a hand-assigned sparse slot map:

```
set 1: 0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 26, 27, 35, 42
set 0: 0, 1, 2, 4
```

Those deliberate gaps suggest the extension is enabled for
**`descriptorBindingPartiallyBound`** — letting unused slots in a set go unwritten —
rather than for bindless indexing.

And that layout is exactly what a DirectX 11 resource model looks like when it is ported
to Vulkan. DX11 binds resources into *numbered register slots* — `t0..tN` for shader
resources, `b0..bN` for constant buffers — with each slot carrying a fixed engine-wide
meaning. A renderer whose binding abstraction was built for that maps naturally onto
fixed, numbered, gap-riddled Vulkan descriptor bindings. Bindless would have meant
rewriting the resource system for one of two backends.

### Every draw is direct

There are **zero indirect draws** in the frame. All 2601 are `vkCmdDrawIndexed`.
Between consecutive draws:

```
2347 vkCmdBindPipeline
2348 vkCmdBindVertexBuffers
2349 vkCmdBindVertexBuffers
2350 vkCmdBindIndexBuffer
2351 vkCmdBindDescriptorSets
2352 vkCmdBindDescriptorSets
2353 vkCmdDrawIndexed          <- draw 1
2354 vkCmdBindVertexBuffers
2355 vkCmdBindVertexBuffers
2356 vkCmdBindIndexBuffer
2357 vkCmdBindDescriptorSets
2358 vkCmdDrawIndexed          <- draw 2
```

Every draw rebinds its own vertex buffers, index buffer and descriptor sets — roughly
4.7 API calls per draw. Both facts block indirect batching:

- **Per-mesh vertex/index buffers.** An indirect call can vary `firstIndex` and
  `vertexOffset`, but the *bound* buffers are command-buffer state. Batching would
  require every mesh in a shared geometry mega-buffer.
- **Per-draw descriptor sets.** Material data would have to be indexed in-shader by
  `gl_DrawID` instead. Interestingly this part they *could* do — `shaderDrawParameters`
  is core in Vulkan 1.1 — so the shader-side capability exists while the data layout
  doesn't.
- **No `VK_KHR_draw_indirect_count`.** It isn't in the extension list, and
  `drawIndirectCount` is core only from 1.2. So even with indirect draws the GPU
  couldn't decide *how many* to issue, which removes most of the reason to bother.

They clearly know the technique — the tile-classified lighting system above is fully
GPU-driven, with dispatch counts produced on-GPU. Indirect is used where the work is
compute. Geometry submission isn't.

DirectX 11 explains the asymmetry. DX11 has no `DrawIndirectCount` and no descriptor
sets; per-draw binding through `IASetVertexBuffers` and `PSSetShaderResources` *is* its
native model. Building GPU-driven geometry submission would have meant a Vulkan-only
path diverging from the DX11 one. Compute-driven VFX, by contrast, ports fine —
compute shaders and structured buffers are DX11 features.

### And the shaders are HLSL

The SPIR-V generator string is `spiregg` — Google's DXC. Larian author in HLSL and
cross-compile to SPIR-V, which is precisely what you'd expect from an engine whose other
backend is DirectX.

### Putting it together

Each of these reads as a limitation in isolation. Together they're one decision:
**this is a DirectX 11 renderer that also speaks Vulkan.** The 1.1 feature floor, the
numbered slot map, the absence of bindless and indirect draws, and the HLSL toolchain
are all the same constraint viewed from different angles — the cost of shipping one
renderer across two APIs, on a schedule set by a streaming platform that no longer exists.

Worth being clear about what is whose: the capture evidence above is mine, the statements
about Stadia and the engine team's timing are Larian's, and the argument connecting them
is my interpretation, not something Larian has said.

## Conclusion

**Status: TODO**

> TODO: write once the walkthrough is complete.

## Reading Material and References

Capture analysis is my own, performed with RenderDoc 1.45 and `rdc-cli`. External
material, used only where attributed:

- Wannes Vanderstappen, ["The Road to Baldur's Gate 3"](https://www.youtube.com/watch?v=zuDjcoabX7U),
  Graphics Programming Conference 2024 — *abstract consulted; I have not yet worked
  through the talk itself, so nothing here is drawn from its contents.*
- [GPC 2024 archive](https://graphicsprogrammingconference.com/archive/2024/) — talk abstract
- [80.lv — "Larian Studios' Dev Explained Why Baldur's Gate 3 Supports Two APIs"](https://80.lv/articles/baldur-s-gate-3-dev-explained-why-it-supports-two-apis)
