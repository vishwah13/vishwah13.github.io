# Blog Content Directory

Posts are markdown files in this directory. Each `.md` file here becomes a post; the
filename becomes the URL slug (`bg3-frame-analysis.md` → `/#/blog/bg3-frame-analysis`).

This `README.md` is skipped by the loader.

## Adding a post

Create `src/content/blog/my-post.md` starting with a frontmatter block:

```markdown
---
title: My Post Title
excerpt: Short description shown on the blog list page.
date: 2026-08-06
tags: [Graphics, Vulkan]
coverImage: /img/blog/my-post/cover.png
---

## First Section

Body content in Markdown.
```

`title`, `excerpt` and `date` are required — a missing one throws at build time rather
than rendering a broken post. `tags` and `coverImage` are optional. Posts are sorted by
`date` descending.

The frontmatter parser is deliberately minimal (see `src/data/BlogData.ts`): it handles
`key: value` and `key: [a, b, c]` only. No YAML dependency, so no nested structures,
multi-line values or comments.

## Supported markup

Standard Markdown via `marked`, plus styling for images, figures, tables, blockquotes
and code blocks. There is **no syntax highlighting** — fenced code renders as plain
preformatted text, which suits shader disassembly and API traces.

An image followed by an italic line renders as an image with a caption:

```markdown
![Alt text](/img/blog/my-post/thing.png)
*Caption text.*
```

Headings (`##`, `###`) automatically get anchor ids, and `##` headings build the table
of contents shown above the post when there is more than one.

## Images

Put images in `public/img/blog/<post-slug>/` and reference them from the site root:
`/img/blog/<post-slug>/name.png`.

Keep them PNG. For the BG3 study this is a deliberate choice — lossy formats introduce
up to ~120/255 error on data buffers like normal and mask targets, which is
indistinguishable from a rendering artifact to a reader. See
`docs/superpowers/specs/2026-08-06-bg3-frame-analysis-blog-design.md`.

Downscale before committing:

```powershell
scripts\resize-blog-image.ps1 -Source path\to\export.png `
                              -Dest public\img\blog\bg3\07-thing.png
```

Defaults to 1600px wide, which suits the ~1080px content column.

## In-progress posts

A post is reachable as soon as its `.md` file exists. To keep a draft off the site,
keep it out of this directory until it is ready — or leave the Blog nav link in
`src/components/Header.vue` commented out while drafting.
