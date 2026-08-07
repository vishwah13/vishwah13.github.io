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

The capture is a 2.9 GB `.rdc` (6.07 GB of frame-capture section) taken with
RenderDoc 1.45. Everything below was pulled with `rdc-cli` driving a source-built
RenderDoc 1.45 Python module — matching the capture's serialise version was necessary,
since an earlier 1.41 build refused the file outright ("Vulkan capture is incompatible
version 32, newest supported by this build is 23").

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

## 1. GPU skinning prepass — EID 43–137

**Status: VERIFIED**

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
the Z-prepass, the G-buffer, and six shadow maps. Skinning in the vertex shader would
re-blend every skinned vertex eight times per frame — and the six shadow passes would
each pay for it while only needing depth. Doing it once up front eliminates seven
redundant evaluations.

## 2. Shadow map #1 — EID 148–330

**Status: PARTIAL**

37 draws, 712K triangles, into a 2048×2048 depth-only target. The dimensions are
confirmed; which light it belongs to is not.

> TODO: identify the light source and compare its projection to the five cascades.

## 3. The 8192² atlas — EID 333–340

**Status: INFERRED**

One draw into an **8192×8192** target, with twelve more arriving late in the frame
(EID 12835–12916) totalling 109 triangles across 13 draws. Quad-sized geometry into a
very large atlas, immediately before the HUD pass.

> TODO: confirm contents. Position and geometry suggest a glyph or UI atlas, but this
> has not been verified.

## 4. Early compute — EID 347–356

**Status: TODO**

> TODO: not yet investigated.

## 5. Fill Stencil pass — EID 361–379

**Status: VERIFIED**

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
interesting of the two ways Larian implemented it. See the dedicated section below.

## 6. Z-prepass — EID 382–2339

**Status: VERIFIED**

393 draws, 2.62M triangles, writing depth only at 2560×1440 — no colour attachment.

The giveaway that this is a prepass rather than a shadow render is that the *next*
pass draws the same geometry: triangle counts 94120, 42014 and 21005 appear in both,
in the same order. BG3 lays down depth first, then shades.

## 7. G-buffer — EID 2344–4351

**Status: PARTIAL**

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
*All five colour targets at the end of the G-buffer pass.*

| Target | Contents | Confidence |
|---|---|---|
| MRT0 | Encoded normals, 2-channel | VERIFIED — B is exactly 0.0 and A exactly 1.0 at every sampled pixel; only R and G vary, which is why it renders yellow-green |
| MRT1 | Albedo, with data in alpha | VERIFIED as albedo; alpha varies (1.0 sand, 0.62 rock, 0.94 character) but its meaning is unconfirmed |
| MRT2 | Packed material data | INFERRED — G sits pinned at 0.498 (=127/255) across every sample |
| MRT3 | Motion vectors | VERIFIED as all-zero, consistent with a static camera; the buffer's existence is what feeds TAA |
| MRT4 | Packed material data | INFERRED |

> TODO: pixel-debug a G-buffer draw and trace the writes to resolve MRT2 and MRT4.

![G-buffer normals](/img/blog/bg3/07-gbuffer-mrt0-normals.png)
*MRT0 — two-channel encoded normals. The green-yellow cast is the empty blue channel.*

![G-buffer albedo](/img/blog/bg3/07-gbuffer-mrt1-albedo.png)
*MRT1 — albedo, unlit.*

## 8. Decals — EID 4387–4531

**Status: INFERRED**

45 draws that re-write the normal buffer after the G-buffer is complete.

> TODO: confirm these are decals and identify what they project.

## 9. Mid passes — EID 4586–4776

**Status: TODO**

> TODO: not yet investigated.

## 10. Two-attachment geometry pass — EID 4790–5566

**Status: TODO**

132 draws, 529K triangles, 2560×1440, two attachments.

> TODO: not yet investigated.

## 11. Half-resolution chain — EID 5574–5632

**Status: INFERRED**

A series of single-draw fullscreen passes at **1280×720** — exactly half resolution —
with four attachments. One of them produces a full-red single-channel buffer.

> TODO: confirm whether this is ambient occlusion and identify the other stages.

## 12. Five shadow cascades — EID 5640–11970

**Status: PARTIAL**

The largest block of work in the frame: five depth-only passes, every one 2048×2048,
totalling 1323 draws and roughly 9.4M triangles.

![A shadow cascade](/img/blog/bg3/12-shadow-cascade.png)
*One 2048² cascade — an orthographic sun projection across the beach terrain.*

Draw counts climb across the cascades (153, 280, 375, 434, 81), consistent with
progressively larger world-space coverage. The three heaviest draws in the entire
frame — 229376, 180224 and 163840 triangles — are all in these passes, and their
suspiciously round values suggest terrain tiles.

> TODO: extract the cascade projection matrices and confirm the split distances.

## 13. Shadow mask resolve — EID 11982–11990

**Status: INFERRED**

![Screen-space shadow mask](/img/blog/bg3/13-shadow-mask.png)
*Red where lit, black where shadowed — the cascades resolved into screen space.*

> TODO: confirm the resolve shader and how the cascades are selected per pixel.

## 14. Deferred lighting and indirect VFX compute — EID 11998–12119

**Status: PARTIAL**

21 dispatches: 7 direct, then **14 `vkCmdDispatchIndirect`** whose group counts are
produced on the GPU — 55098, 1222, 690, 511, 42, 31, 6, and six dispatching *zero*
groups. This is the one genuinely GPU-driven system in the frame.

> TODO: identify each indirect dispatch and separate the lighting work from the VFX
> simulation.

## 15. Lighting composite — EID 12126–12144

**Status: INFERRED**

The first fully lit image of the frame appears here.

> TODO: not yet investigated in detail.

## 16. Transparents and VFX — EID 12168–12550

**Status: INFERRED**

53 draws. Fire and embers appear in the render target across this range.

> TODO: not yet investigated in detail.

## 17. Auto-exposure, bloom and tonemap — EID 12566–12702

**Status: PARTIAL**

Three dispatches here, and they are not all post-processing:

- **12566** — the **fade blending pass**, identified above. Not exposure or bloom.
- **12572** — reads a texture, writes a storage buffer and a texture. Unidentified.
- **12576** — reads a texture and writes two storage buffers, the shape of a luminance
  histogram reduction for auto-exposure.

Then a chain of single-draw fullscreen passes through the half-resolution targets, ending
in a graded image.

![The post-processing chain](/img/blog/bg3/17-post-chain.png)
*Render targets sampled across the back half of the frame.*

> TODO: confirm the histogram, and separate the bloom mips from the tonemap.

## 18. Late compute — EID 12709

**Status: TODO**

> TODO: not yet investigated.

## 19. UI atlas updates — EID 12835–12916

**Status: INFERRED**

Twelve quad draws into the 8192² target from section 3.

> TODO: confirm contents.

## 20. HUD — EID 12921–13412

**Status: INFERRED**

109 draws composing the hotbar, portrait and minimap.

> TODO: not yet investigated in detail.

## 21. Present — EID 13420–13441

**Status: TODO**

> TODO: not yet investigated.

## Feature study: fading opaque objects without visible dithering

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

## Cross-cutting: a DirectX 11 renderer speaking Vulkan

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

They clearly know the technique — the VFX system is fully GPU-driven with counts
produced on-GPU. Indirect is used exactly where the data is already pooled. Geometry
isn't.

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

## Closing

**Status: TODO**

> TODO: write once the walkthrough is complete.

## Sources

Capture analysis is my own, performed with RenderDoc 1.45 and `rdc-cli`. External
material, used only where attributed:

- Wannes Vanderstappen, ["The Road to Baldur's Gate 3"](https://www.youtube.com/watch?v=zuDjcoabX7U),
  Graphics Programming Conference 2024 — *abstract consulted; I have not yet worked
  through the talk itself, so nothing here is drawn from its contents.*
- [GPC 2024 archive](https://graphicsprogrammingconference.com/archive/2024/) — talk abstract
- [80.lv — "Larian Studios' Dev Explained Why Baldur's Gate 3 Supports Two APIs"](https://80.lv/articles/baldur-s-gate-3-dev-explained-why-it-supports-two-apis)
