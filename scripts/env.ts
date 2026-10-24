// Loads .env.local (then .env) for command-line scripts, like `next dev` does for the app.
for (const file of [".env.local", ".env"]) {
  try { process.loadEnvFile(file) } catch { /* missing file is fine */ }
}
