const STORAGE_KEYS = {
  backendList: 'setup/api-list',
  activeUuid: 'setup/active-uuid',
}

const dashboardUrl = chrome.runtime.getURL('index.html')
const setupUrl = `${dashboardUrl}#/setup`

const backendListElement = document.getElementById('backend-list')
const manageBackendsButton = document.getElementById('manage-backends')
const errorMessageElement = document.getElementById('error-message')

let isOpening = false

function readBackendList() {
  const storedValue = localStorage.getItem(STORAGE_KEYS.backendList)

  if (!storedValue) {
    return []
  }

  try {
    const parsedValue = JSON.parse(storedValue)
    return Array.isArray(parsedValue) ? parsedValue : []
  } catch (error) {
    console.error('读取后端列表失败：', error)
    return []
  }
}

function readActiveUuid() {
  return localStorage.getItem(STORAGE_KEYS.activeUuid) || ''
}

function getBackendTitle(backend) {
  const label = String(backend.label || '').trim()

  if (label) {
    return label
  }

  const host = String(backend.host || '').trim()
  const port = String(backend.port || '').trim()

  if (host && port) {
    return `${host}:${port}`
  }

  return host || '未命名后端'
}

function getBackendTypeLabel(backend) {
  switch (backend.type) {
    case 'singbox':
      return 'sing-box'

    case 'clash':
      return 'Mihomo'

    default:
      return backend.type ? String(backend.type) : 'Mihomo'
  }
}

function getBackendAddress(backend) {
  const protocol = String(backend.protocol || 'http').trim()
  const host = String(backend.host || '').trim()
  const port = String(backend.port || '').trim()
  const secondaryPath = String(backend.secondaryPath || '').trim()

  if (!host) {
    return '地址尚未填写'
  }

  const normalizedPath =
    secondaryPath && !secondaryPath.startsWith('/') ? `/${secondaryPath}` : secondaryPath

  return `${protocol}://${host}${port ? `:${port}` : ''}${normalizedPath}`
}

function showError(message) {
  errorMessageElement.textContent = message
  errorMessageElement.classList.remove('hidden')
}

function clearError() {
  errorMessageElement.textContent = ''
  errorMessageElement.classList.add('hidden')
}

function setOpeningState(value) {
  isOpening = value

  backendListElement.querySelectorAll('button').forEach((button) => {
    button.disabled = value
  })

  manageBackendsButton.disabled = value
}

async function findExistingDashboard() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['TAB'],
  })

  return contexts.find((context) => {
    return (
      typeof context.documentUrl === 'string' &&
      context.documentUrl.startsWith(dashboardUrl) &&
      Number.isInteger(context.tabId)
    )
  })
}

async function focusDashboardWindow(context) {
  if (!Number.isInteger(context.windowId)) {
    return
  }

  await chrome.windows.update(context.windowId, {
    focused: true,
  })
}

async function openOrFocusDashboard(options = {}) {
  if (isOpening) {
    return
  }

  clearError()
  setOpeningState(true)

  try {
    const existingDashboard = await findExistingDashboard()
    const requestedUrl = options.url || null

    if (existingDashboard) {
      const updateProperties = {
        active: true,
      }

      if (requestedUrl) {
        updateProperties.url = requestedUrl
      }

      await chrome.tabs.update(existingDashboard.tabId, updateProperties)

      if (requestedUrl && existingDashboard.documentUrl === requestedUrl) {
        await chrome.tabs.reload(existingDashboard.tabId)
      }

      await focusDashboardWindow(existingDashboard)
    } else {
      await chrome.tabs.create({
        url: requestedUrl || dashboardUrl,
        active: true,
      })
    }

    window.close()
  } catch (error) {
    console.error('打开 Zashboard 失败：', error)

    showError(error instanceof Error ? error.message : '无法打开 Zashboard，请重试。')

    setOpeningState(false)
  }
}

