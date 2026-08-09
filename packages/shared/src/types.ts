import type { SlideLayout, Zone, ModuleType } from './block-types.js'
import type { Mutation } from './mutations.js'

export interface Deck {
  id: string
  name: string
  slug: string
  themeId: string | null
  metadata: DeckMetadata
  createdBy: string
  createdAt: number
  updatedAt: number
}

export interface DeckMetadata {
  author: string
  date: string
  institution?: string
}

export interface Slide {
  id: string
  deckId: string
  layout: SlideLayout
  order: number
  splitRatio: string
  notes: string | null
  title: string | null
  createdAt: number
  updatedAt: number
  blocks: ContentBlock[]
}

export interface ContentBlock {
  id: string
  slideId: string
  type: ModuleType
  zone: Zone
  data: Record<string, unknown>
  order: number
  stepOrder: number | null
}

export interface Template {
  id: string
  name: string
  layout: SlideLayout
  modules: TemplateModule[]
  thumbnail: string | null
  builtIn: boolean
  createdBy: string | null
}

export interface TemplateModule {
  type: ModuleType
  zone: Zone
  data: Record<string, unknown>
}

export interface Theme {
  id: string
  name: string
  css: string
  fonts: { heading: string; body: string }
  colors: { primary: string; secondary: string; accent: string; bg: string }
  builtIn: boolean
  createdBy: string | null
}

export interface User {
  id: string
  username: string
  status: UserStatus
  role: UserRole
  mustChangePassword: boolean
  approvedAt: number | null
  createdAt: number
  updatedAt: number
}

export type UserStatus = 'pending' | 'active' | 'disabled'
export type UserRole = 'admin' | 'member'

export interface AuthSession {
  id: string
  userId: string
  expiresAt: number
  createdAt: number
}

export interface ChatMessage {
  id: string
  deckId: string
  role: 'user' | 'assistant'
  content: string
  mutations: Mutation[] | null
  provider: string
  createdAt: number
}
