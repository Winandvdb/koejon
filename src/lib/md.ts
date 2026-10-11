import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: false })

export function renderMd(src: string): string {
  return marked.parse(src, { async: false }) as string
}
