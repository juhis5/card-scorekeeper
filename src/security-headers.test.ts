// @vitest-environment node
/**
 * Keeps vercel.json's security headers honest: the CSP must allow index.html's inline theme
 * script by its exact hash (editing the script changes the hash and would otherwise break it
 * silently), and the protective headers must stay in place.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

interface HeaderRule {
  source: string
  headers: { key: string; value: string }[]
}

const vercelConfig = JSON.parse(
  readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'),
) as { headers?: HeaderRule[] }
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8')

function header(key: string): string | undefined {
  const rule = vercelConfig.headers?.find((candidate) => candidate.source === '/(.*)')
  return rule?.headers.find((entry) => entry.key.toLowerCase() === key.toLowerCase())?.value
}

function inlineScriptHashes(): string[] {
  const inlineScripts = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
  return inlineScripts.map(
    ([, body]) =>
      `'sha256-${createHash('sha256')
        .update(body ?? '')
        .digest('base64')}'`,
  )
}

describe('security headers in vercel.json', () => {
  it('allows every inline script in index.html by its exact hash, and nothing else inline', () => {
    const csp = header('Content-Security-Policy-Report-Only') ?? ''
    const scriptSrc = csp.split(';').find((directive) => directive.trim().startsWith('script-src'))

    expect(inlineScriptHashes().length).toBeGreaterThan(0)
    for (const hash of inlineScriptHashes()) expect(scriptSrc).toContain(hash)
    expect(scriptSrc).not.toContain("'unsafe-inline'")
  })

  it('forbids framing, MIME sniffing and needless device access', () => {
    expect(header('X-Frame-Options')).toBe('DENY')
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(header('Permissions-Policy')).toContain('microphone=()')
  })
})
