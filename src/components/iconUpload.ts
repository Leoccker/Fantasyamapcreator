import { ICON_PX } from '../core/icons'

const TYPES = /^image\/(png|jpeg|webp|gif)$/
const MAX_FILE = 5_000_000

/**
 * Turns an image file into a small PNG data URL: fitted into ICON_PX x ICON_PX and re-encoded by the canvas,
 * so only pixels are kept (no metadata, no scripts, no outside links). SVG files are refused, not rasterized.
 */
export async function fileToIconSrc(file: File): Promise<string> {
  if (!TYPES.test(file.type)) throw new Error('Use uma imagem PNG, JPG, WebP ou GIF.')
  if (file.size > MAX_FILE) throw new Error('Imagem grande demais (máx. 5 MB).')
  const bmp = await createImageBitmap(file).catch(() => {
    throw new Error('Não foi possível ler a imagem.')
  })
  const k = ICON_PX / Math.max(bmp.width, bmp.height)
  const [w, h] = [bmp.width * k, bmp.height * k]
  const c = document.createElement('canvas')
  c.width = c.height = ICON_PX
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bmp, (ICON_PX - w) / 2, (ICON_PX - h) / 2, w, h)
  bmp.close()
  return c.toDataURL('image/png')
}

/** The file name without its extension, as the icon's name. */
export const iconName = (file: File) => file.name.replace(/\.[^.]*$/, '')
