/** Convert FastAPI validation details to readable field errors. Never stringify objects implicitly. */
export function apiErrorMessage(body: unknown, status: number): string {
  const fallback = `Request failed (HTTP ${status}).`
  if (!body || typeof body !== 'object') return fallback
  const detail = (body as { detail?: unknown }).detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    if (detail.some(item => item && typeof item === 'object' && Array.isArray(item.loc) && item.loc.includes('baseline_sample') && item.type === 'missing')) {
      return 'The running backend is outdated and requires a single baseline_sample. Restart the qPCR backend with the current code, then refresh this page. Your imported data is preserved.'
    }
    const messages = detail.map(item => {
      if (typeof item === 'string') return item
      if (!item || typeof item !== 'object') return ''
      const location = Array.isArray(item.loc) ? item.loc.filter((part: unknown) => part !== 'body').join(' → ') : ''
      const message = typeof item.msg === 'string' ? item.msg : 'Invalid value'
      return location ? `${location}: ${message}` : message
    }).filter(Boolean)
    return messages.length ? messages.join('; ') : fallback
  }
  if (detail && typeof detail === 'object') {
    const message = (detail as { message?: unknown }).message
    return typeof message === 'string' ? message : JSON.stringify(detail)
  }
  return fallback
}
