import { devBypassAllowed } from '../../utils/context'

export default defineEventHandler(() => ({
  devBypass: devBypassAllowed(),
  google: Boolean(process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID)
}))
