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

function generateEnvConfig(targetDir: string): Record<string, string> {
  const dbPassword = generatePassword(24);
  const postgresUser = 'openfactu';
  const postgresDb = 'openfactudb';
  const jwtSecret = generatePassword(48);
  const sessionSecret = generatePassword(32);
  const adminPassword = generatePassword(16);

  return {
    POSTGRES_USER: postgresUser,
    POSTGRES_PASSWORD: dbPassword,
    POSTGRES_DB: postgresDb,
    DATABASE_URL: `postgresql://${postgresUser}:${dbPassword}@db:5432/${postgresDb}`,
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

        // 7. Generar/configurar .env
        if (opts.generateEnv || nonInteractive) {
          const envSpinner = ora('Generando configuración segura...').start();
          const envConfig = generateEnvConfig(targetDir);

          const envFile = path.join(targetDir, '.env');
          const existingEnv = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf-8') : '';

          const lines: string[] = [];
          for (const [key, value] of Object.entries(envConfig)) {
            const existingRegex = new RegExp(`^${key}=.*$`, 'm');
            if (existingRegex.test(existingEnv)) {
              lines.push(existingEnv.replace(existingRegex, `${key}=${value}`));
            } else {
              lines.push(`${key}=${value}`);
            }
          }

          fs.writeFileSync(envFile, lines.join('\n') + '\n');
          envSpinner.succeed('.env generado con credenciales seguras');
          log.blank();
          log.info(`${chalk.dim('Admin:')} admin@openfactu.local / ${chalk.yellow(envConfig.ADMIN_PASSWORD)}`);
          log.info(`${chalk.dim('DB Password:')} ${chalk.yellow(envConfig.POSTGRES_PASSWORD)}`);
          log.dim('  Guarda estas credenciales en un lugar seguro');
          log.blank();
        } else {
          const envExample = path.join(targetDir, '.env.example');
          const envFile = path.join(targetDir, '.env');
          if (fs.existsSync(envExample) && !fs.existsSync(envFile)) {
            fs.copyFileSync(envExample, envFile);
            log.success('Archivo .env creado desde .env.example');
          }
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

        // 9. Preguntar por monitoring/analytics
        let includeMonitoring = opts.monitoring || false;
        let includeAnalytics = opts.withAnalytics || false;

        if (!nonInteractive && (installMode === 'full' || installMode === 'docker')) {
          if (!includeMonitoring) {
            const { monitoring } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'monitoring',
                message: 'Incluir stack de monitoreo (Grafana, Prometheus, pgAdmin, Portainer)?',
                default: false,
              },
            ]);
            includeMonitoring = monitoring;
          }

          if (includeMonitoring && !includeAnalytics) {
            const { analytics } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'analytics',
                message: 'Incluir analítica avanzada (Loki para logs, cAdvisor para contenedores, Node Exporter)?',
                default: false,
              },
            ]);
            includeAnalytics = analytics;
          }
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
        if (includeMonitoring) console.log(`  ${chalk.dim('Monitoreo:')}  ${chalk.green('Incluido')}`);
        if (includeAnalytics) console.log(`  ${chalk.dim('Analítica:')}  ${chalk.green('Incluida')}`);
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
