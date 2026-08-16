import type { Locator, Page } from '@playwright/test'

const PREVIEW_WIDTH = 1280
const PREVIEW_HEIGHT = 720
const THUMBNAIL_SCALE = 0.25

type ScreenshotClip = Readonly<{ x: number; y: number; width: number; height: number }>

function assertPreviewClip(clip: ScreenshotClip): void {
  const finite = [clip.x, clip.y, clip.width, clip.height].every(Number.isFinite)
  if (!finite || clip.x < 0 || clip.y < 0 || Math.abs(clip.width - PREVIEW_WIDTH) > 0.01 || Math.abs(clip.height - PREVIEW_HEIGHT) > 0.01) {
    throw new Error('Thumbnail source must be one exact 1280x720 preview composition')
  }
}

async function captureScaledClip(page: Page, clip: ScreenshotClip): Promise<Buffer> {
  assertPreviewClip(clip)
  const session = await page.context().newCDPSession(page)
  try {
    const result = await session.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { ...clip, scale: THUMBNAIL_SCALE },
    })
    return Buffer.from(result.data, 'base64')
  } finally {
    await session.detach()
  }
}

export function capturePageThumbnail(page: Page): Promise<Buffer> {
  return captureScaledClip(page, { x: 0, y: 0, width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT })
}

export async function captureElementThumbnail(page: Page, element: Locator): Promise<Buffer> {
  const clip = await element.boundingBox()
  if (!clip) throw new Error('Thumbnail source element is not visible')
  return captureScaledClip(page, clip)
}
