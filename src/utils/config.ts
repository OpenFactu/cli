import dotenv from 'dotenv';
import fs from 'fs';
import { getEnvPath } from './paths';

/**
 * El CLI se ejecuta en el HOST, pero el DATABASE_URL del .env apunta al
 * hostname interno de Docker ('db'), que solo resuelve dentro de la red de
 * contenedores. Esta función lo reescribe a 127.0.0.1 con el puerto publicado
 * (DB_PORT) para que los comandos de host (setup, migrate, tenant) puedan
 * conectar a la base de datos a través del puerto mapeado.
 */
export function resolveHostDatabaseUrl(databaseUrl: string, dbPort?: string): string {
  try {
    const u = new URL(databaseUrl);
    if (u.hostname === 'db') {
      u.hostname = '127.0.0.1';
      if (dbPort) u.port = dbPort;
      return u.toString();
    }
  } catch {
    // URL no parseable: la devolvemos tal cual y dejamos que falle más arriba.
  }
  return databaseUrl;
}

/**
 * Carga la configuración desde .env del proyecto OpenFactu.
 */
export function loadConfig() {
  const envPath = getEnvPath();
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }

  const rawDatabaseUrl =
    process.env.DATABASE_URL || 'postgresql://openfactu:openfactu_pass@localhost:5432/openfactudb';

  return {
    databaseUrl: resolveHostDatabaseUrl(rawDatabaseUrl, process.env.DB_PORT),
    jwtSecret: process.env.JWT_SECRET || 'super-secret-key',
    serverPort: process.env.SERVER_PORT || '3000',
  };
}
