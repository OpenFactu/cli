import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger';
import { getProjectRoot } from '../utils/paths';

function readEnv(envPath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return env;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      env[trimmed.substring(0, eqIdx).trim()] = trimmed.substring(eqIdx + 1).trim();
    }
  }
  return env;
}

function writeEnv(envPath: string, env: Record<string, string>) {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(envPath, lines.join('\n') + '\n');
}

function extractPortsFromCompose(composeContent: string): Record<string, number> {
  const ports: Record<string, number> = {};
  const portRegex = /"([^"]*):(\d+)"|-\s*"(\d+):(\d+)"/g;
  let match;

  while ((match = portRegex.exec(composeContent)) !== null) {
    const hostPort = match[2] || match[3];
    const containerPort = match[4] || '';

    if (hostPort) {
      const portNum = parseInt(hostPort);
      if (containerPort) {
        const containerNum = parseInt(containerPort);
        if (containerNum === 5432) ports.DB_PORT = portNum;
        if (containerNum === 3000) ports.SERVER_PORT = portNum;
        if (containerNum === 80) ports.WEB_PORT = portNum;
        if (containerNum === 443) ports.HTTPS_PORT = portNum;
      } else {
        if (portNum === 5432 || portNum === 5433) ports.DB_PORT = portNum;
        if (portNum === 3000 || portNum === 3001) ports.SERVER_PORT = portNum;
        if (portNum === 8080 || portNum === 8081) ports.WEB_PORT = portNum;
      }
    }
  }

  return ports;
}

function updateComposePorts(composePath: string, ports: Record<string, number>): boolean {
  if (!fs.existsSync(composePath)) return false;

  let content = fs.readFileSync(composePath, 'utf-8');
  let changed = false;

  const portMappings: Record<string, { container: number; envKey: string }> = {
    '5432': { container: 5432, envKey: 'DB_PORT' },
    '3000': { container: 3000, envKey: 'SERVER_PORT' },
    '80': { container: 80, envKey: 'WEB_PORT' },
  };

  for (const [containerPort, { envKey }] of Object.entries(portMappings)) {
    const newPort = ports[envKey];
    if (!newPort) continue;

    const containerNum = parseInt(containerPort);

    // Pattern: "hostPort:containerPort"
    const pattern1 = new RegExp(`"([^"]*):${containerNum}"`, 'g');
    const match1 = content.match(pattern1);
    if (match1) {
      content = content.replace(pattern1, `"${newPort}:${containerNum}"`);
      changed = true;
    }

    // Pattern: - "hostPort:containerPort"
    const pattern2 = new RegExp(`-\\s*"([^"]*):${containerNum}"`, 'g');
    const match2 = content.match(pattern2);
    if (match2) {
      content = content.replace(pattern2, `- "${newPort}:${containerNum}"`);
      changed = true;
    }

    // Pattern: - "0.0.0.0:hostPort:containerPort"
    const pattern3 = new RegExp(`-\\s*"0\\.0\\.0\\.0:([^:]*):${containerNum}"`, 'g');
    const match3 = content.match(pattern3);
    if (match3) {
      content = content.replace(pattern3, `- "0.0.0.0:${newPort}:${containerNum}"`);
      changed = true;
    }

    // Pattern: - "127.0.0.1:hostPort:containerPort"
    const pattern4 = new RegExp(`-\\s*"127\\.0\\.0\\.1:([^:]*):${containerNum}"`, 'g');
    const match4 = content.match(pattern4);
    if (match4) {
      content = content.replace(pattern4, `- "127.0.0.1:${newPort}:${containerNum}"`);
      changed = true;
    }
  }

  if (changed) {
    fs.writeFileSync(composePath, content);
  }

  return changed;
}

