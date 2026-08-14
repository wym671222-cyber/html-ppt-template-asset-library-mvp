import { existsSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from '../apps/api/src/app.js'
import { AuthApplicationService } from '../apps/api/src/auth/service.js'
import { AssetCatalogRepository } from '../apps/api/src/assets/catalog-repository.js'
import { AssetLibraryCatalog } from '../apps/api/src/assets/library-catalog.js'
import { LocalContentStore } from '../apps/api/src/assets/content-store.js'
import { migrateDatabase } from '../apps/api/src/db/migrate.js'
import { LocalJobRepository } from '../apps/api/src/jobs/local-jobs.js'
import { TEMPLATE_PREVIEW_JOB_TYPE, TemplatePreviewJobWorker } from '../apps/api/src/previews/preview-jobs.js'
import { PresentationRepository } from '../apps/api/src/presentations/presentation-repository.js'
import { PresentationExportRepository } from '../apps/api/src/presentation-exports/presentation-export-repository.js'
import { LocalRecoveryService } from '../apps/api/src/recovery/local-recovery.js'
import { SecurePreviewRenderer } from '../apps/api/src/previews/secure-preview.js'
import { adaptSimulatedTemplatePackage, adaptTemplatePackageSource } from '../apps/api/src/templates/simulated-adapter.js'
import { TemplateImportService } from '../apps/api/src/templates/template-import.js'
import { seedTestUser } from './p14-test-support.js'

type SQLite = {
  pragma(statement: string): unknown
}

const Database = createRequire(new URL('../apps/api/package.json', import.meta.url))('better-sqlite3') as new (path: string) => SQLite
const chromiumExecutablePath = process.env.P06_CHROMIUM_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function main(): Promise<void> {
  if (!existsSync(chromiumExecutablePath)) throw new Error('P06 E2E requires a local Chromium executable')
  const directory = mkdtempSync(join(tmpdir(), 'asset-library-p06-e2e-'))
  const databasePath = join(directory, 'asset-library.db')
  migrateDatabase(databasePath)
  const database = new Database(databasePath)
  database.pragma('foreign_keys = ON')
  const user = seedTestUser(database as never)
  const auth = new AuthApplicationService(database as never)
  auth.authenticate = () => ({
    user,
    session: { id: 'session-00000000-0000-4000-8000-000000000001', userId: user.id, createdAt: user.createdAt, expiresAt: user.createdAt + 604_800_000 },
  })
  const store = new LocalContentStore(join(directory, 'objects'))
  const fixture = adaptSimulatedTemplatePackage(join(process.cwd(), 'fixtures/p03-simulated-template'))
  const variants = [
    { id: 'simulated-quarterly-brief', title: 'Simulated Quarterly Brief', category: 'report/quarterly', tags: ['brief', 'fixture'] },
    { id: 'fixture-quarterly-review', title: '季度经营复盘', category: '经营管理', tags: ['季度汇报', '管理层'] },
    { id: 'fixture-strategy-roadmap', title: '年度战略规划', category: '战略规划', tags: ['路线图', '年度计划'] },
    { id: 'fixture-project-retro', title: '项目复盘汇报', category: '项目管理', tags: ['项目复盘', '团队'] },
    { id: 'fixture-market-analysis', title: '市场分析报告', category: '市场研究', tags: ['市场分析', '数据'] },
    { id: 'fixture-product-launch', title: '产品发布会', category: '产品营销', tags: ['产品', '发布会'] },
  ].map((variant) => adaptTemplatePackageSource({
    manifest: { ...fixture.source.manifest, id: variant.id, title: variant.title, category: variant.category, tags: variant.tags },
    files: fixture.source.files,
  }))
  const catalogRepository = new AssetCatalogRepository(database as never, store)
  const jobs = new LocalJobRepository(database as never)
  for (const [index, template] of variants.entries()) {
    const registered = catalogRepository.registerTemplate(template)
    jobs.enqueue({
      id: `p06-e2e-preview-${index}`,
      type: TEMPLATE_PREVIEW_JOB_TYPE,
      inputSnapshot: { templateVersionId: template.version.id, contentObjectDigest: registered.contentObject.digest },
      inputRevision: 0,
    })
  }
  const worker = new TemplatePreviewJobWorker(
    database as never,
    jobs,
    store,
    new SecurePreviewRenderer({ chromiumExecutablePath, navigationTimeoutMs: 20_000 }),
    'p06-e2e-worker',
    60_000,
  )
  while (await worker.runOnce()) { /* Render every repository fixture through the production policy. */ }
  if (variants.some((_template, index) => jobs.get(`p06-e2e-preview-${index}`)?.status !== 'succeeded')) throw new Error('P06 E2E fixture preview failed P05 verification')
  let workerBusy = false
  setInterval(() => {
    if (workerBusy) return
    workerBusy = true
    void worker.runOnce().finally(() => { workerBusy = false })
  }, 250).unref()

  const port = Number(process.env.P06_API_PORT ?? 3018)
  const app = createApp({
    catalog: new AssetLibraryCatalog(database as never, store),
    presentations: new PresentationRepository(database as never),
    exports: new PresentationExportRepository(database as never, store),
    recovery: new LocalRecoveryService({
      databasePath,
      contentRoot: store.root,
      backupRoot: join(directory, 'recovery-backups'),
      restoreRoot: join(directory, 'recovery-drills'),
    }),
    templateImports: new TemplateImportService(database as never, catalogRepository, jobs),
    auth,
    allowedOrigins: ['http://127.0.0.1:5175'],
  })
  serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, () => {
    console.log(`P06 fixture API ready at http://127.0.0.1:${port}`)
  })
}

void main()
