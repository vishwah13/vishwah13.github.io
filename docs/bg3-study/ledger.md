# BG3 Frame Analysis — Provenance Ledger

Working document for `src/content/blog/bg3-frame-analysis.md`. **Not published.**

Its job is to stop an early guess hardening into a stated fact over a multi-week
analysis. Every claim in the post should be traceable to a row here.

## Status vocabulary

| Status | Meaning |
|---|---|
| VERIFIED | Backed by a specific rdc-cli query or shader disassembly, cited below |
| PARTIAL | Some claims verified, others not; the post section says which |
| INFERRED | Plausible reading of indirect evidence, labelled as such in the post |
| TODO | Not yet investigated |

## Capture

- File: `C:\Dev\Graphics Study\Baldur's gate 3\RenderDoc\Capture_1_Vulkan_TAA.rdc`
- 2.9 GB on disk, 6.07 GB frame-capture section, RenderDoc 1.45, Vulkan, 2560×1440
- Scene: Act 1 "Ravaged Beach"
- Reopen cost ~28s. Tooling setup documented in that folder's `CLAUDE.md`.

## Pass ledger

| § | Pass | EID | Status | Evidence | Images |
|---|---|---|---|---|---|
| 1 | GPU skinning | 43–137 | VERIFIED | `rdc pipeline 43/61/137` → all COMP_PIPE 1662; `rdc snapshot 43` shader_cs.txt: `LocalSize(64,1,1)`, `float4x3` palette ArrayStride 48, 4×8-bit bone index unpack, weighted matrix sum, stride 20 | — |
| 2 | Shadow map #1 | 148–330 | PARTIAL | `rdc snapshot 200` → depth 2048×2048. Light source unidentified | — |
| 3 | 8192² atlas | 333–340 | INFERRED | `rdc stats` → `vkCmdBeginRenderPass(Load)` 13 draws, 109 tris, RT 8192×8192 | — |
| 4 | Early compute | 347–356 | TODO | — | — |
| 5 | **Fill Stencil (object fading)** | 361–379 | **VERIFIED** | `rdc pipeline 364/368/371/374/377 stencil` → all func AlwaysTrue, pass op Replace; refs 1/2/4/8/16 with matching writeMasks = one draw per bit. Matches GPC talk's documented "separate draw per bit" fallback | — |
| 6 | Z-prepass | 382–2339 | VERIFIED | `rdc snapshot 2000` → depth 2560×1440, no colour target; `rdc draws --pass` shows tri counts 94120/42014/21005 matching §7 | — |
| 7 | G-buffer | 2344–4351 | PARTIAL | `rdc rt 4351 --target 0..4` all 2560×1440; `rdc stats` → 6 attachments; shader_ps.txt `Output Location(0..4)`; `rdc pick-pixel` → MRT0 B=0/A=1, MRT3 all-zero. **MRT2/MRT4 unresolved** | `07-gbuffer-sheet`, `07-gbuffer-mrt0-normals`, `07-gbuffer-mrt1-albedo` |
| 8 | **Decals (two systems)** | 4387–4531 | **VERIFIED** | 45 draws = 40 box decals (`numIndices` 36 = cube, depthTest **on**) + 5 screen-space surface-tile draws (86400 indices each, depthTest **off**, shared VB 2247 + shared IB 746058 at firstIndex 0/86400/172800/259200/345600). 28800 tris = 160×90 tiles ×2 at 16×16 px on 2560×1440 | — |
| 8a | **Surface tile index-gen compute** | 4382 | **VERIFIED** | `rdc snapshot 4382` → `LocalSize(16,16,1)` (one thread per tile pixel); 3× `Image<float,2D>[40]` surface-type arrays; 5 RO + 3 RW SSBOs, one being the generated index buffer | — |
| 9 | Mid passes | 4586–4776 | TODO | — | — |
| 10 | Two-attachment pass | 4790–5566 | TODO | `rdc stats` → 132 draws, 529324 tris, 2 attachments | — |
| 11 | Half-res chain | 5574–5632 | INFERRED | `rdc stats` → `Don't Care` 19 draws @ 1280×720, 4 attachments; red buffer at 5590 | — |
| 12 | 5 shadow cascades | 5640–11970 | PARTIAL | `rdc snapshot 6000/7000/8500/10500/11800` → all depth 2048×2048; draws 153/280/375/434/81. Projections not extracted | `12-shadow-cascade` |
| 13 | Shadow mask resolve | 11982–11990 | INFERRED | `rdc rt 11990` red/black mask matching scene shadows | `13-shadow-mask` |
| 14 | **Tile-classified clustered lighting** | 11998–12119 | **VERIFIED** | 14 `DispatchIndirect` = 14 documented shader variations. Group counts 55098/0/511/0/42/0/0/1222/690/6/31/0/0/0 **sum to 57600 = 320×180 tiles at 8×8 px on 2560×1440**. All lighting dispatches `LocalSize(8,8,1)` = one tile per workgroup. 11998 is `LocalSize(1,1,1)` indirect-args setup; 12004/12009/12016 are `LocalSize(8,8,1)` classification pre-passes. 38 vs 42 bound resources at 12031 vs 12066 confirms distinct variations | — |
| 15 | Lighting composite | 12126–12144 | INFERRED | `rdc rt 12144` first lit image | — |
| 16 | Transparents / VFX | 12168–12550 | INFERRED | `rdc rt 12550` fire/embers present | — |
| 17a | **Fade blending compute** | 12566 | **VERIFIED** | `rdc snapshot 12566` → `LocalSize(16,16,1)`; set1 b0 `Image<float,2D>` (lit scene), b1 `Image<uint,2D>` (stencil), b2 `StorageImage<float,2D>` (out). Body: 16×16 tile origin, groupshared uint + float4 caches with +16 halo, bounded `< 4` neighbourhood loop. Matches GPC "Fade Blending pass: compute during post processing, input lit scene + stencil, 4×4 neighbourhood" | — |
| 17b | Exposure/bloom/tonemap | 12572–12702 | PARTIAL | `rdc bindings 12576` → 1 RO texture + 2 RW SSBOs (histogram shape). 12572 unidentified. Bloom/tonemap split unconfirmed | `17-post-chain` |
| 18 | Late compute | 12709 | TODO | `rdc bindings 12709` → mixed ps+cs, 2 RO + 1 RW | — |
| 19 | UI atlas | 12835–12916 | INFERRED | Same 8192² target as §3, 12 quad draws | — |
| 20 | HUD | 12921–13412 | INFERRED | 109 draws, `rdc rt 13412` shows HUD | — |
| 21 | Present | 13420–13441 | TODO | — | `00-final-frame` |

