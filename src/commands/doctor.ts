import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../utils/logger';
import { getProjectRoot } from '../utils/paths';
import { runPreflightChecks, checkDiskSpace, getDockerComposeCommand, formatBytes } from '../utils/helpers';

interface DoctorCheck {
  category: string;
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

export function registerDoctorCommand(program: Command) {
  program
    .command('doctor')
    .description('Diagnostico completo del entorno OpenFactu')
    .option('--path <path>', 'Ruta del proyecto')
    .option('--json', 'Salida en formato JSON')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Doctor'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      const checks: DoctorCheck[] = [];

      // System info
      checks.push({
        category: 'Sistema',
        name: 'Plataforma',
        status: 'ok',
        message: `${os.type()} ${os.release()} (${os.arch()})`,
      });

      checks.push({
        category: 'Sistema',
        name: 'Node.js',
        status: 'ok',
        message: process.version,
      });

      checks.push({
        category: 'Sistema',
        name: 'Memoria total',
        status: 'ok',
        message: formatBytes(os.totalmem()),
      });

      checks.push({
        category: 'Sistema',
        name: 'Memoria libre',
        status: 'ok',
        message: formatBytes(os.freemem()),
      });

      // Preflight checks
      const root = opts.path || process.cwd();
      const preflight = runPreflightChecks(root);

      for (const check of preflight) {
        checks.push({
          category: 'Requisitos',
          name: check.name,
          status: check.status === 'pass' ? 'ok' : check.status === 'warn' ? 'warn' : 'error',
          message: check.message,
        });
      }

      // Project structure
      try {
        const projectRoot = getProjectRoot();
        checks.push({
          category: 'Proyecto',
          name: 'Raiz detectada',
          status: 'ok',
          message: projectRoot,
        });

        // Check key files
        const keyFiles = [
          { path: 'package.json', name: 'package.json' },
          { path: 'docker-compose.yml', name: 'docker-compose.yml' },
          { path: '.env', name: '.env' },
          { path: 'apps/web', name: 'apps/web' },
          { path: 'apps/server', name: 'apps/server' },
        ];

        for (const file of keyFiles) {
          const fullPath = path.join(projectRoot, file.path);
          const exists = fs.existsSync(fullPath);
          checks.push({
            category: 'Proyecto',
            name: file.name,
            status: exists ? 'ok' : 'warn',
            message: exists ? 'Presente' : 'No encontrado',
          });
        }

        // Disk usage
        const diskUsage = execSync(`du -sh "${projectRoot}" 2>/dev/null | cut -f1`, { stdio: 'pipe' }).toString().trim();
        checks.push({
          category: 'Proyecto',
          name: 'Tamano del proyecto',
          status: 'ok',
          message: diskUsage,
        });

        // Disk space available
        const disk = checkDiskSpace(projectRoot);
        checks.push({
          category: 'Proyecto',
          name: 'Espacio disponible',
          status: disk.availableGB >= 10 ? 'ok' : disk.availableGB >= 5 ? 'warn' : 'error',
          message: `${disk.availableGB}GB libres de ${disk.totalGB}GB`,
        });
      } catch (err: any) {
        checks.push({
          category: 'Proyecto',
          name: 'Raiz del proyecto',
          status: 'error',
          message: 'No detectado',
        });
      }

      // Docker status
      try {
        const dockerCmd = getDockerComposeCommand();
        const dockerInfo = execSync('docker info --format "{{.ServerVersion}}" 2>/dev/null || echo "unknown"', {
          stdio: 'pipe',
        }).toString().trim();

        checks.push({
          category: 'Docker',
          name: 'Version del servidor',
          status: 'ok',
          message: dockerInfo,
        });

        // Running containers
        const runningContainers = execSync('docker ps --format "{{.Names}}" 2>/dev/null || true', {
          stdio: 'pipe',
        }).toString().trim();

        const containerList = runningContainers ? runningContainers.split('\n') : [];
        checks.push({
          category: 'Docker',
          name: 'Contenedores corriendo',
          status: containerList.length > 0 ? 'ok' : 'warn',
          message: containerList.length > 0 ? containerList.join(', ') : 'Ninguno',
        });

        // Docker images
        const imageCount = execSync('docker images --format "{{.ID}}" 2>/dev/null | wc -l', {
          stdio: 'pipe',
        }).toString().trim();

        const dockerDisk = execSync('docker system df --format "{{.Size}}" 2>/dev/null | head -1 || echo "unknown"', {
          stdio: 'pipe',
        }).toString().trim();

        checks.push({
          category: 'Docker',
          name: 'Imagenes',
          status: 'ok',
          message: `${imageCount} imagenes, ${dockerDisk} en disco`,
        });

        // Docker networks
        const networks = execSync('docker network ls --format "{{.Name}}" 2>/dev/null | grep openfactu || true', {
          stdio: 'pipe',
        }).toString().trim();

        checks.push({
          category: 'Docker',
          name: 'Redes OpenFactu',
          status: networks ? 'ok' : 'warn',
          message: networks || 'Ninguna detectada',
        });

        // Docker volumes
        const volumes = execSync('docker volume ls --format "{{.Name}}" 2>/dev/null | grep openfactu || true', {
          stdio: 'pipe',
        }).toString().trim();

        checks.push({
          category: 'Docker',
          name: 'Volumenes OpenFactu',
          status: volumes ? 'ok' : 'warn',
          message: volumes || 'Ninguno detectado',
        });
      } catch (err: any) {
        checks.push({
          category: 'Docker',
          name: 'Estado',
          status: 'error',
          message: err.message,
        });
      }

      // Services status
      try {
        const projectRoot = getProjectRoot();
        const dockerCmd = getDockerComposeCommand();

        const composeFiles = [
          'docker-compose.prod.yml',
          'docker-compose.yml',
        ];

        for (const composeFile of composeFiles) {
          const composePath = path.join(projectRoot, composeFile);
          if (fs.existsSync(composePath)) {
            try {
              const psOutput = execSync(`${dockerCmd} -f ${composeFile} ps --format json 2>/dev/null || true`, {
                cwd: projectRoot,
                stdio: 'pipe',
              }).toString().trim();

              if (psOutput) {
                const services = psOutput.split('\n').filter(Boolean);
                checks.push({
                  category: 'Servicios',
                  name: composeFile,
                  status: 'ok',
                  message: `${services.length} servicios definidos`,
                });
              }
            } catch {
              checks.push({
                category: 'Servicios',
                name: composeFile,
                status: 'warn',
                message: 'No se pudo obtener estado',
              });
            }
          }
        }
      } catch {}

      // Systemd services
      try {
        const services = execSync('systemctl list-units --type=service --state=running 2>/dev/null | grep openfactu || true', {
          stdio: 'pipe',
        }).toString().trim();

        if (services) {
          checks.push({
            category: 'Systemd',
            name: 'Servicios activos',
            status: 'ok',
            message: services,
          });
        }
      } catch {}

      // Git status
      try {
        const projectRoot = getProjectRoot();
        if (fs.existsSync(path.join(projectRoot, '.git'))) {
          const branch = execSync('git branch --show-current 2>/dev/null || echo "detached"', {
            cwd: projectRoot,
            stdio: 'pipe',
          }).toString().trim();

          const status = execSync('git status --porcelain 2>/dev/null | wc -l', {
            cwd: projectRoot,
            stdio: 'pipe',
          }).toString().trim();

          checks.push({
            category: 'Git',
            name: 'Branch',
            status: 'ok',
            message: branch,
          });

          checks.push({
            category: 'Git',
            name: 'Cambios locales',
            status: parseInt(status) === 0 ? 'ok' : 'warn',
            message: parseInt(status) === 0 ? 'Limpio' : `${status} archivos modificados`,
          });
        }
      } catch {}

      // Display results
      if (opts.json) {
        console.log(JSON.stringify(checks, null, 2));
        return;
      }

      const categories = [...new Set(checks.map(c => c.category))];

      for (const category of categories) {
        const categoryChecks = checks.filter(c => c.category === category);

        console.log(chalk.bold(`  ${category}`));
        console.log(chalk.dim('  ' + '─'.repeat(50)));

        for (const check of categoryChecks) {
          const icon =
            check.status === 'ok'
              ? chalk.green('✓')
              : check.status === 'warn'
                ? chalk.yellow('⚠')
                : chalk.red('✗');

          console.log(`  ${icon} ${chalk.dim(check.name.padEnd(25))} ${check.message}`);
        }

        console.log();
      }

      // Summary
      const errors = checks.filter(c => c.status === 'error');
      const warns = checks.filter(c => c.status === 'warn');

      if (errors.length === 0 && warns.length === 0) {
        console.log(chalk.bold.green('  Todo esta correcto'));
      } else {
        if (errors.length > 0) {
          console.log(chalk.bold.red(`  ${errors.length} error(es) encontrado(s)`));
        }
        if (warns.length > 0) {
          console.log(chalk.bold.yellow(`  ${warns.length} advertencia(s)`));
        }
      }

      console.log();
    });
}
