import { describe, it, expect } from 'vitest'
import { getDirKeyFromDocPath, normalizePersistableDocPath } from './docPathUtils'
import { isTransientFilePath } from '../../files/filePathState'

describe('docPathUtils', () => {
    describe('filePathState', () => {
        it('should treat untitled as transient path', () => {
            expect(isTransientFilePath('untitled')).toBe(true)
            expect(isTransientFilePath('  untitled  ')).toBe(true)
            expect(isTransientFilePath('/doc.md')).toBe(false)
        })
    })

    describe('normalizePersistableDocPath', () => {
        it('should return undefined for transient untitled documents', () => {
            expect(normalizePersistableDocPath('untitled')).toBeUndefined()
            expect(normalizePersistableDocPath('  untitled  ')).toBeUndefined()
        })

        it('should normalize real persisted paths', () => {
            expect(normalizePersistableDocPath('C:\\Users\\me\\notes\\todo.md')).toBe('C:/Users/me/notes/todo.md')
            expect(normalizePersistableDocPath('/Users/me/notes/todo.md')).toBe('/Users/me/notes/todo.md')
        })
    })

    describe('getDirKeyFromDocPath', () => {
        it('should return undefined for empty or null path', () => {
            expect(getDirKeyFromDocPath(null)).toBeUndefined()
            expect(getDirKeyFromDocPath(undefined)).toBeUndefined()
            expect(getDirKeyFromDocPath('')).toBeUndefined()
            expect(getDirKeyFromDocPath('   ')).toBeUndefined()
            expect(getDirKeyFromDocPath('untitled')).toBeUndefined()
        })

        it('should return "/" for files in the root directory', () => {
            expect(getDirKeyFromDocPath('/file.md')).toBe('/')
            expect(getDirKeyFromDocPath('file.md')).toBe('/')
        })

        it('should extract directory path correctly for absolute paths', () => {
            expect(getDirKeyFromDocPath('/Users/me/notes/todo.md')).toBe('/Users/me/notes')
            expect(getDirKeyFromDocPath('/a/b/c.md')).toBe('/a/b')
        })

        it('should extract directory path correctly for relative paths', () => {
            expect(getDirKeyFromDocPath('notes/todo.md')).toBe('notes')
            expect(getDirKeyFromDocPath('a/b/c.md')).toBe('a/b')
        })

        it('should normalize backslashes to forward slashes', () => {
            expect(getDirKeyFromDocPath('C:\\Users\\me\\notes\\todo.md')).toBe('C:/Users/me/notes')
        })

        it('should handle paths with trailing slashes gracefully', () => {
            // If it's just a directory path ending in slash, it should return the parent dir
            expect(getDirKeyFromDocPath('/Users/me/notes/')).toBe('/Users/me/notes')
        })
    })
})
