import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: false })

/** Render a rules markdown file to HTML. */
export function renderMd(src: string): string {
  return marked.parse(src, { async: false }) as string
}
