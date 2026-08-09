export type SessionUser = Readonly<{
  id: string
  username: string
  role: 'admin' | 'member'
  status: 'pending' | 'active' | 'disabled'
  mustChangePassword: boolean
  approvedAt: number | null
  createdAt: number
  updatedAt: number
}>

export type AuthErrorCode =
  | 'ACCOUNT_PENDING'
  | 'ACCOUNT_DISABLED'
  | 'INVALID_CREDENTIALS'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'PASSWORD_POLICY'
  | 'NEW_PASSWORD_REQUIRED'
  | 'RATE_LIMITED'

const MESSAGE: Record<AuthErrorCode, string> = {
  ACCOUNT_PENDING: '账号正在等待管理员审批。',
  ACCOUNT_DISABLED: '账号已被停用，请联系管理员。',
  INVALID_CREDENTIALS: '用户名或密码不正确。',
  PASSWORD_CHANGE_REQUIRED: '请先修改临时密码。',
  PASSWORD_POLICY: '密码须为 10–128 个字符。',
  NEW_PASSWORD_REQUIRED: '新密码不能与当前密码相同。',
  RATE_LIMITED: '尝试次数过多，请稍后再试。',
}

export function authMessage(code: string | undefined): string {
  return MESSAGE[code as AuthErrorCode] ?? '请求未完成，请稍后再试。'
}
