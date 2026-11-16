import { config as loadEnv } from 'dotenv'
import { fileURLToPath } from 'node:url'

loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true })
if (!process.env.NUXT_APP_SECRET && process.env.NUXT_SESSION_PASSWORD) {
  process.env.NUXT_APP_SECRET = process.env.NUXT_SESSION_PASSWORD
}

export default defineNuxtConfig({
  modules: ['@nuxt/ui', 'nuxt-auth-utils'],

  telemetry: false,
  devtools: { enabled: false },

  css: ['~/assets/css/main.css', 'katex/dist/katex.min.css'],

  colorMode: {
    preference: 'light',
    fallback: 'light'
  },

  devServer: {
    host: '0.0.0.0',
    port: 38471
  },

  runtimeConfig: {
    ownerEmail: process.env.OWNER_EMAIL || '',
    databaseUrl: process.env.DATABASE_URL || '',
    databaseUrlUnpooled: process.env.DATABASE_URL_UNPOOLED || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    exaApiKey: process.env.EXA_API_KEY || '',
    tavilyApiKey: process.env.TAVILY_API_KEY || '',
    llmProvider: process.env.LLM_PROVIDER || '',
    extractionModel: process.env.EXTRACTION_MODEL || 'gemini-3.5-flash-lite',
    verdictModel: process.env.VERDICT_MODEL || 'gemini-3.8-flash',
    embeddingModel: process.env.EMBEDDING_MODEL || 'gemini-embedding-001',
    monthlyBudgetUsd: process.env.MONTHLY_BUDGET_USD || '10',
    devAuthBypass: process.env.DEV_AUTH_BYPASS || '',
    processJobsInline: process.env.PROCESS_JOBS_INLINE || '',
    resendApiKey: process.env.RESEND_API_KEY || '',
    notifyEmailFrom: process.env.NOTIFY_EMAIL_FROM || '',
    appSecret: process.env.NUXT_APP_SECRET || process.env.NUXT_SESSION_PASSWORD || '',
    session: {
      maxAge: 60 * 60 * 24 * 14
    },
    oauth: {
      google: {
        clientId: process.env.NUXT_OAUTH_GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.NUXT_OAUTH_GOOGLE_CLIENT_SECRET || ''
      }
    }
  },

  vite: {
    ssr: {
      noExternal: [/^@kb\//]
    }
  },

  nitro: {
    vercel: {
      functions: {
        maxDuration: 300
      }
    },
    externals: {
      inline: [/^@kb\//]
    }
  },

  compatibilityDate: '2026-06-30'
})
