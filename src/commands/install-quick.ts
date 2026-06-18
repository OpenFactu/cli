import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../utils/logger';
import { generatePassword, getDockerComposeCommand } from '../utils/helpers';

const REPO_URL = 'https://github.com/OpenFactu/platform.git';

export function registerInstallQuickCommand(program: Command) {
  program
    .command('install:quick')
    .description('Instalacion rapida de OpenFactu (non-interactive)')
    .option('--tag <tag>', 'Version especifica', 'latest')
    .option('--dir <dir>', 'Directorio de instalacion')
    .option('--no-docker', 'No levantar Docker')
    .option('--monitoring', 'Incluir monitoreo')
    .option('--analytics', 'Incluir analitica completa')
    .option('--service', 'Instalar como servicio systemd')
    .option('--generate-env', 'Generar .env con credenciales seguras')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Instalacion Rapida'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        let targetDir = opts.dir || path.join(os.homedir(), 'openfactu');
        const dockerCmd = getDockerComposeCommand();

        // Check Docker
        const hasDocker = (() => {
          try {
            execSync('docker --version', { stdio: 'pipe' });
            return true;
          } catch {
            return false;
          }
        })();

        if (!hasDocker && opts.docker !== false) {
          log.error('Docker es requerido para la instalacion rapida');
          log.dim('  Instala Docker: https://docs.docker.com/get-docker/');
          return;
        }

        // Clone
        const cloneSpinner = ora('Clonando repositorio...').start();
        let ref = opts.tag;

        if (ref === 'latest') {
          try {
            const releases = JSON.parse(
              execSync(
                'curl -s https://api.github.com/repos/OpenFactu/platform/releases | head -100',
                { stdio: 'pipe' },
              ).toString(),
            );
            const stable = releases.filter((r: any) => !r.prerelease && !r.draft);
            if (stable.length > 0) {
              ref = stable[0].tag_name;
            } else {
              ref = 'main';
            }
          } catch {
            ref = 'main';
          }
        }

        const isTag = ref.startsWith('v');

        // Verificar si el directorio ya existe
        if (fs.existsSync(targetDir)) {
          const contents = fs.readdirSync(targetDir);
          if (contents.length > 0) {
            log.warn(`El directorio ${targetDir} ya existe y no esta vacio`);
            const { action } = await inquirer.prompt([
              {
                type: 'list',
                name: 'action',
                message: 'Que quieres hacer?',
                choices: [
                  { name: 'Sobrescribir (eliminar y reinstalar)', value: 'overwrite' },
                  { name: 'Usar directorio existente (solo configurar)', value: 'reuse' },
                  { name: 'Elegir otro directorio', value: 'newdir' },
                  { name: 'Cancelar', value: 'cancel' },
                ],
              },
            ]);

            if (action === 'cancel') {
              log.info('Instalacion cancelada');
              return;
            }

            if (action === 'overwrite') {
              const removeSpinner = ora('Limpiando directorio...').start();
              execSync(`rm -rf "${targetDir}"`, { stdio: 'pipe' });
              fs.mkdirSync(targetDir, { recursive: true });
              removeSpinner.succeed('Directorio limpiado');
            }

            if (action === 'newdir') {
              const { newDir } = await inquirer.prompt([
                { type: 'input', name: 'newDir', message: 'Nuevo directorio:', default: path.join(os.homedir(), 'openfactu-2') },
              ]);
              targetDir = path.resolve(newDir);
              fs.mkdirSync(targetDir, { recursive: true });
            }

            if (action === 'reuse') {
              log.info('Usando directorio existente');
            }
          }
        } else {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const cloneCmd = isTag
          ? `git clone --depth 1 --branch ${ref} ${REPO_URL} "${targetDir}"`
          : `git clone --branch ${ref} ${REPO_URL} "${targetDir}"`;

        try {
          execSync(cloneCmd, { stdio: 'pipe', timeout: 120000 });
          cloneSpinner.succeed('Repositorio clonado');
        } catch (err: any) {
          if (err.message?.includes('ya existe') || err.message?.includes('already exists')) {
            cloneSpinner.warn('Directorio ya existe, usando existente');
          } else {
            cloneSpinner.fail('Error al clonar: ' + err.message);
            return;
          }
        }

        // Generate .env
        if (opts.generateEnv) {
          const envSpinner = ora('Generando configuracion...').start();
          const dbPassword = generatePassword(24);
          const jwtSecret = generatePassword(48);

          const envContent = `POSTGRES_USER=openfactu
POSTGRES_PASSWORD=${dbPassword}
POSTGRES_DB=openfactudb
DATABASE_URL=postgresql://openfactu:${dbPassword}@db:5432/openfactudb
SERVER_PORT=3000
WEB_PORT=8080
DB_PORT=5432
JWT_SECRET=${jwtSecret}
SESSION_SECRET=${generatePassword(32)}
NODE_ENV=production
HOST=localhost
CORS_ORIGIN=http://localhost:8080
VITE_API_URL=http://localhost:3000
ADMIN_EMAIL=admin@openfactu.local
ADMIN_PASSWORD=${generatePassword(16)}
`;

          fs.writeFileSync(path.join(targetDir, '.env'), envContent);
          envSpinner.succeed('.env generado');

          log.blank();
          log.info(`${chalk.dim('Admin:')} admin@openfactu.local / ${chalk.yellow('ver .env')}`);
          log.blank();
        } else {
          const envExample = path.join(targetDir, '.env.example');
          const envFile = path.join(targetDir, '.env');
          if (fs.existsSync(envExample) && !fs.existsSync(envFile)) {
            fs.copyFileSync(envExample, envFile);
          }
        }

        // Docker build and up
        if (opts.docker !== false) {
          const buildSpinner = ora('Construyendo contenedores...').start();
          try {
            execSync(`${dockerCmd} build`, { cwd: targetDir, stdio: 'pipe', timeout: 300000 });
            buildSpinner.succeed('Contenedores construidos');
          } catch (err: any) {
            buildSpinner.fail('Error en build');
            log.dim(`  cd ${targetDir} && ${dockerCmd} build`);
          }

          const upSpinner = ora('Levantando servicios...').start();
          try {
            let composeFlags = '-f docker-compose.yml';
            if (fs.existsSync(path.join(targetDir, 'docker-compose.prod.yml'))) {
              composeFlags = '-f docker-compose.prod.yml';
            }

            if (opts.monitoring) {
              const monPath = path.join(targetDir, 'docker-compose.monitoring.yml');
              if (fs.existsSync(monPath)) {
                composeFlags += ' -f docker-compose.monitoring.yml';
              }
            }

            execSync(`${dockerCmd} ${composeFlags} up -d`, {
              cwd: targetDir,
              stdio: 'pipe',
              timeout: 120000,
            });
            upSpinner.succeed('Servicios levantados');
          } catch (err: any) {
            upSpinner.fail('Error: ' + err.message);
          }
        }

        // Install as service
        if (opts.service) {
          const svcSpinner = ora('Instalando servicio systemd...').start();
          try {
            const unitContent = `[Unit]
Description=OpenFactu ERP Platform
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${targetDir}
ExecStart=${dockerCmd} -f docker-compose.yml up -d
ExecStop=${dockerCmd} -f docker-compose.yml down
Restart=on-failure
RestartSec=30

[Install]
WantedBy=multi-user.target
`;
            const tempPath = '/tmp/openfactu.service';
            const unitPath = '/etc/systemd/system/openfactu.service';
            fs.writeFileSync(tempPath, unitContent);
            execSync(`sudo mv ${tempPath} ${unitPath}`, { stdio: 'pipe' });
            execSync('sudo systemctl daemon-reload', { stdio: 'pipe' });
            execSync('sudo systemctl enable openfactu', { stdio: 'pipe' });
            svcSpinner.succeed('Servicio instalado');
          } catch (err: any) {
            svcSpinner.fail('No se pudo instalar el servicio');
          }
        }

        // Summary
        log.blank();
        console.log(chalk.bold.green('  Instalacion rapida completada'));
        console.log(chalk.dim('  ────────────────────────────────────'));
        log.info(`Directorio: ${chalk.cyan(targetDir)}`);
        log.info(`Version: ${chalk.cyan(ref)}`);
        log.blank();
        log.dim('  Comandos utiles:');
        log.dim(`    cd ${targetDir}`);
        log.dim('    openfactu setup');
        log.dim('    openfactu deploy');
        log.dim('    openfactu doctor');
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });
}
