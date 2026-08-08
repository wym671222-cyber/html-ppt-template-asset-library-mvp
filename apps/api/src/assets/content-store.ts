import { createHash, randomUUID } from 'node:crypto'
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { LOCAL_CONTENT_STORE_PATH } from '../db/paths.js'

const SHA256 = /^[0-9a-f]{64}$/

export type StoredContentObject = Readonly<{
  digest: string
  mediaType: string
  byteSize: number
  relativePath: string
}>

function digestBytes(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function assertDigest(digest: string): void {
  if (!SHA256.test(digest)) throw new Error('Content digest must be a lowercase SHA-256 hex value')
}

export class LocalContentStore {
  readonly root: string

  constructor(root = LOCAL_CONTENT_STORE_PATH) {
    this.root = resolve(root)
  }

  relativePathFor(digest: string): string {
    assertDigest(digest)
    return join('sha256', digest.slice(0, 2), digest)
  }

  private pathFor(digest: string): string {
    const path = resolve(this.root, this.relativePathFor(digest))
    if (relative(this.root, path).startsWith('..')) throw new Error('Content path escapes local store')
    return path
  }

  private verifyExisting(digest: string, path: string): void {
    if (lstatSync(path).isSymbolicLink()) throw new Error('Content object must not be a symbolic link')
    if (digestBytes(readFileSync(path)) !== digest) throw new Error(`Content integrity check failed for ${digest}`)
  }

  put(content: Uint8Array, mediaType: string): StoredContentObject {
    if (!mediaType || /[\u0000-\u001f\u007f]/.test(mediaType)) throw new Error('Content media type must be plain text')
    const bytes = Buffer.from(content)
    const digest = digestBytes(bytes)
    const relativePath = this.relativePathFor(digest)
    const destination = this.pathFor(digest)
    mkdirSync(dirname(destination), { recursive: true })
    if (existsSync(destination)) {
      this.verifyExisting(digest, destination)
      return { digest, mediaType, byteSize: bytes.byteLength, relativePath }
    }

    const temporary = join(dirname(destination), `.${digest}.${process.pid}.${randomUUID()}.tmp`)
    try {
      const descriptor = openSync(temporary, 'wx', 0o600)
      try {
        writeFileSync(descriptor, bytes)
        fsyncSync(descriptor)
      } finally {
        closeSync(descriptor)
      }
      try {
        linkSync(temporary, destination)
      } catch (error) {
        if (!existsSync(destination)) throw error
        this.verifyExisting(digest, destination)
      }
      this.verifyExisting(digest, destination)
      return { digest, mediaType, byteSize: bytes.byteLength, relativePath }
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary)
    }
  }

  read(digest: string): Buffer {
    const path = this.pathFor(digest)
    if (!existsSync(path)) throw new Error(`Content object not found: ${digest}`)
    this.verifyExisting(digest, path)
    return readFileSync(path)
  }
}
