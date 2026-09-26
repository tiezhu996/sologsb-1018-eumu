import type { PersistedPractice, PracticeProject } from './types'

const DB_NAME = 'sologsb-1018-prosody'
const STORE = 'practice'
const KEY = 'current'
const FALLBACK_KEY = 'sologsb-1018-fallback'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function archiveOrphanScores(project: PracticeProject): PracticeProject {
  const groupIds = new Set(project.groups.map((group) => group.id))
  let changed = false
  const attempts = project.attempts.map((attempt) => {
    const orphaned = attempt.scores.filter((score) => !groupIds.has(score.groupId))
    if (!orphaned.length) return attempt
    changed = true
    return {
      ...attempt,
      scores: attempt.scores.filter((score) => groupIds.has(score.groupId)),
      archivedScores: [...(attempt.archivedScores ?? []), ...orphaned]
    }
  })
  return changed ? { ...project, attempts } : project
}

export async function loadPractice(): Promise<PracticeProject | null> {
  let project: PracticeProject | null = null
  try {
    const db = await openDb()
    const value = await new Promise<PersistedPractice | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly')
      const request = transaction.objectStore(STORE).get(KEY)
      request.onsuccess = () => resolve(request.result as PersistedPractice | undefined)
      request.onerror = () => reject(request.error)
    })
    db.close()
    if (value?.project) project = value.project
  } catch {
    const raw = localStorage.getItem(FALLBACK_KEY)
    if (raw) project = JSON.parse(raw) as PracticeProject
  }
  if (!project) return null
  const migrated = archiveOrphanScores(project)
  if (migrated !== project) await savePractice(migrated)
  return migrated
}

export async function savePractice(project: PracticeProject): Promise<'indexeddb' | 'localstorage'> {
  const value: PersistedPractice = { project, version: 1 }
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(value, KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
    return 'indexeddb'
  } catch {
    const fallback = { ...project, attempts: project.attempts.map((attempt) => ({ ...attempt, audioBlob: undefined })) }
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(fallback))
    return 'localstorage'
  }
}

export async function clearPractice(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).delete(KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    db.close()
  } catch {
    // Ignore cleanup errors and clear the fallback below.
  }
  localStorage.removeItem(FALLBACK_KEY)
}
