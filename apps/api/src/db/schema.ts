import { sql } from 'drizzle-orm'
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'

// P02 target schema only. Legacy CUNY tables intentionally remain outside the
// active TypeScript program and are not represented by these migrations.
export const contentObjects = sqliteTable('content_objects', {
  digest: text('digest').primaryKey(),
  mediaType: text('media_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  relativePath: text('relative_path').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const templateAssets = sqliteTable('template_assets', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  category: text('category').notNull().default('uncategorized'),
  status: text('status', { enum: ['active', 'retired'] }).notNull().default('active'),
  currentVersionId: text('current_version_id'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const templateVersions = sqliteTable('template_versions', {
  id: text('id').primaryKey(),
  assetId: text('asset_id').notNull().references(() => templateAssets.id),
  versionNumber: integer('version_number').notNull(),
  contractVersion: text('contract_version').notNull(),
  sourceDigest: text('source_digest').notNull(),
  contentObjectDigest: text('content_object_digest'),
  slotSchema: text('slot_schema', { mode: 'json' }).notNull(),
  status: text('status', { enum: ['draft', 'verified', 'available', 'unavailable'] }).notNull().default('draft'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [uniqueIndex('template_versions_asset_version_unique').on(table.assetId, table.versionNumber)])

export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  label: text('label').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const templateAssetTags = sqliteTable('template_asset_tags', {
  assetId: text('asset_id').notNull().references(() => templateAssets.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
}, (table) => [uniqueIndex('template_asset_tags_unique').on(table.assetId, table.tagId)])

export const presentations = sqliteTable('presentations', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().references((): AnySQLiteColumn => users.id),
  name: text('name').notNull(),
  status: text('status', { enum: ['draft', 'archived'] }).notNull().default('draft'),
  revision: integer('revision').notNull().default(0),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [index('presentations_owner_updated_idx').on(table.ownerUserId, table.updatedAt, table.id)])

export const presentationItems = sqliteTable('presentation_items', {
  id: text('id').primaryKey(),
  presentationId: text('presentation_id').notNull().references(() => presentations.id, { onDelete: 'cascade' }),
  templateVersionId: text('template_version_id').notNull().references(() => templateVersions.id),
  position: integer('position').notNull(),
  slotOverrides: text('slot_overrides', { mode: 'json' }).notNull().default('{}'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [uniqueIndex('presentation_items_position_unique').on(table.presentationId, table.position)])

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  status: text('status', { enum: ['pending', 'running', 'succeeded', 'failed'] }).notNull().default('pending'),
  inputSnapshot: text('input_snapshot', { mode: 'json' }).notNull(),
  inputRevision: integer('input_revision').notNull(),
  attempt: integer('attempt').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  diagnostic: text('diagnostic').notNull().default(''),
  outputDigest: text('output_digest').references(() => contentObjects.digest),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
})

export const templatePreviewDerivatives = sqliteTable('template_preview_derivatives', {
  templateVersionId: text('template_version_id').notNull().references(() => templateVersions.id),
  kind: text('kind', { enum: ['preview', 'thumbnail'] }).notNull(),
  sourceDigest: text('source_digest').notNull().references(() => contentObjects.digest),
  contentDigest: text('content_digest').notNull().references(() => contentObjects.digest),
  rendererVersion: text('renderer_version').notNull(),
  securityDiagnostic: text('security_diagnostic', { mode: 'json' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.templateVersionId, table.kind, table.sourceDigest, table.rendererVersion] }),
])

export const presentationExports = sqliteTable('presentation_exports', {
  id: text('id').primaryKey(),
  presentationId: text('presentation_id').notNull().references(() => presentations.id),
  presentationRevision: integer('presentation_revision').notNull(),
  manifestDigest: text('manifest_digest').notNull().references(() => contentObjects.digest),
  htmlDigest: text('html_digest').notNull().references(() => contentObjects.digest),
  zipDigest: text('zip_digest').notNull().references(() => contentObjects.digest),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [uniqueIndex('presentation_exports_revision_unique').on(table.presentationId, table.presentationRevision)])

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  result: text('result', { enum: ['success', 'failure'] }).notNull(),
  diagnostic: text('diagnostic').notNull().default(''),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull().default('member'),
  status: text('status', { enum: ['pending', 'active', 'disabled'] }).notNull().default('pending'),
  mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
  approvedBy: text('approved_by').references((): AnySQLiteColumn => users.id),
  approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
  passwordChangedAt: integer('password_changed_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (table) => [
  uniqueIndex('users_username_nocase_unique').on(sql`${table.username} COLLATE NOCASE`),
  uniqueIndex('users_single_admin_unique').on(table.role).where(sql`${table.role} = 'admin'`),
])

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
})

export const authThrottle = sqliteTable('auth_throttle', {
  keyHash: text('key_hash').primaryKey(),
  windowStartedAt: integer('window_started_at', { mode: 'timestamp_ms' }).notNull(),
  count: integer('count').notNull(),
  blockedUntil: integer('blocked_until', { mode: 'timestamp_ms' }),
})
