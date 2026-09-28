/**
 * Renders the app icons in public/ from the monogram below: a tricorn over a vintage R (original
 * design, see docs/DECISIONS.md). Run `node scripts/render-icons.mjs` after changing it; it needs
 * a network connection for the R's typeface (IM Fell English SC, Google Fonts).
 */
import { writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const RED = '#9e1b1b'
const GOLD = '#c9a14a'
const CREAM = '#f3e6c8'
const HAT = '#1c1410'

/** The hat and the R, centred on (256, 256) at `scale`. */
function mark(scale) {
  return `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <g transform="translate(256 170)">
      <path d="M-120 22 C-86 -30 -42 -46 0 -30 C42 -46 86 -30 120 22 C86 9 44 12 0 28 C-44 12 -86 9 -120 22 Z" fill="${HAT}" />
      <path d="M-120 22 C-86 9 -44 12 0 28 C44 12 86 9 120 22" fill="none" stroke="${GOLD}" stroke-width="6" stroke-linecap="round" />
    </g>
    <text x="256" y="392" text-anchor="middle" font-family="'IM Fell English SC', Georgia, serif" font-size="240" fill="${CREAM}">R</text>
    <path d="M150 420 h212" stroke="${GOLD}" stroke-width="6" stroke-linecap="round" />
  </g>`
}

/** The framed icon, for home screens and browser tabs. */
const framed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${RED}" />
  <rect x="40" y="40" width="432" height="432" rx="56" fill="none" stroke="${GOLD}" stroke-width="10" />
  <rect x="62" y="62" width="388" height="388" rx="40" fill="none" stroke="${CREAM}" stroke-width="3" />
  ${mark(1)}
</svg>`

/** Android crops a maskable icon to its own shape: no frame, the mark inside the safe circle. */
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${RED}" />
  ${mark(0.8)}
</svg>`

const OUTPUTS = [
  { file: 'public/pwa-512.png', svg: framed, size: 512 },
  { file: 'public/pwa-192.png', svg: framed, size: 192 },
  { file: 'public/apple-touch-icon.png', svg: framed, size: 180 },
  { file: 'public/pwa-512-maskable.png', svg: maskable, size: 512 },
]
const FAVICON_SIZES = [16, 32, 48]

async function render(page, svg, size) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<!doctype html><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IM+Fell+English+SC&display=block">
    <style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`)
  await page.evaluate(() => document.fonts.ready)
  return page.screenshot({ omitBackground: true })
}

/** An .ico holding PNG images, which every current browser reads. */
function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  let offset = header.length
  pngs.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index
    header.writeUInt8(size, entry)
    header.writeUInt8(size, entry + 1)
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  })
  return Buffer.concat([header, ...pngs.map(({ png }) => png)])
}

const browser = await chromium.launch()
const page = await browser.newPage()
for (const { file, svg, size } of OUTPUTS) writeFileSync(file, await render(page, svg, size))
const favicons = []
for (const size of FAVICON_SIZES) favicons.push({ size, png: await render(page, framed, size) })
writeFileSync('public/favicon.ico', ico(favicons))
await browser.close()
