import { defineConfig } from 'drizzle-kit'
import { LOCAL_DATABASE_URL } from './src/db/paths.js'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: LOCAL_DATABASE_URL,
  },
})
