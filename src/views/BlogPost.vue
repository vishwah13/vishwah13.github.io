<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { marked } from 'marked'
import { blogPosts } from '@/data/BlogData'

const route = useRoute()
const router = useRouter()

const post = computed(() => {
  return blogPosts.find(p => p.slug === route.params.slug)
})

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/**
 * Adds ids to h2/h3 after rendering. Done on the HTML rather than through a marked
 * renderer override so it stays independent of marked's renderer API.
 */
function addHeadingIds(html: string): string {
  return html.replace(
    /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g,
    (_match, level: string, attrs: string | undefined, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '')
      return `<h${level}${attrs ?? ''} id="${slugify(text)}">${inner}</h${level}>`
    }
  )
}

const htmlContent = computed(() => {
  if (!post.value) return ''
  return addHeadingIds(marked(post.value.content) as string)
})

interface TocEntry {
  id: string
  text: string
}

const toc = computed<TocEntry[]>(() => {
  if (!post.value) return []
  const entries: TocEntry[] = []
  const heading = /^##\s+(.+)$/gm
  let match: RegExpExecArray | null
  let inFence = false

  for (const line of post.value.content.split(/\r?\n/)) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    heading.lastIndex = 0
    match = heading.exec(line)
    if (match) {
      const text = match[1].trim()
      entries.push({ id: slugify(text), text })
    }
  }

  return entries
})

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}

function goBack() {
  router.push('/blog')
}
</script>

<template>
  <div class="page blog-post">
    <button @click="goBack" class="back-button">
      ← Back to Blog
    </button>

    <div v-if="post" class="post-content">
      <header class="post-header">
        <h1 class="post-title">{{ post.title }}</h1>
        <div class="post-meta">
          <time class="post-date">{{ formatDate(post.date) }}</time>
          <div class="post-tags">
            <span v-for="tag in post.tags" :key="tag" class="tag">
              {{ tag }}
            </span>
          </div>
        </div>
      </header>

      <nav v-if="toc.length > 1" class="post-toc" aria-label="Table of contents">
        <p class="toc-title">Contents</p>
        <ol class="toc-list">
          <li v-for="entry in toc" :key="entry.id">
            <a :href="`#${entry.id}`">{{ entry.text }}</a>
          </li>
        </ol>
      </nav>

      <article class="post-body" v-html="htmlContent"></article>
    </div>

    <div v-else class="not-found">
      <h2>Post not found</h2>
      <p>The blog post you're looking for doesn't exist.</p>
    </div>
  </div>
</template>

<style scoped>
.back-button {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
  margin-bottom: var(--spacing-2xl);
}

.back-button:hover {
  background: var(--color-bg-elevated);
  color: var(--color-text-primary);
}

.post-content {
  max-width: 1080px;
}

.post-toc {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-lg) var(--spacing-xl);
  margin-bottom: var(--spacing-2xl);
}

.toc-title {
  color: var(--color-text-primary);
  font-size: var(--font-size-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: var(--spacing-md);
}

.toc-list {
  margin: 0;
  padding-left: var(--spacing-xl);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.toc-list li {
  margin-bottom: var(--spacing-xs);
}

.toc-list a {
  color: var(--color-text-secondary);
  text-decoration: none;
}

.toc-list a:hover {
  color: var(--color-accent);
  text-decoration: underline;
}

.post-header {
  margin-bottom: var(--spacing-2xl);
}

.post-title {
  margin-bottom: var(--spacing-lg);
}

.post-meta {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
  flex-wrap: wrap;
}

.post-date {
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}

.post-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.tag {
  display: inline-block;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: rgba(139, 92, 246, 0.1);
  border: 1px solid rgba(139, 92, 246, 0.3);
  border-radius: var(--radius-full);
  font-size: var(--font-size-xs);
  color: var(--color-accent);
}

.post-body {
  color: var(--color-text-secondary);
  line-height: var(--line-height-relaxed);
}

/* Markdown content styles */
.post-body :deep(h1),
.post-body :deep(h2),
.post-body :deep(h3) {
  color: var(--color-text-primary);
  margin-top: var(--spacing-2xl);
  margin-bottom: var(--spacing-lg);
}

.post-body :deep(h1) {
  font-size: var(--font-size-3xl);
  background: var(--gradient-text);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.post-body :deep(h2) {
  font-size: var(--font-size-2xl);
}

.post-body :deep(h3) {
  font-size: var(--font-size-xl);
}

.post-body :deep(p) {
  margin-bottom: var(--spacing-lg);
}

.post-body :deep(ul),
.post-body :deep(ol) {
  margin-bottom: var(--spacing-lg);
  padding-left: var(--spacing-xl);
}

.post-body :deep(li) {
  margin-bottom: var(--spacing-sm);
}

.post-body :deep(code) {
  background: var(--glass-bg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
  color: var(--color-accent);
}

.post-body :deep(pre) {
  background: var(--color-bg-secondary);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-lg);
  overflow-x: auto;
  margin-bottom: var(--spacing-lg);
}

.post-body :deep(pre code) {
  background: none;
  padding: 0;
  color: var(--color-text-primary);
}

/* Images: without these, frame captures overflow the column entirely. */
.post-body :deep(img) {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 auto var(--spacing-sm);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  background: var(--color-bg-secondary);
}

/* marked renders `![alt](src)` followed by an *italic* line as <p><img></p><p><em>. */
.post-body :deep(p > img + em),
.post-body :deep(p > em:only-child) {
  display: block;
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  font-style: italic;
  margin-bottom: var(--spacing-xl);
}

.post-body :deep(figure) {
  margin: 0 0 var(--spacing-xl);
}

.post-body :deep(figcaption) {
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  margin-top: var(--spacing-sm);
}

.post-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: var(--spacing-xl);
  font-size: var(--font-size-sm);
  display: block;
  overflow-x: auto;
}

.post-body :deep(th),
.post-body :deep(td) {
  border: 1px solid var(--glass-border);
  padding: var(--spacing-sm) var(--spacing-md);
  text-align: left;
  vertical-align: top;
}

.post-body :deep(th) {
  background: var(--glass-bg);
  color: var(--color-text-primary);
  font-weight: 600;
  white-space: nowrap;
}

.post-body :deep(blockquote) {
  border-left: 3px solid var(--color-accent);
  background: var(--glass-bg);
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  margin: 0 0 var(--spacing-lg);
  color: var(--color-text-muted);
}

.post-body :deep(blockquote p:last-child) {
  margin-bottom: 0;
}

.post-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--glass-border);
  margin: var(--spacing-2xl) 0;
}

.post-body :deep(a) {
  color: var(--color-accent);
  text-decoration: underline;
}

.post-body :deep(a:hover) {
  color: var(--color-accent-hover);
}

.not-found {
  text-align: center;
  padding: var(--spacing-3xl) 0;
}

.not-found h2 {
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-md);
}

.not-found p {
  color: var(--color-text-secondary);
}
</style>