## Feature: Terrain 2.0 — VERIFIED

| Claim | Evidence |
|---|---|
| Instanced draw, 16384 tris per patch | EID 330/11604/11970 all `numIndices` **49152** with `numInstances` 10/11/14. 49152/3 = 16384 = 64×64×4 |
| 64 m patch, 1 vert/m, extra centre vertex | 64×64 quads × 4 tris per quad reproduces 16384 exactly |
| Per-instance culling | Instance counts vary per view: 10/11/14 in shadow passes, 3/2/10/3/5 in G-buffer (EID 4077/4083/4089/4095/4098) |
| Vertex format is grid coords only | Terrain VS `Input uint2* _3 : [[Location(0)]]` — height sampled from a 244×244 texture in the VS |
| Holes via NaN centre vertex | Terrain VS contains `float4 _209 = Phi({nan,nan,nan,nan}, {nan,nan,nan,nan}, _22);` |
| Keys map at ~2× height resolution | PS textures at EID 4077 include 485×485 and 483×463 against 242×242 / 244×244 height maps |
| Brush texture sets | 12 × 1024×1024 bound at a G-buffer terrain draw. **INFERRED**: consistent with 4 layers × 3 maps, matching the documented 4-layer max — grouping unconfirmed |

## Cross-cutting findings

| Claim | Status | Evidence |
|---|---|---|
| Targets Vulkan 1.1 | VERIFIED | `controller.GetStructuredFile()` chunk 0 `vkCreateInstance/InitParams/APIVersion = VK_MAKE_VERSION(1,1,0)`; AppName "Baldur's Gate 3", EngineName "The Divinity Engine" |
| Device reports 1.4.341 / 1.4.323 | VERIFIED | `vkEnumeratePhysicalDevices/physProps/apiVersion` — driver capability, **not** app target |
| 5 instance + 17 device extensions | VERIFIED | `vkCreateDevice/CreateInfo/ppEnabledExtensionNames` |
| Zero indirect draws | VERIFIED | `rdc events --filter "*Indirect*"` returns only 14 `vkCmdDispatchIndirect` |
| ~4.7 API calls per draw | VERIFIED | Chunk walk over EID 2344–2400: 2× BindVertexBuffers + BindIndexBuffer + BindDescriptorSets per draw |
| **Not bindless** | VERIFIED | Five shaders (2363, 4400, 12105, 12550, 13000) — every resource at explicit fixed `DescriptorSet(n), Binding(m)`; no unbounded array. Sparse slot map set 1: 0,1,2,3,4,7,8,9,10,11,12,13,26,27,35,42 |
| HLSL via DXC | VERIFIED | SPIR-V generator string `spiregg` |

