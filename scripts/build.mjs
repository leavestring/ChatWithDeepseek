/**
 * 跨平台构建入口。
 *
 * 上游 chat-demo 的 build 脚本是 `rm -rf dist && NODE_ENV=production rspack build`，
 * 这两处都是 POSIX shell 语法，在 Windows 的 cmd 下无法执行。
 * 这里改用 Node 完成同样的工作：先清空 dist，再以生产模式调用 rspack。
 */
import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await rm(path.join(root, 'dist'), { recursive: true, force: true })

const child = spawn(
  process.execPath,
  [
    '--no-warnings',
    path.join(root, 'node_modules', '@rspack', 'cli', 'bin', 'rspack.js'),
    'build',
    '-c',
    'rspack.config.ts',
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  }
)

const code = await new Promise((resolve, reject) => {
  child.on('error', reject)
  child.on('close', resolve)
})

process.exit(code ?? 1)
