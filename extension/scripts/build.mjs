import { spawnSync } from 'node:child_process'
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/postcss'
import postcss from 'postcss'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(scriptDirectory, '../..')
const extensionDirectory = path.resolve(rootDirectory, 'extension')
const distDirectory = path.resolve(rootDirectory, 'dist')
const outputDirectory = path.resolve(
  rootDirectory,
  'artifacts/chrome-extension',
)

function runBuild() {
  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

  const result = spawnSync(command, ['run', 'build'], {
    cwd: rootDirectory,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      FONT: 'none',
    },
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function isUnusedWebAsset(fileName) {
  return (
    fileName === 'manifest.webmanifest' ||
    fileName === 'registerSW.js' ||
    fileName === 'sw.js' ||
    fileName === 'apple-touch-icon.png' ||
    fileName === 'favicon.ico' ||
    fileName === 'favicon.svg' ||
    fileName === 'favicon-dark.svg' ||
    fileName === 'icon.svg' ||
    /^pwa(?:-maskable)?-\d+x\d+\.png$/i.test(fileName) ||
    /^workbox-[a-zA-Z0-9._-]+\.js$/.test(fileName)
  )
}

async function removeUnusedWebAssets(directory) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  })

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      await removeUnusedWebAssets(entryPath)
      continue
    }

    if (isUnusedWebAsset(entry.name)) {
      await unlink(entryPath)
      console.log(`已删除无用网页资源：${entry.name}`)
    }
  }
}

async function processIndexHtml() {
  const indexPath = path.join(outputDirectory, 'index.html')
  let html = await readFile(indexPath, 'utf8')

  html = html.replace(/<link\b[^>]*>/gi, (linkTag) => {
    const normalizedTag = linkTag.toLowerCase()

    if (
      /\brel\s*=\s*["'][^"']*\bmanifest\b[^"']*["']/.test(
        normalizedTag,
      ) ||
      /\brel\s*=\s*["'][^"']*\bicon\b[^"']*["']/.test(
        normalizedTag,
      )
    ) {
      return ''
    }

    return linkTag
  })

  html = html.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (fullScript, attributes, body) => {
      const scriptText = `${attributes} ${body}`.toLowerCase()

      if (
        scriptText.includes('registersw') ||
        scriptText.includes('serviceworker') ||
        scriptText.includes('vite-plugin-pwa') ||
        scriptText.includes('workbox')
      ) {
        return ''
      }

      const hasSource = /\bsrc\s*=/.test(attributes)
      const isFaviconScript =
        !hasSource &&
        body.includes('matchMedia') &&
        body.includes('favicon')

      return isFaviconScript ? '' : fullScript
    },
  )

  const inlineScripts = [
    ...html.matchAll(
      /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].filter((match) => match[1].trim())

  if (inlineScripts.length > 0) {
    throw new Error(
      `发现 ${inlineScripts.length} 个未处理的内联脚本，请检查 dist/index.html`,
    )
  }

  await writeFile(indexPath, html, 'utf8')
}

async function createManifest() {
  const packageJson = JSON.parse(
    await readFile(path.join(rootDirectory, 'package.json'), 'utf8'),
  )

  const manifest = JSON.parse(
    await readFile(
      path.join(extensionDirectory, 'manifest.template.json'),
      'utf8',
    ),
  )

  const versionMatch = String(packageJson.version).match(
    /^\d+(?:\.\d+){0,3}/,
  )

  manifest.version = versionMatch?.[0] ?? '0.0.0'

  await writeFile(
    path.join(outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
}

async function copyExtensionIcon() {
  const iconsDirectory = path.join(outputDirectory, 'icons')

  await mkdir(iconsDirectory, {
    recursive: true,
  })

  await cp(
    path.join(rootDirectory, 'public/pwa-192x192.png'),
    path.join(iconsDirectory, 'icon-192.png'),
  )

  console.log('已从上游 public 目录写入插件图标')
}

async function copyExtensionFiles() {
  const extensionFiles = ['popup.html', 'popup.js']

  for (const fileName of extensionFiles) {
    await cp(
      path.join(extensionDirectory, fileName),
      path.join(outputDirectory, fileName),
    )

    console.log(`已写入扩展文件：${fileName}`)
  }
}

async function buildPopupCss() {
  const inputPath = path.join(extensionDirectory, 'popup.tailwind.css')
  const outputPath = path.join(outputDirectory, 'popup.css')
  const source = await readFile(inputPath, 'utf8')

  const result = await postcss([tailwindcss()]).process(source, {
    from: inputPath,
    to: outputPath,
    map: false,
  })

  await writeFile(outputPath, result.css, 'utf8')
  console.log('已生成 popup Tailwind + daisyUI CSS')
}

async function validateOutput() {
  const requiredFiles = [
    'index.html',
    'manifest.json',
    'popup.html',
    'popup.css',
    'popup.js',
    'icons/icon-192.png',
  ]

  for (const fileName of requiredFiles) {
    await access(path.join(outputDirectory, fileName))
  }

  const indexHtml = await readFile(
    path.join(outputDirectory, 'index.html'),
    'utf8',
  )

  if (
    /favicon|apple-touch-icon|manifest\.webmanifest|registerSW|serviceWorker/i.test(
      indexHtml,
    )
  ) {
    throw new Error('index.html 中仍存在 favicon 或 PWA 引用')
  }
}

async function main() {
  process.chdir(rootDirectory)

  console.log('1. 构建原版 Zashboard')
  runBuild()

  console.log('2. 重建 Chrome 扩展目录')
  await rm(outputDirectory, {
    recursive: true,
    force: true,
  })

  await mkdir(path.dirname(outputDirectory), {
    recursive: true,
  })

  await cp(distDirectory, outputDirectory, {
    recursive: true,
  })

  console.log('3. 清理 PWA 与网页图标资源')
  await removeUnusedWebAssets(outputDirectory)

  console.log('4. 处理 Chrome MV3 页面')
  await processIndexHtml()

  console.log('5. 生成 manifest.json')
  await createManifest()

  console.log('6. 写入上游插件图标')
  await copyExtensionIcon()

  console.log('7. 写入 popup 文件')
  await copyExtensionFiles()

  console.log('8. 编译 popup 样式')
  await buildPopupCss()

  console.log('9. 校验扩展产物')
  await validateOutput()

  console.log('')
  console.log('Chrome 扩展构建完成：')
  console.log(outputDirectory)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
