export interface BlogPost {
  slug: string
  title: string
  excerpt: string
  date: string
  tags: string[]
  content: string
  coverImage?: string
}

// Posts are authored as markdown in src/content/blog/*.md and inlined at build time.
const modules = import.meta.glob('../content/blog/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function slugFromPath(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '')
}

/** Minimal frontmatter parser: `key: value` and `key: [a, b, c]`. No YAML dependency. */
function parseFields(block: string): Record<string, string | string[]> {
  const fields: Record<string, string | string[]> = {}

  for (const line of block.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue

    const sep = line.indexOf(':')
    if (sep === -1) continue

    const key = line.slice(0, sep).trim()
    let value = line.slice(sep + 1).trim()

    if (value.startsWith('[') && value.endsWith(']')) {
      fields[key] = value
        .slice(1, -1)
        .split(',')
        .map(item => item.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
      continue
    }

    value = value.replace(/^['"]|['"]$/g, '')
    fields[key] = value
  }

  return fields
}

function toPost(path: string, raw: string): BlogPost {
  const slug = slugFromPath(path)
  const match = raw.match(FRONTMATTER)

  if (!match) {
    throw new Error(`Blog post "${slug}" is missing its --- frontmatter --- block.`)
  }

  const fields = parseFields(match[1])
  const content = raw.slice(match[0].length)

  for (const required of ['title', 'excerpt', 'date'] as const) {
    if (typeof fields[required] !== 'string' || !fields[required]) {
      throw new Error(`Blog post "${slug}" is missing required frontmatter field "${required}".`)
    }
  }

  const coverImage = fields.coverImage

  return {
    slug,
    title: fields.title as string,
    excerpt: fields.excerpt as string,
    date: fields.date as string,
    tags: Array.isArray(fields.tags) ? fields.tags : [],
    content,
    coverImage: typeof coverImage === 'string' && coverImage ? coverImage : undefined
  }
}

export const blogPosts: BlogPost[] = Object.entries(modules)
  .filter(([path]) => !path.endsWith('README.md'))
  .map(([path, raw]) => toPost(path, raw))
  .sort((a, b) => b.date.localeCompare(a.date))
