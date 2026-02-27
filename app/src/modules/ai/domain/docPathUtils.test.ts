import { describe, it, expect } from 'vitest'
import { getDirKeyFromDocPath } from './docPathUtils'

describe('docPathUtils', () => {
    describe('getDirKeyFromDocPath', () => {
        it('should return undefined for empty or null path', () => {
            expect(getDirKeyFromDocPath(null)).toBeUndefined()
            expect(getDirKeyFromDocPath(undefined)).toBeUndefined()
            expect(getDirKeyFromDocPath('')).toBeUndefined()
            expect(getDirKeyFromDocPath('   ')).toBeUndefined()
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
