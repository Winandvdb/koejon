const pad = (n: number) => String(n).padStart(2, '0')

/** The `.kjn` file of a finished match: the KJN/1 text unchanged, named by local time. */
export function kjnFile(kjn: string, now = new Date()): File {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const name = `koejon-${date}-${pad(now.getHours())}${pad(now.getMinutes())}.kjn`
  return new File([kjn], name, { type: 'text/plain;charset=utf-8' })
}

/** Share sheet where the device can share files (most phones), else a plain download. */
export async function downloadKjn(kjn: string): Promise<void> {
  const file = kjnFile(kjn)
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      // Share refused (no user gesture, policy): fall back to a download.
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  // Revoke after the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
