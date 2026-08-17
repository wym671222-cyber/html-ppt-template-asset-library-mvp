import { createHash } from 'node:crypto'

const UTF8_FLAG = 0x0800
const STORED_METHOD = 0
const DOS_DATE_1980_01_01 = 0x21
const SAFE_EXPORT_PATH = /^(?:[a-z0-9][a-z0-9._-]*)(?:\/[a-z0-9][a-z0-9._-]*)*$/

export type ArchiveFile = Readonly<{
  relativePath: string
  content: Buffer
}>

export type StoredZipLimits = Readonly<{
  maxEntries?: number
  maxBytes?: number
}>

export function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export function assertSafeExportPath(value: string): void {
  if (!value || value.length > 240 || !SAFE_EXPORT_PATH.test(value) || value.includes('..') || value.includes('\\') || value.includes(':')) {
    throw new Error(`Export file path is not allowlisted: ${value}`)
  }
}

function crc32(content: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of content) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

export function createStoredZip(files: readonly ArchiveFile[], limits: StoredZipLimits = {}): Buffer {
  const maxEntries = limits.maxEntries ?? 202
  const maxBytes = limits.maxBytes ?? 64 * 1024 * 1024
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 65_535 || !Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('Stored ZIP limits are invalid')
  if (files.length < 1 || files.length > maxEntries) throw new Error(`Stored ZIP must contain between 1 and ${maxEntries} controlled files`)
  if (files.reduce((size, file) => size + file.content.byteLength, 0) > maxBytes) throw new Error('Stored ZIP content exceeds its byte limit')
  const names = new Set<string>()
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const file of files) {
    assertSafeExportPath(file.relativePath)
    if (names.has(file.relativePath)) throw new Error(`Export ZIP contains a duplicate path: ${file.relativePath}`)
    names.add(file.relativePath)
    const name = Buffer.from(file.relativePath, 'utf8')
    const content = Buffer.from(file.content)
    const checksum = crc32(content)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(UTF8_FLAG, 6)
    local.writeUInt16LE(STORED_METHOD, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(content.byteLength, 18)
    local.writeUInt32LE(content.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, name, content)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(UTF8_FLAG, 8)
    central.writeUInt16LE(STORED_METHOD, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(content.byteLength, 20)
    central.writeUInt32LE(content.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, name)
    offset += local.byteLength + name.byteLength + content.byteLength
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralDirectory.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...localParts, centralDirectory, end])
}

export function readStoredZip(content: Buffer, limits: StoredZipLimits = {}): Map<string, Buffer> {
  const maxEntries = limits.maxEntries ?? 202
  const maxBytes = limits.maxBytes ?? 64 * 1024 * 1024
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 65_535 || !Number.isInteger(maxBytes) || maxBytes < 1) throw new Error('Stored ZIP limits are invalid')
  if (content.byteLength < 22 || content.byteLength > maxBytes) throw new Error('Stored ZIP size is invalid')
  const files = new Map<string, Buffer>()
  const localOffsets = new Map<string, number>()
  let offset = 0
  while (offset + 4 <= content.byteLength && content.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > content.byteLength) throw new Error('Export ZIP local header is truncated')
    const flags = content.readUInt16LE(offset + 6)
    const method = content.readUInt16LE(offset + 8)
    const expectedCrc = content.readUInt32LE(offset + 14)
    const compressedSize = content.readUInt32LE(offset + 18)
    const size = content.readUInt32LE(offset + 22)
    const nameLength = content.readUInt16LE(offset + 26)
    const extraLength = content.readUInt16LE(offset + 28)
    if (flags !== UTF8_FLAG || method !== STORED_METHOD || compressedSize !== size || extraLength !== 0) throw new Error('Export ZIP uses an unsupported entry encoding')
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength
    const dataEnd = dataStart + size
    if (dataEnd > content.byteLength) throw new Error('Export ZIP entry is truncated')
    const relativePath = content.subarray(nameStart, dataStart).toString('utf8')
    assertSafeExportPath(relativePath)
    if (files.has(relativePath)) throw new Error(`Export ZIP contains a duplicate path: ${relativePath}`)
    if (files.size >= maxEntries) throw new Error('Stored ZIP contains too many files')
    const bytes = Buffer.from(content.subarray(dataStart, dataEnd))
    if (crc32(bytes) !== expectedCrc) throw new Error(`Export ZIP CRC mismatch: ${relativePath}`)
    files.set(relativePath, bytes)
    localOffsets.set(relativePath, offset)
    offset = dataEnd
  }
  if (files.size < 1 || offset + 4 > content.byteLength || content.readUInt32LE(offset) !== 0x02014b50) throw new Error('Export ZIP central directory is missing')
  const centralOffset = offset
  const endOffset = content.byteLength - 22
  if (endOffset < offset || content.readUInt32LE(endOffset) !== 0x06054b50 || content.readUInt16LE(endOffset + 20) !== 0) throw new Error('Export ZIP end record is invalid')
  const centralNames = new Set<string>()
  while (offset < endOffset) {
    if (offset + 46 > endOffset || content.readUInt32LE(offset) !== 0x02014b50) throw new Error('Export ZIP central entry is invalid')
    const flags = content.readUInt16LE(offset + 8)
    const method = content.readUInt16LE(offset + 10)
    const checksum = content.readUInt32LE(offset + 16)
    const size = content.readUInt32LE(offset + 24)
    const nameLength = content.readUInt16LE(offset + 28)
    const extraLength = content.readUInt16LE(offset + 30)
    const commentLength = content.readUInt16LE(offset + 32)
    const localOffset = content.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const next = nameStart + nameLength + extraLength + commentLength
    if (flags !== UTF8_FLAG || method !== STORED_METHOD || extraLength !== 0 || commentLength !== 0 || next > endOffset) throw new Error('Export ZIP central entry encoding is invalid')
    const relativePath = content.subarray(nameStart, nameStart + nameLength).toString('utf8')
    assertSafeExportPath(relativePath)
    const bytes = files.get(relativePath)
    if (!bytes || centralNames.has(relativePath) || localOffsets.get(relativePath) !== localOffset || bytes.byteLength !== size || crc32(bytes) !== checksum) throw new Error('Export ZIP central entry does not match its local file')
    centralNames.add(relativePath)
    offset = next
  }
  if (centralNames.size !== files.size || content.readUInt16LE(endOffset + 8) !== files.size || content.readUInt16LE(endOffset + 10) !== files.size || content.readUInt32LE(endOffset + 12) !== endOffset - centralOffset || content.readUInt32LE(endOffset + 16) !== centralOffset) {
    throw new Error('Export ZIP entry count is inconsistent')
  }
  return files
}