async function selectBackend(uuid) {
  const backendList = readBackendList()
  const selectedBackend = backendList.find((backend) => {
    return backend.uuid === uuid
  })

  if (!selectedBackend) {
    showError('找不到这个后端，请重新打开选择窗口。')
    return
  }

  localStorage.setItem(STORAGE_KEYS.activeUuid, selectedBackend.uuid)
  renderBackendList()

  await openOrFocusDashboard({
    url: dashboardUrl,
  })
}

function createBackendElement(backend, activeUuid) {
  const isActive = backend.uuid === activeUuid
  const titleText = getBackendTitle(backend)
  const addressText = getBackendAddress(backend)

  const button = document.createElement('button')
  button.type = 'button'
  button.className =
    'group flex w-full items-center gap-3 border-b border-base-300 bg-transparent px-3.5 py-3 text-left transition-colors last:border-b-0 hover:bg-base-200 focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60'
  button.dataset.uuid = backend.uuid
  button.setAttribute('aria-label', `打开后端：${titleText}`)
  button.setAttribute('aria-current', isActive ? 'true' : 'false')

  if (isActive) {
    button.classList.add('bg-primary/10')
  }

  const content = document.createElement('span')
  content.className = 'min-w-0 flex-1'

  const titleRow = document.createElement('span')
  titleRow.className = 'flex min-w-0 items-center justify-between gap-2'

  const title = document.createElement('span')
  title.className = 'truncate text-sm font-semibold'
  title.textContent = titleText
  title.title = titleText

  const type = document.createElement('span')
  type.className = 'badge badge-primary badge-soft badge-sm shrink-0'
  type.textContent = getBackendTypeLabel(backend)

  const address = document.createElement('span')
  address.className = 'mt-1 block truncate font-mono text-[11px] text-base-content/60'
  address.textContent = addressText
  address.title = addressText

  const arrow = document.createElement('span')
  arrow.className =
    'shrink-0 text-lg leading-none text-base-content/30 transition-transform group-hover:translate-x-0.5 group-hover:text-base-content/60'
  arrow.textContent = '›'
  arrow.setAttribute('aria-hidden', 'true')

  titleRow.append(title, type)
  content.append(titleRow, address)
  button.append(content, arrow)

  button.addEventListener('click', () => {
    selectBackend(backend.uuid).catch((error) => {
      console.error(error)
      showError('切换后端失败，请重试。')
      setOpeningState(false)
    })
  })

  return button
}

function renderEmptyState() {
  const emptyState = document.createElement('div')
  emptyState.className = 'px-5 py-8 text-center'

  const title = document.createElement('strong')
  title.className = 'block text-sm'
  title.textContent = '还没有后端'

  const description = document.createElement('span')
  description.className = 'mt-1 block text-xs text-base-content/60'
  description.textContent = '先进入 Zashboard 添加 Mihomo 或 sing-box 后端。'

  emptyState.append(title, description)
  backendListElement.append(emptyState)
}

function renderBackendList() {
  const backendList = readBackendList()
  const activeUuid = readActiveUuid()

  backendListElement.replaceChildren()

  if (backendList.length === 0) {
    renderEmptyState()
    manageBackendsButton.title = '添加后端'
    manageBackendsButton.setAttribute('aria-label', '添加后端')
    return
  }

  backendList.forEach((backend) => {
    backendListElement.append(createBackendElement(backend, activeUuid))
  })

  manageBackendsButton.title = '管理后端'
  manageBackendsButton.setAttribute('aria-label', '管理后端')
}

manageBackendsButton.addEventListener('click', () => {
  openOrFocusDashboard({
    url: setupUrl,
  }).catch((error) => {
    console.error(error)
    showError('无法打开后端管理页面。')
    setOpeningState(false)
  })
})

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEYS.backendList || event.key === STORAGE_KEYS.activeUuid) {
    renderBackendList()
  }
})

renderBackendList()
