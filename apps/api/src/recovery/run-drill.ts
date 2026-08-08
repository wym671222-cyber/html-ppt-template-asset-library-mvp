import {
  LOCAL_CONTENT_STORE_PATH,
  LOCAL_DATABASE_PATH,
  LOCAL_RECOVERY_BACKUP_PATH,
  LOCAL_RECOVERY_DRILL_PATH,
} from '../db/paths.js'
import { LocalRecoveryService } from './local-recovery.js'

const recovery = new LocalRecoveryService({
  databasePath: LOCAL_DATABASE_PATH,
  contentRoot: LOCAL_CONTENT_STORE_PATH,
  backupRoot: LOCAL_RECOVERY_BACKUP_PATH,
  restoreRoot: LOCAL_RECOVERY_DRILL_PATH,
})

const before = recovery.inspectCurrent()
const backup = await recovery.createBackup(before.stateSha256)
const restore = recovery.restoreBackup(backup.id, backup.manifestSha256)
const after = recovery.inspectCurrent()

if (before.stateSha256 !== after.stateSha256 || before.databaseSha256 !== after.databaseSha256) {
  throw new Error('P09 recovery drill changed the original source state')
}

console.log(JSON.stringify({
  source: {
    stateSha256: before.stateSha256,
    databaseSha256Before: before.databaseSha256,
    databaseSha256After: after.databaseSha256,
  },
  backup,
  restore,
}, null, 2))
