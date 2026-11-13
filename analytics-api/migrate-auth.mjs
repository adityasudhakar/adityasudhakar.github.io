import { execFileSync } from "node:child_process";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
});
try {
  await pool.query("CREATE SCHEMA IF NOT EXISTS auth");
} finally {
  await pool.end();
}

execFileSync("./node_modules/.bin/auth", ["migrate", "--config", "./auth.mjs", "--yes"], {
  stdio: "inherit",
  env: process.env
});
