import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import https from 'https';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger';
import { applyEnvOverrides } from '../utils/env';
import {
  basicMonitoringServices,
  fullMonitoringServices,
  generateMonitoringCompose,
  monitoringChoices,
  writeMonitoringConfigs,
} from '../utils/monitoring';
import {
  generatePassword,
  generateSlug,
  runPreflightChecks,
  waitForService,
  getDockerComposeCommand,
  checkDiskSpace,
  isLinux,
} from '../utils/helpers';

const REPO_URL = 'https://github.com/OpenFactu/platform.git';
const GITHUB_OWNER = 'OpenFactu';
const GITHUB_REPO = 'platform';

interface GithubRelease {
  tag_name: string;
  name: string;
  prerelease: boolean;
  draft: boolean;
  published_at: string;
  body: string;
}

function fetchJSON(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'openfactu-cli' } }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          reject(new Error('Respuesta no es JSON'));
        }
      });
    }).on('error', reject);
  });
}

async function getGithubReleases(): Promise<GithubRelease[]> {
  try {
    const data = await fetchJSON(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases`);
    if (!Array.isArray(data)) return [];
    return data.filter((r: any) => !r.draft);
  } catch {
    return [];
  }
}

function getAvailableBranches(): string[] {
  try {
    const output = execSync(`git ls-remote --heads ${REPO_URL}`, {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    }).toString().trim();

    if (!output) return [];

    return output
      .split('\n')
      .map((line) => {
        const match = line.match(/refs\/heads\/(.+)$/);
        return match ? match[1] : null;
      })
      .filter((b): b is string => b !== null);
  } catch {
    return [];
  }
}

function checkDocker(): boolean {
  try {
    execSync('docker --version', { stdio: 'pipe' });
    try {
      execSync('docker compose version', { stdio: 'pipe' });
    } catch {
      execSync('docker-compose --version', { stdio: 'pipe' });
    }
    return true;
  } catch {
    return false;
  }
}

function validateRepoStructure(targetDir: string): { valid: boolean; missing: string[] } {
  const required = [
    'package.json',
    'docker-compose.yml',
    'apps/web',
    'apps/server',
  ];
  const missing = required.filter(f => !fs.existsSync(path.join(targetDir, f)));
  return { valid: missing.length === 0, missing };
}

const installLog: string[] = [];

function logStep(message: string, status: 'info' | 'success' | 'warn' | 'error' = 'info') {
  const timestamp = new Date().toISOString();
  const prefix = status === 'success' ? '✓' : status === 'error' ? '✗' : status === 'warn' ? '⚠' : '•';
  const entry = `[${timestamp}] ${prefix} ${message}`;
  installLog.push(entry);
}

function writeInstallLog(targetDir: string) {
  try {
    const logDir = path.join(targetDir, '.openfactu');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logFile = path.join(logDir, 'install.log');
    fs.writeFileSync(logFile, installLog.join('\n') + '\n');
  } catch {}
}

function generateEnvConfig(dbPassword: string): Record<string, string> {
  const postgresUser = 'openfactu';
  const postgresDb = 'openfactudb';
  const jwtSecret = generatePassword(48);
  const sessionSecret = generatePassword(32);
  const adminPassword = generatePassword(16);

  return {
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: dbPassword,
    POSTGRES_DB: postgresDb,
    DATABASE_URL: `postgresql://${postgresUser}:${encodeURIComponent(dbPassword)}@db:5432/${postgresDb}`,
    SERVER_PORT: '3000',
    WEB_PORT: '8080',
    DB_PORT: '5432',
    JWT_SECRET: jwtSecret,
    SESSION_SECRET: sessionSecret,
    NODE_ENV: 'production',
    HOST: 'localhost',
    CORS_ORIGIN: 'http://localhost:8080',
    VITE_API_URL: 'http://localhost:3000',
    ADMIN_EMAIL: 'admin@openfactu.local',
    ADMIN_PASSWORD: adminPassword,
  };
}

function generateEnvFileContent(envConfig: Record<string, string>): string {
  return `# ============================================================
# OpenFactu - Configuración
# Generado automáticamente por @openfactu/cli
# ============================================================
# IMPORTANTE: Revisa y ajusta los valores marcados con [EDITAR]
# ============================================================

# ── Base de datos ──────────────────────────────────────────
# [EDITAR] Si cambias el puerto de PostgreSQL, actualiza DATABASE_URL
POSTGRES_USER=${envConfig.POSTGRES_USER}
POSTGRES_PASSWORD=${envConfig.POSTGRES_PASSWORD}
POSTGRES_DB=${envConfig.POSTGRES_DB}
DB_PORT=${envConfig.DB_PORT}

# [EDITAR] La URL interna del contenedor (no cambiar a menos que uses otro host de BD)
DATABASE_URL=${envConfig.DATABASE_URL}

# ── Puertos de la aplicación ───────────────────────────────
# [EDITAR] Cambia estos puertos si hay conflictos en tu servidor
SERVER_PORT=${envConfig.SERVER_PORT}
WEB_PORT=${envConfig.WEB_PORT}

# ── Seguridad ─────────────────────────────────────────────
# [NO EDITAR] Secrets generados automáticamente
JWT_SECRET=${envConfig.JWT_SECRET}
SESSION_SECRET=${envConfig.SESSION_SECRET}

# ── Entorno ────────────────────────────────────────────────
NODE_ENV=${envConfig.NODE_ENV}

# ── URLs y acceso externo ──────────────────────────────────
# [EDITAR] Cambia HOST por tu dominio o IP pública
HOST=${envConfig.HOST}

# [EDITAR] Cambia estas URLs según tu dominio/IP y puertos
# Ejemplo con dominio: https://erp.miempresa.com
# Ejemplo con IP: http://192.168.1.100:8080
CORS_ORIGIN=${envConfig.CORS_ORIGIN}
VITE_API_URL=${envConfig.VITE_API_URL}

# ── Credenciales de administrador ──────────────────────────
# [EDITAR] Cambia el email y password del admin inicial
ADMIN_EMAIL=${envConfig.ADMIN_EMAIL}
ADMIN_PASSWORD=${envConfig.ADMIN_PASSWORD}
`;
}

function installService(targetDir: string, dockerCmd: string, serviceName: string, unitPath: string) {
  const unitContent = `[Unit]
Description=OpenFactu ERP Platform
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${targetDir}
ExecStart=${dockerCmd} -f docker-compose.yml up -d
ExecStop=${dockerCmd} -f docker-compose.yml down
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
  fs.writeFileSync(`/tmp/${serviceName}.service`, unitContent);
  execSync(`sudo mv /tmp/${serviceName}.service ${unitPath}`, { stdio: 'pipe' });
  execSync('sudo systemctl daemon-reload', { stdio: 'pipe' });
  execSync(`sudo systemctl enable ${serviceName}`, { stdio: 'pipe' });
  log.success(`Servicio ${serviceName} instalado y habilitado`);
  log.dim(`  sudo systemctl start ${serviceName}`);
  log.dim(`  sudo systemctl status ${serviceName}`);
}

export function registerInstallCommand(program: Command) {
  program
    .command('install [directory]')
    .description('Descarga e instala OpenFactu en un directorio')
    .option('-t, --tag <tag>', 'Versión/tag específico (ej: v1.0.0)')
    .option('-b, --branch <branch>', 'Branch específico (default: main)')
    .option('--repo <url>', 'URL del repositorio', REPO_URL)
    .option('--skip-deps', 'No instalar dependencias (npm install)')
    .option('--mode <mode>', 'Modo: full, docker, minimal, download (default: interactive)')
    .option('--no-preflight', 'Saltar chequeos previos')
    .option('--no-healthcheck', 'Saltar health checks post-instalación')
    .option('--generate-env', 'Generar .env con credenciales seguras aleatorias')
    .option('--service', 'Instalar como servicio systemd después de instalar')
    .option('--monitoring', 'Incluir stack de monitoreo (Grafana, Prometheus, etc.)')
    .option('--with-analytics', 'Incluir stack completo de analítica (Loki, cAdvisor, Node Exporter)')
    .option('-y, --yes', 'Aceptar defaults sin preguntar (non-interactive)')
    .action(async (directory, opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Instalación'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      let targetDir = directory;

      try {
        const repoUrl = opts.repo;
        const nonInteractive = opts.yes || false;

        logStep('Inicio de instalación', 'info');

        // 0. Preflight checks
        if (opts.preflight !== false) {
          const checkSpinner = ora('Ejecutando chequeos del sistema...').start();
          const checks = runPreflightChecks(directory || os.homedir());

          const fails = checks.filter(c => c.status === 'fail');
          const warns = checks.filter(c => c.status === 'warn');

          if (fails.length > 0) {
            checkSpinner.fail('Chequeos fallidos');
            logStep(`Preflight fallido: ${fails.map(f => f.name).join(', ')}`, 'error');
            log.blank();
            log.error('Requisitos no cumplidos:');
            for (const f of fails) {
              log.error(`  ✗ ${f.name}: ${f.message}`);
            }
            log.blank();
            if (!nonInteractive) {
              const { continueAnyway } = await inquirer.prompt([
                { type: 'confirm', name: 'continueAnyway', message: 'Continuar de todos modos?', default: false },
              ]);
              if (!continueAnyway) return;
            }
          } else if (warns.length > 0) {
            checkSpinner.warn('Chequeos con advertencias');
            logStep(`Preflight con advertencias: ${warns.map(w => w.name).join(', ')}`, 'warn');
            for (const w of warns) {
              log.warn(`  ⚠ ${w.name}: ${w.message}`);
            }
          } else {
            checkSpinner.succeed(`${checks.length} chequeos pasados`);
            logStep('Preflight OK', 'success');
          }
          log.blank();
        }

        // 1. Obtener releases de GitHub
        const fetchSpinner = ora('Consultando releases en GitHub...').start();
        const releases = await getGithubReleases();
        const branches = getAvailableBranches();
        fetchSpinner.succeed(`${releases.length} release(s), ${branches.length} branches disponibles`);

        // 2. Elegir versión
        let ref: string;

        if (opts.tag) {
          ref = opts.tag;
        } else if (opts.branch) {
          ref = opts.branch;
        } else if (nonInteractive) {
          const stable = releases.filter((r) => !r.prerelease);
          ref = stable.length > 0 ? stable[0].tag_name : 'main';
        } else {
          const choices: any[] = [];

          const stable = releases.filter((r) => !r.prerelease);
          const prerelease = releases.filter((r) => r.prerelease);

          for (const rel of stable.slice(0, 10)) {
            const date = new Date(rel.published_at).toLocaleDateString('es-ES');
            choices.push({
              name: `${chalk.green(rel.tag_name)} ${chalk.white(rel.name || '')} ${chalk.dim(`(${date})`)}`,
              value: rel.tag_name,
            });
          }

          if (prerelease.length > 0) {
            choices.push(new inquirer.Separator(chalk.dim('── Pre-releases ──')));
            for (const rel of prerelease.slice(0, 5)) {
              const date = new Date(rel.published_at).toLocaleDateString('es-ES');
              choices.push({
                name: `${chalk.yellow(rel.tag_name)} ${chalk.white(rel.name || '')} ${chalk.dim(`(${date}) pre-release`)}`,
                value: rel.tag_name,
              });
            }
          }

          if (branches.length > 0) {
            choices.push(new inquirer.Separator(chalk.dim('── Branches ──')));
            for (const branch of branches) {
              const label = branch === 'main' ? chalk.dim('(última versión)') : '';
              choices.push({
                name: `${chalk.cyan(branch)} ${label}`,
                value: branch,
              });
            }
          }

          if (choices.length === 0) {
            choices.push({ name: 'main (default)', value: 'main' });
          }

          const { selected } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selected',
              message: 'Selecciona la versión a instalar:',
              choices,
              pageSize: 15,
            },
          ]);

          ref = selected;
        }

        log.info(`Versión seleccionada: ${chalk.cyan(ref)}`);

        // 3. Directorio destino
        if (!targetDir) {
          if (nonInteractive) {
            targetDir = path.join(os.homedir(), 'openfactu');
          } else {
            const { dir } = await inquirer.prompt([
              {
                type: 'input',
                name: 'dir',
                message: 'Directorio de instalación:',
                default: path.join(os.homedir(), 'openfactu'),
              },
            ]);
            targetDir = dir;
          }
        }

        targetDir = path.resolve(targetDir);

        if (fs.existsSync(targetDir)) {
          const contents = fs.readdirSync(targetDir);
          if (contents.length > 0) {
            if (nonInteractive) {
              log.warn(`Directorio ${targetDir} no está vacío, se usará igual`);
            } else {
              const { overwrite } = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'overwrite',
                  message: `El directorio ${targetDir} no está vacío. ¿Continuar?`,
                  default: false,
                },
              ]);
              if (!overwrite) {
                log.info('Instalación cancelada');
                return;
              }
            }
          }
        }

        log.info(`Directorio: ${chalk.dim(targetDir)}`);
        logStep(`Directorio: ${targetDir}`, 'info');
        log.blank();

        // 4. Crear directorio
        if (!fs.existsSync(targetDir)) {
          try {
            fs.mkdirSync(targetDir, { recursive: true });
            logStep('Directorio creado', 'success');
          } catch (mkdirErr: any) {
            if (mkdirErr.code === 'EACCES') {
              log.warn('Sin permisos. Creando directorio con sudo...');
              try {
                const user = process.env.USER || process.env.USERNAME || 'root';
                execSync(`sudo mkdir -p "${targetDir}" && sudo chown -R ${user}:${user} "${targetDir}"`, {
                  stdio: 'pipe',
                });
                logStep('Directorio creado con sudo', 'success');
              } catch {
                log.error(`No se pudo crear ${targetDir}. Ejecuta con sudo o elige otro directorio.`);
                logStep(`Error creando directorio: ${targetDir}`, 'error');
                return;
              }
            } else {
              throw mkdirErr;
            }
          }
        }

        // 5. Clonar repositorio
        const cloneSpinner = ora('Descargando OpenFactu...').start();
        logStep('Iniciando clonación del repositorio', 'info');

        const isTag = releases.some((r) => r.tag_name === ref);
        const cloneCmd = isTag
          ? `git clone --depth 1 --branch ${ref} ${repoUrl} "${targetDir}"`
          : `git clone --branch ${ref} ${repoUrl} "${targetDir}"`;

        try {
          execSync(cloneCmd, { stdio: 'pipe', timeout: 120000 });
          cloneSpinner.succeed('Código descargado');
          logStep(`Repositorio clonado: ${ref}`, 'success');
        } catch (err: any) {
          try {
            cloneSpinner.text = 'Descargando (método alternativo)...';
            execSync(`git clone ${repoUrl} "${targetDir}"`, { stdio: 'pipe', timeout: 180000 });
            execSync(`git checkout ${ref}`, { cwd: targetDir, stdio: 'pipe' });
            cloneSpinner.succeed('Código descargado');
            logStep(`Repositorio clonado (alternativo): ${ref}`, 'success');
          } catch (err2: any) {
            cloneSpinner.fail('Error al descargar: ' + err2.message);
            logStep(`Error clonando repositorio: ${err2.message}`, 'error');
            return;
          }
        }

        // 6. Validar estructura del repo
        const validation = validateRepoStructure(targetDir);
        if (!validation.valid) {
          log.warn(`Estructura incompleta: ${validation.missing.join(', ')}`);
          logStep(`Estructura incompleta: ${validation.missing.join(', ')}`, 'warn');
          log.dim('  Algunos comandos pueden no funcionar correctamente');
        } else {
          logStep('Estructura del repositorio válida', 'success');
        }

        // 7. Configurar .env — las credenciales (incluida la contraseña de BD) se
        //    fijan AQUI, antes del primer arranque, para que el volumen de Postgres
        //    se inicialice con ellas y no acabe usando la contraseña por defecto.
        {
          const envFile = path.join(targetDir, '.env');
          const envExample = path.join(targetDir, '.env.example');

          // Decidir la contraseña de PostgreSQL.
          let dbPassword: string;
          if (opts.generateEnv || nonInteractive) {
            dbPassword = generatePassword(24);
          } else {
            const suggested = generatePassword(24);
            const { pw } = await inquirer.prompt([
              {
                type: 'input',
                name: 'pw',
                message: 'Contraseña de PostgreSQL (Enter = generar una segura):',
                default: suggested,
              },
            ]);
            dbPassword = typeof pw === 'string' && pw.trim() ? pw.trim() : suggested;
          }

          const envSpinner = ora('Configurando .env con credenciales seguras...').start();
          const envConfig = generateEnvConfig(dbPassword);

          // Plantilla base: .env.example si existe (preserva comentarios y claves
          // propias de la plataforma); si no, un .env generado desde cero.
          const baseContent = fs.existsSync(envExample)
            ? fs.readFileSync(envExample, 'utf-8')
            : generateEnvFileContent(envConfig);

          fs.writeFileSync(envFile, applyEnvOverrides(baseContent, envConfig));
          envSpinner.succeed('.env configurado con credenciales seguras');
          logStep('.env configurado con credenciales seguras', 'success');
          log.blank();
          log.info(`${chalk.dim('Admin:')} ${envConfig.ADMIN_EMAIL} / ${chalk.yellow(envConfig.ADMIN_PASSWORD)}`);
          log.info(`${chalk.dim('DB Password:')} ${chalk.yellow(envConfig.POSTGRES_PASSWORD)}`);
          log.dim('  Guarda estas credenciales en un lugar seguro');
          log.blank();
        }

        // 8. Determinar modo de instalación
        let installMode = opts.mode;

        if (!installMode) {
          const hasDocker = checkDocker();

          if (!hasDocker) {
            log.warn('Docker no detectado. OpenFactu requiere Docker para funcionar.');
            log.dim('  Instala Docker: https://docs.docker.com/get-docker/');
            log.blank();
          }

          if (nonInteractive) {
            installMode = hasDocker ? 'docker' : 'download';
          } else {
            const disk = checkDiskSpace(targetDir);

            const { selectedMode } = await inquirer.prompt([
              {
                type: 'list',
                name: 'selectedMode',
                message: 'Modo de instalación:',
                choices: [
                  ...(hasDocker ? [
                    {
                      name: `${chalk.green('Completa (Docker)')} ${chalk.dim('— build + up + setup completo')}`,
                      value: 'full',
                    },
                    {
                      name: `${chalk.cyan('Docker')} ${chalk.dim('— build + up, sin setup DB')}`,
                      value: 'docker',
                    },
                    {
                      name: `${chalk.yellow('Mínima')} ${chalk.dim('— solo compose up, sin build')}`,
                      value: 'minimal',
                    },
                  ] : []),
                  {
                    name: `${chalk.dim('Solo descarga')} ${chalk.dim('— sin Docker')}`,
                    value: 'download',
                  },
                ],
              },
            ]);
            installMode = selectedMode;
          }
        }

        // Verificar conflictos de puertos ANTES de hacer más preguntas
        if (installMode === 'full' || installMode === 'docker' || installMode === 'minimal') {
          const commonPorts = [
            { port: 5432, name: 'PostgreSQL', container: 'db' },
            { port: 8080, name: 'Web', container: 'web' },
            { port: 3000, name: 'API Server', container: 'server' },
          ];

          const conflicts = commonPorts.filter(p => {
            try {
              // Excluir docker-pr (proxies de Docker) que pueden quedar colgados
              const output = execSync(`lsof -i :${p.port} -sTCP:LISTEN 2>/dev/null | grep -v 'docker-pr' | grep -v 'COMMAND' || true`, { stdio: 'pipe' }).toString().trim();
              return output.length > 0;
            } catch {
              return false;
            }
          });

          if (conflicts.length > 0 && !nonInteractive) {
            log.blank();
            log.warn('Puertos en conflicto detectados:');
            for (const c of conflicts) {
              let processInfo = '';
              try {
                const pid = execSync(`lsof -i :${c.port} -sTCP:LISTEN -t 2>/dev/null | grep -v 'docker-pr' | head -1`, { stdio: 'pipe' }).toString().trim();
                if (pid) {
                  const procName = execSync(`ps -p ${pid} -o comm= 2>/dev/null || echo 'desconocido'`, { stdio: 'pipe' }).toString().trim();
                  processInfo = ` (${procName})`;
                }
              } catch {}
              log.warn(`  Puerto ${c.port} (${c.name}): ocupado${processInfo}`);
            }
            log.blank();

            const { portAction } = await inquirer.prompt([
              {
                type: 'list',
                name: 'portAction',
                message: '¿Cómo resolver el conflicto?',
                choices: [
                  { name: 'Detener el proceso que ocupa el puerto', value: 'stop' },
                  { name: 'Usar puertos alternativos (5433, 8081, 3001)', value: 'alternate' },
                  { name: 'Continuar igual (puede fallar)', value: 'continue' },
                  { name: 'Cancelar instalación', value: 'cancel' },
                ],
              },
            ]);

            if (portAction === 'cancel') {
              log.info('Instalación cancelada');
              writeInstallLog(targetDir);
              return;
            }

            if (portAction === 'stop') {
              for (const c of conflicts) {
                const stopSpinner = ora(`Deteniendo proceso en puerto ${c.port}...`).start();
                try {
                  const pid = execSync(`lsof -i :${c.port} -sTCP:LISTEN -t 2>/dev/null | head -1`, { stdio: 'pipe' }).toString().trim();
                  if (pid) {
                    execSync(`kill -9 ${pid} 2>/dev/null || true`, { stdio: 'pipe' });
                    stopSpinner.succeed(`Proceso en puerto ${c.port} detenido`);
                    logStep(`Puerto ${c.port} liberado`, 'success');
                  } else {
                    stopSpinner.warn(`No se encontró proceso en puerto ${c.port}`);
                  }
                } catch {
                  stopSpinner.fail(`No se pudo detener el proceso en puerto ${c.port}`);
                  log.dim(`  Intenta manualmente: sudo lsof -i :${c.port} -t | xargs kill -9`);
                }
              }
              log.blank();
            }

            if (portAction === 'alternate') {
              const portMap: Record<number, number> = { 5432: 5433, 8080: 8081, 3000: 3001 };

              // Actualizar .env
              const envPath = path.join(targetDir, '.env');
              if (fs.existsSync(envPath)) {
                let envContent = fs.readFileSync(envPath, 'utf-8');
                for (const [oldPort, newPort] of Object.entries(portMap)) {
                  const oldPortNum = parseInt(oldPort);
                  if (conflicts.some(c => c.port === oldPortNum)) {
                    envContent = envContent.replace(new RegExp(`:${oldPortNum}\\b`, 'g'), `:${newPort}`);
                    envContent = envContent.replace(new RegExp(`PORT=${oldPortNum}`, 'g'), `PORT=${newPort}`);
                    log.info(`Puerto ${oldPort} → ${newPort}`);
                  }
                }
                fs.writeFileSync(envPath, envContent);
                logStep('Puertos alternativos configurados en .env', 'success');
              }

              // Actualizar docker-compose files
              const composeFiles = [
                'docker-compose.yml',
                'docker-compose.prod.yml',
              ];

              for (const composeFile of composeFiles) {
                const composePath = path.join(targetDir, composeFile);
                if (fs.existsSync(composePath)) {
                  let composeContent = fs.readFileSync(composePath, 'utf-8');
                  for (const [oldPort, newPort] of Object.entries(portMap)) {
                    const oldPortNum = parseInt(oldPort);
                    if (conflicts.some(c => c.port === oldPortNum)) {
                      composeContent = composeContent.replace(
                        new RegExp(`"([^"]*):${oldPortNum}"`, 'g'),
                        `$1:${newPort}"`
                      );
                      composeContent = composeContent.replace(
                        new RegExp(`- "${oldPortNum}:${oldPortNum}"`, 'g'),
                        `- "${newPort}:${oldPortNum}"`
                      );
                      composeContent = composeContent.replace(
                        new RegExp(`- "0\\.0\\.0\\.0:${oldPortNum}:`, 'g'),
                        `- "0.0.0.0:${newPort}:`
                      );
                      composeContent = composeContent.replace(
                        new RegExp(`- "127\\.0\\.0\\.1:${oldPortNum}:`, 'g'),
                        `- "127.0.0.1:${newPort}:`
                      );
                    }
                  }
                  fs.writeFileSync(composePath, composeContent);
                  logStep(`Puertos actualizados en ${composeFile}`, 'success');
                }
              }

              log.blank();
            }
          }
        }

        // 9. Monitoreo — selección granular de servicios
        let includeMonitoring = false;
        let monitoringServices: string[] = [];

        if (installMode === 'full' || installMode === 'docker') {
          if (opts.withAnalytics) {
            includeMonitoring = true;
            monitoringServices = fullMonitoringServices();
          } else if (opts.monitoring) {
            includeMonitoring = true;
            monitoringServices = basicMonitoringServices();
          } else if (!nonInteractive) {
            const { monitoring } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'monitoring',
                message: 'Incluir stack de monitoreo (Grafana, Prometheus, pgAdmin, Portainer…)?',
                default: false,
              },
            ]);
            if (monitoring) {
              const { services } = await inquirer.prompt([
                {
                  type: 'checkbox',
                  name: 'services',
                  message: 'Servicios de monitoreo a instalar:',
                  choices: monitoringChoices(),
                },
              ]);
              monitoringServices = services as string[];
              includeMonitoring = monitoringServices.length > 0;
            }
          }
        }

        // Generar docker-compose.monitoring.yml + configs con los servicios elegidos
        if (includeMonitoring && monitoringServices.length > 0) {
          const monSpinner = ora('Generando stack de monitoreo...').start();
          const serviceSet = new Set<string>(monitoringServices);
          fs.writeFileSync(
            path.join(targetDir, 'docker-compose.monitoring.yml'),
            generateMonitoringCompose(serviceSet),
          );
          writeMonitoringConfigs(targetDir, serviceSet);

          const envFile = path.join(targetDir, '.env');
          if (fs.existsSync(envFile)) {
            fs.writeFileSync(
              envFile,
              applyEnvOverrides(fs.readFileSync(envFile, 'utf-8'), {
                MONITORING_SERVICES: monitoringServices.join(','),
              }),
            );
          }
          monSpinner.succeed(`Monitoreo: ${monitoringServices.join(', ')}`);
          logStep(`Monitoreo configurado: ${monitoringServices.join(', ')}`, 'success');
        } else {
          includeMonitoring = false;
        }

        // Preguntar por servicio systemd (siempre, si es Linux)
        if (!nonInteractive && isLinux() && (installMode === 'full' || installMode === 'docker' || installMode === 'minimal')) {
          const { installService } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'installService',
              message: 'Instalar como servicio systemd (auto-start al iniciar el sistema)?',
              default: false,
            },
          ]);
          if (installService) opts.service = true;
        }

        // 10. Ejecutar instalación según modo
        const dockerCmd = getDockerComposeCommand();
        logStep(`Modo de instalación: ${installMode}`, 'info');

        // Verificar conflictos de puertos antes de levantar contenedores
        if (installMode === 'full' || installMode === 'docker' || installMode === 'minimal') {
          const commonPorts = [
            { port: 5432, name: 'PostgreSQL', container: 'db' },
            { port: 8080, name: 'Web', container: 'web' },
            { port: 3000, name: 'API Server', container: 'server' },
          ];

          const conflicts = commonPorts.filter(p => {
            try {
              const output = execSync(`lsof -i :${p.port} -sTCP:LISTEN 2>/dev/null | grep -v 'docker-pr' | grep -v 'COMMAND' || true`, { stdio: 'pipe' }).toString().trim();
              return output.length > 0;
            } catch {
              return false;
            }
          });

          if (conflicts.length > 0 && !nonInteractive) {
            log.blank();
            log.warn('Puertos en conflicto detectados:');
            for (const c of conflicts) {
              let processInfo = '';
              try {
                const pid = execSync(`lsof -i :${c.port} -sTCP:LISTEN -t 2>/dev/null | grep -v 'docker-pr' | head -1 || true`, { stdio: 'pipe' }).toString().trim();
                if (pid) {
                  const procName = execSync(`ps -p ${pid} -o comm= 2>/dev/null || echo 'desconocido'`, { stdio: 'pipe' }).toString().trim();
                  processInfo = ` (${procName})`;
                }
              } catch {}
              log.warn(`  Puerto ${c.port} (${c.name}): ocupado${processInfo}`);
            }
            log.blank();

            const { portAction } = await inquirer.prompt([
              {
                type: 'list',
                name: 'portAction',
                message: '¿Cómo resolver el conflicto?',
                choices: [
                  { name: 'Detener el proceso que ocupa el puerto', value: 'stop' },
                  { name: 'Usar puertos alternativos (5433, 8081, 3001)', value: 'alternate' },
                  { name: 'Continuar igual (puede fallar)', value: 'continue' },
                  { name: 'Cancelar instalación', value: 'cancel' },
                ],
              },
            ]);

            if (portAction === 'cancel') {
              log.info('Instalación cancelada');
              writeInstallLog(targetDir);
              return;
            }

            if (portAction === 'stop') {
              for (const c of conflicts) {
                const stopSpinner = ora(`Deteniendo proceso en puerto ${c.port}...`).start();
                try {
                  const pid = execSync(`lsof -i :${c.port} -sTCP:LISTEN -t 2>/dev/null | head -1`, { stdio: 'pipe' }).toString().trim();
                  if (pid) {
                    execSync(`kill -9 ${pid} 2>/dev/null || true`, { stdio: 'pipe' });
                    stopSpinner.succeed(`Proceso en puerto ${c.port} detenido`);
                    logStep(`Puerto ${c.port} liberado`, 'success');
                  } else {
                    stopSpinner.warn(`No se encontró proceso en puerto ${c.port}`);
                  }
                } catch {
                  stopSpinner.fail(`No se pudo detener el proceso en puerto ${c.port}`);
                  log.dim(`  Intenta manualmente: sudo lsof -i :${c.port} -t | xargs kill -9`);
                }
              }
              log.blank();
            }

            if (portAction === 'alternate') {
              const portMap: Record<number, number> = { 5432: 5433, 8080: 8081, 3000: 3001 };

              // Actualizar .env
              const envPath = path.join(targetDir, '.env');
              if (fs.existsSync(envPath)) {
                let envContent = fs.readFileSync(envPath, 'utf-8');
                for (const [oldPort, newPort] of Object.entries(portMap)) {
                  const oldPortNum = parseInt(oldPort);
                  if (conflicts.some(c => c.port === oldPortNum)) {
                    envContent = envContent.replace(new RegExp(`:${oldPortNum}\\b`, 'g'), `:${newPort}`);
                    envContent = envContent.replace(new RegExp(`PORT=${oldPortNum}`, 'g'), `PORT=${newPort}`);
                    log.info(`Puerto ${oldPort} → ${newPort}`);
                  }
                }
                fs.writeFileSync(envPath, envContent);
                logStep('Puertos alternativos configurados en .env', 'success');
              }

              // Actualizar docker-compose files
              const composeFiles = [
                'docker-compose.yml',
                'docker-compose.prod.yml',
              ];

              for (const composeFile of composeFiles) {
                const composePath = path.join(targetDir, composeFile);
                if (fs.existsSync(composePath)) {
                  let composeContent = fs.readFileSync(composePath, 'utf-8');
                  for (const [oldPort, newPort] of Object.entries(portMap)) {
                    const oldPortNum = parseInt(oldPort);
                    if (conflicts.some(c => c.port === oldPortNum)) {
                      // Reemplazar puertos en mappings de Docker "host:container"
                      composeContent = composeContent.replace(
                        new RegExp(`"([^"]*):${oldPortNum}"`, 'g'),
                        `$1:${newPort}"`
                      );
                      composeContent = composeContent.replace(
                        new RegExp(`- "${oldPortNum}:${oldPortNum}"`, 'g'),
                        `- "${newPort}:${oldPortNum}"`
                      );
                      composeContent = composeContent.replace(
                        new RegExp(`- "0\\.0\\.0\\.0:${oldPortNum}:`, 'g'),
                        `- "0.0.0.0:${newPort}:`
                      );
                      composeContent = composeContent.replace(
                        new RegExp(`- "127\\.0\\.0\\.1:${oldPortNum}:`, 'g'),
                        `- "127.0.0.1:${newPort}:`
                      );
                    }
                  }
                  fs.writeFileSync(composePath, composeContent);
                  logStep(`Puertos actualizados en ${composeFile}`, 'success');
                }
              }

              log.blank();
            }
          }
        }

        if (installMode === 'full' || installMode === 'docker' || installMode === 'minimal') {
          if (installMode === 'full' || installMode === 'docker') {
            const dockerSpinner = ora('Construyendo contenedores Docker...').start();
            logStep('Iniciando build de Docker', 'info');
            try {
              execSync(`${dockerCmd} build`, { cwd: targetDir, stdio: 'pipe', timeout: 300000 });
              dockerSpinner.succeed('Contenedores construidos');
              logStep('Build de Docker completado', 'success');
            } catch (err: any) {
              dockerSpinner.fail('Error en build: ' + err.message);
              logStep(`Error en build de Docker: ${err.message}`, 'error');

              // Detectar error de permisos de Docker
              if (err.message?.includes('permission denied') && err.message?.includes('docker.sock')) {
                log.blank();
                log.warn('Error de permisos de Docker detectado');
                log.dim('  Tu usuario no tiene acceso al socket de Docker');
                log.blank();

                if (!nonInteractive) {
                  const { fixPermissions } = await inquirer.prompt([
                    {
                      type: 'confirm',
                      name: 'fixPermissions',
                      message: '¿Agregar tu usuario al grupo docker para arreglarlo? (requiere sudo)',
                      default: true,
                    },
                  ]);

                  if (fixPermissions) {
                    const fixSpinner = ora('Agregando usuario al grupo docker...').start();
                    logStep('Arreglando permisos de Docker', 'info');
                    try {
                      const user = process.env.USER || process.env.USERNAME || 'root';
                      execSync(`sudo usermod -aG docker ${user}`, { stdio: 'pipe' });
                      fixSpinner.succeed('Usuario agregado al grupo docker');
                      logStep('Permisos de Docker arreglados', 'success');
                      log.blank();
                      log.info('Los cambios se aplican en la próxima sesión');
                      log.dim(`  Ejecuta: newgrp docker`);
                      log.dim(`  O cierra sesión y vuelve a entrar`);
                      log.blank();

                      const { retryBuild } = await inquirer.prompt([
                        {
                          type: 'confirm',
                          name: 'retryBuild',
                          message: '¿Reintentar el build ahora?',
                          default: false,
                        },
                      ]);

                      if (retryBuild) {
                        const retrySpinner = ora('Reintentando build...').start();
                        try {
                          execSync(`${dockerCmd} build`, { cwd: targetDir, stdio: 'pipe', timeout: 300000 });
                          retrySpinner.succeed('Build completado');
                          logStep('Build completado tras arreglar permisos', 'success');
                        } catch {
                          retrySpinner.warn('Aún hay error de permisos');
                          logStep('Reintento de build fallido', 'warn');
                        }
                      }
                    } catch (fixErr: any) {
                      fixSpinner.fail('No se pudieron arreglar los permisos');
                      logStep(`Error arreglando permisos: ${fixErr.message}`, 'error');
                      log.dim('  Ejecuta manualmente: sudo usermod -aG docker $USER');
                    }
                  }
                } else {
                  log.dim('  Ejecuta: sudo usermod -aG docker $USER');
                }
              }

              log.blank();
              const { continueWithoutBuild } = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'continueWithoutBuild',
                  message: 'El build falló. ¿Continuar sin build y solo levantar contenedores existentes?',
                  default: false,
                },
              ]);
              if (!continueWithoutBuild) {
                log.info('Instalación cancelada');
                writeInstallLog(targetDir);
                return;
              }
            }
          }

          const upSpinner = ora('Levantando servicios...').start();
          logStep('Levantando servicios Docker', 'info');
          let composeFiles = '-f docker-compose.yml';
          if (fs.existsSync(path.join(targetDir, 'docker-compose.prod.yml'))) {
            composeFiles = '-f docker-compose.prod.yml';
          }

          if (includeMonitoring) {
            const monPath = path.join(targetDir, 'docker-compose.monitoring.yml');
            if (fs.existsSync(monPath)) {
              composeFiles += ` -f docker-compose.monitoring.yml`;
            }
          }

          try {
            execSync(`${dockerCmd} ${composeFiles} up -d`, { cwd: targetDir, stdio: 'pipe', timeout: 120000 });
            upSpinner.succeed('Servicios levantados');
            logStep('Servicios Docker levantados', 'success');
          } catch (err: any) {
            upSpinner.fail('Error: ' + err.message);
            logStep(`Error levantando servicios: ${err.message}`, 'error');

            // Detectar error de permisos de Docker
            if (err.message?.includes('permission denied') && err.message?.includes('docker.sock')) {
              log.blank();
              log.warn('Error de permisos de Docker detectado');
              log.dim('  Tu usuario no tiene acceso al socket de Docker');
              log.blank();

              if (!nonInteractive) {
                const { fixPermissions } = await inquirer.prompt([
                  {
                    type: 'confirm',
                    name: 'fixPermissions',
                    message: '¿Agregar tu usuario al grupo docker para arreglarlo? (requiere sudo)',
                    default: true,
                  },
                ]);

                if (fixPermissions) {
                  const fixSpinner = ora('Agregando usuario al grupo docker...').start();
                  logStep('Arreglando permisos de Docker', 'info');
                  try {
                    const user = process.env.USER || process.env.USERNAME || 'root';
                    execSync(`sudo usermod -aG docker ${user}`, { stdio: 'pipe' });
                    fixSpinner.succeed('Usuario agregado al grupo docker');
                    logStep('Permisos de Docker arreglados', 'success');
                    log.blank();
                    log.info('Los cambios se aplican en la próxima sesión');
                    log.dim(`  Ejecuta: newgrp docker`);
                    log.dim(`  O cierra sesión y vuelve a entrar`);
                    log.blank();

                    const { retryNow } = await inquirer.prompt([
                      {
                        type: 'confirm',
                        name: 'retryNow',
                        message: '¿Intentar levantar los servicios ahora? (puede fallar hasta que apliquen los permisos)',
                        default: false,
                      },
                    ]);

                    if (retryNow) {
                      const retrySpinner = ora('Reintentando...').start();
                      try {
                        execSync(`${dockerCmd} ${composeFiles} up -d`, { cwd: targetDir, stdio: 'pipe', timeout: 120000 });
                        retrySpinner.succeed('Servicios levantados');
                        logStep('Servicios levantados tras arreglar permisos', 'success');
                      } catch (retryErr: any) {
                        retrySpinner.warn('Aún hay error de permisos');
                        logStep('Reintento fallido, permisos no aplicados aún', 'warn');
                        log.dim('  Cierra sesión y vuelve a entrar, luego ejecuta:');
                        log.dim(`  cd ${targetDir} && ${dockerCmd} up -d`);
                      }
                    }
                  } catch (fixErr: any) {
                    fixSpinner.fail('No se pudieron arreglar los permisos');
                    logStep(`Error arreglando permisos: ${fixErr.message}`, 'error');
                    log.dim('  Ejecuta manualmente: sudo usermod -aG docker $USER');
                  }
                }
              } else {
                log.dim('  Ejecuta: sudo usermod -aG docker $USER');
                log.dim('  Luego cierra sesión y vuelve a entrar');
              }
            } else if (err.message?.includes('Bind for') && err.message?.includes('port is already allocated')) {
              // Detectar error de puerto ocupado
              log.blank();
              log.warn('Puerto ocupado detectado');
              const portMatch = err.message.match(/Bind for [\d.]+:(\d+)/);
              const occupiedPort = portMatch ? portMatch[1] : 'desconocido';
              log.warn(`  Puerto ${occupiedPort} ya está en uso`);
              log.blank();

              if (!nonInteractive) {
                const { portAction } = await inquirer.prompt([
                  {
                    type: 'list',
                    name: 'portAction',
                    message: '¿Cómo resolverlo?',
                    choices: [
                      { name: 'Detener el proceso que ocupa el puerto', value: 'stop' },
                      { name: 'Cambiar puerto en .env y reintentar', value: 'change' },
                      { name: 'Cancelar', value: 'cancel' },
                    ],
                  },
                ]);

                if (portAction === 'cancel') {
                  log.info('Instalación cancelada');
                  writeInstallLog(targetDir);
                  return;
                }

                if (portAction === 'stop') {
                  const stopSpinner = ora(`Deteniendo proceso en puerto ${occupiedPort}...`).start();
                  try {
                    const pid = execSync(`lsof -i :${occupiedPort} -sTCP:LISTEN -t 2>/dev/null | head -1`, { stdio: 'pipe' }).toString().trim();
                    if (pid) {
                      execSync(`kill -9 ${pid} 2>/dev/null || true`, { stdio: 'pipe' });
                      stopSpinner.succeed(`Proceso detenido`);
                      logStep(`Puerto ${occupiedPort} liberado`, 'success');

                      const { retry } = await inquirer.prompt([
                        { type: 'confirm', name: 'retry', message: '¿Reintentar levantar servicios?', default: true },
                      ]);
                      if (retry) {
                        const retrySpinner = ora('Reintentando...').start();
                        try {
                          execSync(`${dockerCmd} ${composeFiles} up -d`, { cwd: targetDir, stdio: 'pipe', timeout: 120000 });
                          retrySpinner.succeed('Servicios levantados');
                          logStep('Servicios levantados tras liberar puerto', 'success');
                        } catch {
                          retrySpinner.fail('Aún hay error');
                        }
                      }
                    } else {
                      stopSpinner.warn('No se encontró el proceso');
                    }
                  } catch {
                    stopSpinner.fail('No se pudo detener el proceso');
                    log.dim(`  Manual: sudo lsof -i :${occupiedPort} -t | xargs kill -9`);
                  }
                }

                if (portAction === 'change') {
                  const envPath = path.join(targetDir, '.env');
                  if (fs.existsSync(envPath)) {
                    const { newPort } = await inquirer.prompt([
                      { type: 'input', name: 'newPort', message: `Nuevo puerto para reemplazar ${occupiedPort}:`, default: String(parseInt(occupiedPort) + 1) },
                    ]);
                    let envContent = fs.readFileSync(envPath, 'utf-8');
                    envContent = envContent.replace(new RegExp(`:${occupiedPort}\\b`, 'g'), `:${newPort}`);
                    envContent = envContent.replace(new RegExp(`PORT=${occupiedPort}`, 'g'), `PORT=${newPort}`);
                    fs.writeFileSync(envPath, envContent);
                    log.success(`Puerto cambiado a ${newPort} en .env`);
                    logStep(`Puerto ${occupiedPort} → ${newPort}`, 'success');

                    const { retry } = await inquirer.prompt([
                      { type: 'confirm', name: 'retry', message: '¿Reintentar levantar servicios?', default: true },
                    ]);
                    if (retry) {
                      const retrySpinner = ora('Reintentando...').start();
                      try {
                        execSync(`${dockerCmd} ${composeFiles} up -d`, { cwd: targetDir, stdio: 'pipe', timeout: 120000 });
                        retrySpinner.succeed('Servicios levantados');
                      } catch {
                        retrySpinner.fail('Aún hay error');
                      }
                    }
                  }
                }
              } else {
                log.dim(`  Puerto ${occupiedPort} ocupado. Cambia el puerto en .env o detén el proceso.`);
              }
            } else {
              log.dim(`  cd ${targetDir} && ${dockerCmd} up -d`);
            }
          }

          // Health checks
          if (opts.healthcheck !== false && (installMode === 'full' || installMode === 'docker')) {
            log.blank();
            const healthSpinner = ora('Verificando servicios...').start();
            logStep('Ejecutando health checks', 'info');

            const webHealthy = await waitForService('http://localhost:8080', 20, 3000);
            const apiHealthy = await waitForService('http://localhost:3000/api/health', 15, 3000);

            if (webHealthy && apiHealthy) {
              healthSpinner.succeed('Servicios operativos');
              logStep('Health checks: Web OK, API OK', 'success');
            } else {
              healthSpinner.warn('Algunos servicios tardan en iniciar');
              logStep(`Health checks: Web=${webHealthy ? 'OK' : 'FAIL'}, API=${apiHealthy ? 'OK' : 'FAIL'}`, 'warn');
              log.dim('  Verifica con: docker compose ps');
            }
          }

          // Setup DB si es full
          if (installMode === 'full') {
            log.blank();
            log.info('Ejecutando configuración inicial de base de datos...');
            logStep('Configurando base de datos', 'info');
            try {
              execSync('docker compose exec -T server sh -c "npm run db:push || true"', {
                cwd: targetDir,
                stdio: 'pipe',
                timeout: 60000,
              });
              log.success('Base de datos configurada');
              logStep('Base de datos configurada', 'success');
            } catch {
              log.dim('  Ejecuta manualmente: openfactu setup');
              logStep('Configuración de BD omitida', 'warn');
            }
          }
        }

        // 11. Instalar como servicio si se pidió
        if (opts.service) {
          log.blank();
          log.info('Instalando servicio systemd...');
          try {
            const serviceName = 'openfactu';
            const unitPath = `/etc/systemd/system/${serviceName}.service`;
            const serviceExists = fs.existsSync(unitPath);

            if (serviceExists && !nonInteractive) {
              const { overwriteService } = await inquirer.prompt([
                {
                  type: 'confirm',
                  name: 'overwriteService',
                  message: `El servicio ${serviceName} ya existe. ¿Sobrescribir?`,
                  default: false,
                },
              ]);
              if (!overwriteService) {
                log.info('Servicio no modificado');
              } else {
                installService(targetDir, dockerCmd, serviceName, unitPath);
              }
            } else if (serviceExists && nonInteractive) {
              log.warn(`El servicio ${serviceName} ya existe, sobrescribiendo`);
              installService(targetDir, dockerCmd, serviceName, unitPath);
            } else {
              installService(targetDir, dockerCmd, serviceName, unitPath);
            }
          } catch (err: any) {
            log.warn('No se pudo instalar el servicio: ' + err.message);
          }
        }

        // 12. Escribir log de instalacion
        writeInstallLog(targetDir);

        // 12. Resumen
        const installedPkg = path.join(targetDir, 'package.json');
        let installedVersion = '?';
        if (fs.existsSync(installedPkg)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(installedPkg, 'utf-8'));
            installedVersion = pkg.version || '?';
          } catch {}
        }

        let installedCommit = '?';
        try {
          installedCommit = execSync('git rev-parse --short HEAD', { cwd: targetDir }).toString().trim();
        } catch {}

        log.blank();
        console.log(chalk.bold.green('  Instalación completada'));
        console.log(chalk.dim('  ────────────────────────────────────'));
        console.log(`  ${chalk.dim('Versión:')}    ${chalk.cyan(installedVersion)}`);
        console.log(`  ${chalk.dim('Ref:')}        ${chalk.cyan(ref)}`);
        console.log(`  ${chalk.dim('Commit:')}     ${chalk.cyan(installedCommit)}`);
        console.log(`  ${chalk.dim('Directorio:')} ${chalk.white(targetDir)}`);
        console.log(`  ${chalk.dim('Modo:')}       ${chalk.white(installMode)}`);
        if (includeMonitoring) console.log(`  ${chalk.dim('Monitoreo:')}  ${chalk.green(monitoringServices.join(', '))}`);
        log.blank();

        logStep('Instalación completada exitosamente', 'success');
        logStep(`Versión: ${installedVersion}, Ref: ${ref}, Commit: ${installedCommit}`, 'info');

        log.dim('  Próximos pasos:');
        log.dim(`    cd ${targetDir}`);
        if (installMode !== 'download') {
          log.dim('    openfactu deploy         — Configurar acceso externo');
          log.dim('    openfactu setup          — Configurar base de datos');
          log.dim('    openfactu deploy:status  — Ver estado de servicios');
          if (includeMonitoring) {
            log.dim('    openfactu monitoring     — Configurar monitoreo');
          }
        } else {
          log.dim(`    ${dockerCmd} up -d         — Levantar con Docker`);
          log.dim('    openfactu deploy         — Configurar acceso externo');
        }
        log.blank();
        log.dim(`  Log de instalación: ${chalk.dim(path.join(targetDir, '.openfactu', 'install.log'))}`);
        log.blank();
      } catch (err: any) {
        logStep(`Error fatal: ${err.message}`, 'error');
        try {
          writeInstallLog(targetDir || os.homedir());
        } catch {}
        log.error(err.message);
        process.exitCode = 1;
      }
    });
}
