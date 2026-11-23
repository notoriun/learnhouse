// AI feature icon backed by the brand asset set (feature 005).
// Exported in StaticImageData shape so existing <Image width={n}> usages keep
// deriving the height automatically, exactly like the old static PNG imports.
import type { StaticImageData } from 'next/image'

const aiIcon: StaticImageData = {
  src: '/brand/icon-192.png',
  width: 192,
  height: 192,
}

export default aiIcon
