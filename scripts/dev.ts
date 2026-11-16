import { spawn } from 'node:child_process'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env: process.env })
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} 結束碼 ${code}`))
    })
  })
}

await run('pnpm', ['exec', 'tsx', 'scripts/migrate.ts'])
await run('pnpm', ['exec', 'tsx', 'scripts/seed.ts'])

const web = spawn('pnpm', ['--filter', '@kb/web', 'exec', 'nuxt', 'dev', '--host', '0.0.0.0', '--port', '38471'], {
  stdio: 'inherit',
  env: process.env
})

const stop = () => {
  web.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
web.on('exit', (code) => process.exit(code ?? 0))
