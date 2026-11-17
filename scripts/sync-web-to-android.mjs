/**
 * 把网页构建产物同步到 Android 壳的 assets 目录。
 *
 * 上游产物带 contenthash，直接整目录替换即可，不需要增量比对。
 */
import { cp, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(root, 'dist')
const targetDir = path.join(root, 'android', 'app', 'src', 'main', 'assets', 'web')

const exists = async (target) => {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

if (!(await exists(distDir))) {
  console.error('未找到 dist/，请先运行 `npm run build`。')
  process.exit(1)
}

// 清空旧产物，避免残留上一版带 contenthash 的文件无限堆积
await rm(targetDir, { recursive: true, force: true })
await cp(distDir, targetDir, { recursive: true })

/** 统计文件数与总大小，便于确认同步结果 */
const walk = async (dir) => {
  let files = 0
  let bytes = 0
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await walk(full)
      files += nested.files
      bytes += nested.bytes
    } else {
      files += 1
      bytes += (await stat(full)).size
    }
  }
  return { files, bytes }
}

const { files, bytes } = await walk(targetDir)
const relative = path.relative(root, targetDir)
console.log(
  `已同步 ${files} 个文件（${(bytes / 1024 / 1024).toFixed(2)} MB）到 ${relative}`
)