export function registerSyncPortsCommand(program: Command) {
  const syncCmd = program
    .command('sync:ports')
    .description('Sincroniza puertos entre .env y docker-compose files');

  syncCmd
    .command('env-to-compose')
    .description('Copia puertos del .env a los docker-compose files')
    .option('--path <path>', 'Ruta del proyecto')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Sync Puertos (.env → compose)'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        const root = opts.path || getProjectRoot();
        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);

        const ports: Record<string, number> = {};
        if (env.DB_PORT) ports.DB_PORT = parseInt(env.DB_PORT);
        if (env.SERVER_PORT) ports.SERVER_PORT = parseInt(env.SERVER_PORT);
        if (env.WEB_PORT) ports.WEB_PORT = parseInt(env.WEB_PORT);

        if (Object.keys(ports).length === 0) {
          log.warn('No se encontraron puertos en .env');
          return;
        }

        log.info('Puertos en .env:');
        for (const [key, value] of Object.entries(ports)) {
          log.info(`  ${key}: ${value}`);
        }
        log.blank();

        const composeFiles = [
          'docker-compose.yml',
          'docker-compose.prod.yml',
        ];

        for (const composeFile of composeFiles) {
          const composePath = path.join(root, composeFile);
          if (fs.existsSync(composePath)) {
            const spinner = ora(`Actualizando ${composeFile}...`).start();
            const changed = updateComposePorts(composePath, ports);
            if (changed) {
              spinner.succeed(`${composeFile} actualizado`);
            } else {
              spinner.info(`${composeFile} no necesita cambios`);
            }
          }
        }

        log.blank();
        log.success('Sincronización completada');
        log.dim('  Reinicia los servicios con: docker compose up -d');
      } catch (err: any) {
        log.error(err.message);
      }
    });

  syncCmd
    .command('compose-to-env')
    .description('Copia puertos de docker-compose al .env')
    .option('--path <path>', 'Ruta del proyecto')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Sync Puertos (compose → .env)'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        const root = opts.path || getProjectRoot();
        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);

        const composeFiles = [
          'docker-compose.prod.yml',
          'docker-compose.yml',
        ];

        let foundPorts: Record<string, number> = {};

        for (const composeFile of composeFiles) {
          const composePath = path.join(root, composeFile);
          if (fs.existsSync(composePath)) {
            const content = fs.readFileSync(composePath, 'utf-8');
            const ports = extractPortsFromCompose(content);
            foundPorts = { ...foundPorts, ...ports };
          }
        }

        if (Object.keys(foundPorts).length === 0) {
          log.warn('No se encontraron puertos en docker-compose files');
          return;
        }

        log.info('Puertos detectados en compose:');
        for (const [key, value] of Object.entries(foundPorts)) {
          const oldVal = env[key];
          const marker = oldVal && parseInt(oldVal) !== value ? chalk.yellow(' (cambiado)') : '';
          log.info(`  ${key}: ${value}${marker}`);
        }
        log.blank();

        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: 'Actualizar .env con estos puertos?',
            default: true,
          },
        ]);

        if (!confirm) {
          log.info('Cancelado');
          return;
        }

        for (const [key, value] of Object.entries(foundPorts)) {
          env[key] = String(value);
        }
        writeEnv(envPath, env);

        log.success('.env actualizado');
        log.dim('  Reinicia los servicios con: docker compose up -d');
      } catch (err: any) {
        log.error(err.message);
      }
    });

  syncCmd
    .command('check')
    .description('Verifica si hay diferencias de puertos entre .env y compose')
    .option('--path <path>', 'Ruta del proyecto')
    .action(async (opts) => {
      try {
        const root = opts.path || getProjectRoot();
        const envPath = path.join(root, '.env');
        const env = readEnv(envPath);

        const composeFiles = [
          'docker-compose.prod.yml',
          'docker-compose.yml',
        ];

        let composePorts: Record<string, number> = {};
        for (const composeFile of composeFiles) {
          const composePath = path.join(root, composeFile);
          if (fs.existsSync(composePath)) {
            const content = fs.readFileSync(composePath, 'utf-8');
            composePorts = { ...composePorts, ...extractPortsFromCompose(content) };
          }
        }

        const envPorts: Record<string, number> = {};
        if (env.DB_PORT) envPorts.DB_PORT = parseInt(env.DB_PORT);
        if (env.SERVER_PORT) envPorts.SERVER_PORT = parseInt(env.SERVER_PORT);
        if (env.WEB_PORT) envPorts.WEB_PORT = parseInt(env.WEB_PORT);

        log.blank();
        log.info('Comparación de puertos:');
        log.blank();

        const allKeys = [...new Set([...Object.keys(envPorts), ...Object.keys(composePorts)])];
        let hasDifferences = false;

        for (const key of allKeys.sort()) {
          const envVal = envPorts[key];
          const composeVal = composePorts[key];

          if (envVal && composeVal && envVal !== composeVal) {
            log.warn(`  ${key}: .env=${envVal} | compose=${composeVal} ${chalk.red('← DIFERENTE')}`);
            hasDifferences = true;
          } else if (envVal) {
            log.info(`  ${key}: ${envVal} ${chalk.dim('(solo en .env)')}`);
          } else if (composeVal) {
            log.info(`  ${key}: ${composeVal} ${chalk.dim('(solo en compose)')}`);
          }
        }

        log.blank();
        if (!hasDifferences) {
          log.success('Todos los puertos están sincronizados');
        } else {
          log.warn('Hay diferencias. Usa uno de estos comandos para sincronizar:');
          log.dim('  openfactu sync:ports env-to-compose');
          log.dim('  openfactu sync:ports compose-to-env');
        }
        log.blank();
      } catch (err: any) {
        log.error(err.message);
      }
    });
}
