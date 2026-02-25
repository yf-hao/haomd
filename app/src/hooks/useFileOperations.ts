import { useCallback } from 'react'
import { listFolder } from '../modules/files/service'

export type FileOperationsOptions = {
    setStatusMessage: (msg: string) => void
}

export function useFileOperations({ setStatusMessage }: FileOperationsOptions) {
    const normalizeDirPath = (dir: string): string => {
        if (!dir) return dir
        return dir.replace(/\\/g, '/').replace(/[\\/]+$/, '')
    }

    const computeDirFromPath = useCallback((targetPath: string): string => {
        if (!targetPath) return targetPath

        const hasBackslash = targetPath.includes('\\')
        const normalized = targetPath.replace(/[\\/]/g, '/')
        const lastSlash = normalized.lastIndexOf('/')

        if (lastSlash <= 0) {
            return targetPath
        }

        let dir = normalized.slice(0, lastSlash)
        if (hasBackslash) {
            dir = dir.replace(/\//g, '\\')
        }

        return dir
    }, [])

    const generateUniqueMarkdownPath = useCallback(async (baseFolder: string, rawName: string): Promise<string | null> => {
        const trimmed = rawName.trim()
        if (!trimmed) return null

        if (/[\\/]/.test(trimmed)) {
            setStatusMessage('文件名中不能包含路径分隔符')
            return null
        }

        const hasMdExt = /\.md$/i.test(trimmed)
        const baseName = hasMdExt ? trimmed.replace(/\.md$/i, '') : trimmed
        const normalizedFolder = normalizeDirPath(baseFolder)

        const resp = await listFolder(normalizedFolder)
        if (!resp.ok) {
            setStatusMessage(resp.error.message)
            return null
        }

        const usedNames = new Set(resp.data.map((e) => e.name.toLowerCase()))

        let index = 1
        let candidateName = ''
        while (true) {
            candidateName = index === 1 ? `${baseName}.md` : `${baseName}${index}.md`
            if (!usedNames.has(candidateName.toLowerCase())) break
            index += 1
        }

        return `${normalizedFolder}/${candidateName}`
    }, [setStatusMessage])

    const generateUniqueFolderPath = useCallback(async (baseFolder: string, rawName: string): Promise<string | null> => {
        const trimmed = rawName.trim()
        if (!trimmed) return null

        if (/[\\/]/.test(trimmed)) {
            setStatusMessage('文件夹名中不能包含路径分隔符')
            return null
        }

        const normalizedFolder = normalizeDirPath(baseFolder)

        const resp = await listFolder(normalizedFolder)
        if (!resp.ok) {
            setStatusMessage(resp.error.message)
            return null
        }

        const usedNames = new Set(resp.data.map((e) => e.name.toLowerCase()))

        let index = 1
        let candidateName = ''
        while (true) {
            candidateName = index === 1 ? trimmed : `${trimmed} ${index}`
            if (!usedNames.has(candidateName.toLowerCase())) break
            index += 1
        }

        return `${normalizedFolder}/${candidateName}`
    }, [setStatusMessage])

    return {
        normalizeDirPath,
        computeDirFromPath,
        generateUniqueMarkdownPath,
        generateUniqueFolderPath,
    }
}
