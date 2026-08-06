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
| 5 | DS=Clear | 361–379 | TODO | — | — |
| 6 | Z-prepass | 382–2339 | VERIFIED | `rdc snapshot 2000` → depth 2560×1440, no colour target; `rdc draws --pass` shows tri counts 94120/42014/21005 matching §7 | — |
| 7 | G-buffer | 2344–4351 | PARTIAL | `rdc rt 4351 --target 0..4` all 2560×1440; `rdc stats` → 6 attachments; shader_ps.txt `Output Location(0..4)`; `rdc pick-pixel` → MRT0 B=0/A=1, MRT3 all-zero. **MRT2/MRT4 unresolved** | `07-gbuffer-sheet`, `07-gbuffer-mrt0-normals`, `07-gbuffer-mrt1-albedo` |
| 8 | Decals | 4387–4531 | INFERRED | `rdc rt 4531` still shows normals | — |
| 9 | Mid passes | 4586–4776 | TODO | — | — |
| 10 | Two-attachment pass | 4790–5566 | TODO | `rdc stats` → 132 draws, 529324 tris, 2 attachments | — |
| 11 | Half-res chain | 5574–5632 | INFERRED | `rdc stats` → `Don't Care` 19 draws @ 1280×720, 4 attachments; red buffer at 5590 | — |
| 12 | 5 shadow cascades | 5640–11970 | PARTIAL | `rdc snapshot 6000/7000/8500/10500/11800` → all depth 2048×2048; draws 153/280/375/434/81. Projections not extracted | `12-shadow-cascade` |
| 13 | Shadow mask resolve | 11982–11990 | INFERRED | `rdc rt 11990` red/black mask matching scene shadows | `13-shadow-mask` |
| 14 | Lighting + indirect VFX | 11998–12119 | PARTIAL | `rdc events --type Dispatch` → 7 direct + 14 `DispatchIndirect` (55098/1222/690/511/42/31/6, six zero). Individual dispatches unidentified | — |
| 15 | Lighting composite | 12126–12144 | INFERRED | `rdc rt 12144` first lit image | — |
| 16 | Transparents / VFX | 12168–12550 | INFERRED | `rdc rt 12550` fire/embers present | — |
| 17 | Exposure/bloom/tonemap | 12566–12702 | PARTIAL | `rdc bindings 12576` → 1 RO texture + 2 RW SSBOs (histogram shape). Bloom/tonemap split unconfirmed | `17-post-chain` |
| 18 | Late compute | 12709 | TODO | `rdc bindings 12709` → mixed ps+cs, 2 RO + 1 RW | — |
| 19 | UI atlas | 12835–12916 | INFERRED | Same 8192² target as §3, 12 quad draws | — |
| 20 | HUD | 12921–13412 | INFERRED | 109 draws, `rdc rt 13412` shows HUD | — |
| 21 | Present | 13420–13441 | TODO | — | `00-final-frame` |

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

## Corrections

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