## External sources

**These are a different evidence class from everything above.** The capture tells us what
the frame *does*; these tell us what Larian *says* they did. Both are useful, and they must
never be merged into one undifferentiated pile of "facts". Anything sourced here is
attributed in the post.

| Source | Status | What it gives us |
|---|---|---|
| ["The Road to Baldur's Gate 3"](https://www.youtube.com/watch?v=zuDjcoabX7U), Graphics Programming Conference 2024, Breda | **Title, speaker and abstract VERIFIED. Talk contents NOT REVIEWED — the video has not been watched.** | Wannes Vanderstappen, Senior Graphics Programmer, Larian. Abstract confirms a **deferred renderer**, the fourth iteration of the in-house engine, goals of larger/denser worlds and distant vistas, a new cinematics system, split-screen support, plus surface/cloud rendering and deferred transparency handling |
| [GPC 2024 archive](https://graphicsprogrammingconference.com/archive/2024/) | VERIFIED (fetched) | Talk abstract verbatim |
| [80.lv — why two APIs](https://80.lv/articles/baldur-s-gate-3-dev-explained-why-it-supports-two-apis) | VERIFIED (fetched), quotes Vanderstappen | BG3 ships **Vulkan + DirectX 11**. Vulkan was adopted because *"Baldur's Gate was shipped in early access on PC and Google Stadia, which needed Vulcan"*. DX11 could not be removed because *"The engine code team only moved to BG3 after pre-production happened because we were still working on the Definitive Edition of Original Sin 2"* |
| Digital Foundry PC tech review | **UNAVAILABLE** | Both `digitalfoundry.net` and `eurogamer.net` are unfetchable from this environment. Not consulted. |

### Discrepancy to resolve

The GPC abstract says the engine targets "Vulkan and **DirectX 12**". The 80.lv interview with
the same engineer, PC Gamer's coverage, and the shipping game's own launcher all say
**DirectX 11**. Our capture cannot settle this — it is a Vulkan capture. Treat DX11 as
correct for the shipped PC build and note the abstract's inconsistency rather than
silently picking one.

### Working thesis this unlocks

Larian's own account explains nearly every "why not X" our capture raised. Vulkan was
bolted onto a DX11-era engine under Stadia deadline pressure, by an engine team that
arrived after pre-production. If the renderer must keep working on DirectX 11, then:

| Capture finding | Explained by DX11 parity |
|---|---|
| Vulkan 1.1 floor, no 1.2/1.3 core features | Stadia-era Vulkan; nothing gained by exceeding the DX11 feature set |
| Fixed sparse numbered slot map, not bindless | DX11 binds by numbered register slot (`t0..tN`, `b0..bN`). A DX11-shaped resource abstraction maps onto fixed numbered Vulkan bindings with gaps |
| HLSL compiled via DXC (`spiregg`) | The DX11 backend needs HLSL; the same shaders are cross-compiled to SPIR-V |
| Zero indirect draws; per-draw vertex/index/descriptor binds | DX11 has no `DrawIndirectCount` and no descriptor sets; per-draw binding is its native model. GPU-driven geometry would need a Vulkan-only path |
| Deferred renderer, 5-MRT G-buffer | MRT deferred is comfortably within DX11's feature set — and the GPC abstract independently confirms "deferred renderer" |

This is the strongest candidate for the post's central argument: **BG3's Vulkan renderer
is a DirectX 11-shaped renderer speaking Vulkan.** Note that the thesis is *ours* — it is
an interpretation built on top of both evidence classes, not something Larian stated.

### Talk content reviewed so far

Slide screenshots and transcript excerpts live in
`C:\Dev\Graphics Study\Baldur's gate 3\RenderDoc\youtube Sources\`.

**Reviewing talk segments pays off far better than RenderDoc-only sessions.** Prioritise it
over blind capture spelunking. Every breakthrough so far came from taking a claim in the
talk and finding the arithmetic that proves it in the capture.

### Segments reviewed and verified

| Talk segment | Timestamp | Post section | What it gave us |
|---|---|---|---|
| Tile-based shading classification | ~20:50–21:15 | §14 | Resolved the 14 indirect dispatches; group counts sum to exactly 57600 = the 8×8 tile count. Corrected a wrong "VFX simulation" inference |
| Terrain 2.0 | ~21:15–23:35 | Terrain 2.0 | Explained the three largest draws; 49152 indices = 16384 tris/patch = 64×64×4. Found the NaN hole hack in the shipped shader |
| Fading opaque objects | ~34:30–38:30 | §5, §17a | Turned one TODO pass and one misfiled dispatch into two identified passes. Yielded the `VK_EXT_shader_stencil_export` synthesis |
| Surface decal rendering | ~38:40–41:40 | §8, §8a | Resolved the decal pass completely; yielded the 16×16 tile size, which the talk does not state |

### Segments still to review

| Talk segment | Timestamp | Would likely resolve |
|---|---|---|
| Rest of shading & lighting pipeline | — | §7 MRT2/MRT4 semantics — **the biggest open question** |
| Rest of terrain (transcript cuts off mid-sentence on the keys map) | ~23:35 on | Keys map layer grouping, the 12 × 1024² brush textures |
| Cloud rendering | — | §11 half-res chain |
| Cinematics system | — | §2 shadow map #1, the 48 skinning dispatches |
| Transparency / see-through | — | §16 transparents |
| "some other optimizations" | ~41:35 | §19 late compute |

Note: the "some other optimizations" segment at ~41:35 sits under the talk's *Technical
changes & Optimizations* heading and is **distinct** from tile-based shading
classification, which is under *New and improved rendering features*. The two have been
confused once already.

### New open question from §8

What writes stencil **bit 64**? The surface-tile draws test it with `GREATER_OR_EQUAL`,
ref/mask 64, keep on pass and fail. It is distinct from the fading system's bits 16 and 32.
Reading it as a "surface receiver" mask is currently INFERRED — trace the writer to confirm.

### Original synthesis: why Vulkan takes the slow path on stencil fill

Neither source states this; it comes from combining them.

Larian's slide says they use `SV_StencilRef` "when supported by HW", with a fallback of one
draw per bit. The capture shows the **fallback** running (5 draws, refs 1/2/4/8/16).
Writing an arbitrary stencil reference from a shader on Vulkan requires
**`VK_EXT_shader_stencil_export`**, and that extension is **absent from the 17 enabled
device extensions** verified earlier. So the fast path is unavailable on this backend and
the fallback is forced — five extra fullscreen draws every frame, whether or not anything
is currently fading.

Worth re-checking against a DX11 capture if one is ever taken: D3D11 has no
`SV_StencilRef` either (it arrived in D3D11.3/12), so both shipped backends may be on the
fallback.

## Corrections

**2026-08-07 — the 14 indirect dispatches are lighting, not VFX.** Originally described as
"GPU-driven effects / VFX simulation" on the basis of position in the frame and varying
group counts. They are the per-variation dispatches of the tile-based shading
classification system: 14 dispatches for 14 shader variations, group counts summing to
exactly the 57600 on-screen 8×8 tiles. The "one genuinely GPU-driven system" framing was
right; the subsystem was wrong. Fixed in §14 and in the cross-cutting section.

**2026-08-06 — "BG3 uses bindless" was wrong.** Originally claimed based on the
`RuntimeDescriptorArray` capability token plus `SPV_EXT_descriptor_indexing` appearing
in the G-buffer shader. Inspecting five shaders showed no shader declares an unbounded
descriptor array; the capability token is emitted by DXC regardless of use. The correct
finding is a fixed sparse slot map, likely leaning on
`descriptorBindingPartiallyBound`. Do not reintroduce the bindless claim from older notes.

## Open questions

1. MRT2 / MRT4 semantics. `pick-pixel` values did not reconcile with the exported
   images — resolve by pixel-debugging a G-buffer draw and tracing the output writes.
2. Are the two `float4x3` matrices per object (G-buffer SSBO set 0 binding 12,
   ArrayStride 128) current+previous transform, or world+normal matrix? The scene is
   nearly static, so if they are current/previous they should be *identical* — one
   buffer read settles it.
3. What are the 48 skinning dispatches actually skinning? 48 seems high for the visible
   character count.
4. Contents of the 8192² atlas.
5. Which of the 14 indirect dispatches are lighting vs VFX simulation.

## Housekeeping

- The duplicate `VK_LAYER_RENDERDOC_Capture` registration (`C:\Program Files\RenderDoc`
  and `C:\Dev\renderdoc-py`, both v1.45) should be cleaned before capturing new frames.
  Harmless for replay.
