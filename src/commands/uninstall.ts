import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { log } from '../utils/logger';
import { getProjectRoot } from '../utils/paths';
import { getDockerComposeCommand, timestamp, copyDirRecursive, ensureDir } from '../utils/helpers';

export function registerUninstallCommand(program: Command) {
  program
    .command('uninstall')
    .description('Desinstalar OpenFactu de forma limpia')
    .option('--path <path>', 'Ruta del proyecto a desinstalar')
    .option('--force', 'No preguntar confirmacion')
    .option('--keep-data', 'Mantener datos (BD, storage, configs)')
    .option('--keep-backup', 'Crear backup antes de desinstalar')
    .option('--remove-global', 'Remover CLI global tambien')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Desinstalacion'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        const root = opts.path || getProjectRoot();

        if (!fs.existsSync(root)) {
          log.error(`Directorio no encontrado: ${root}`);
          return;
        }

        // Verificar que es un proyecto OpenFactu
        const pkgPath = path.join(root, 'package.json');
        if (!fs.existsSync(pkgPath)) {
          log.error('No parece ser un proyecto OpenFactu valido');
          return;
        }

        if (!opts.force) {
          log.warn(`${chalk.red('ADVERTENCIA:')} Esta accion es destructiva`);
          log.blank();
          log.info(`Proyecto: ${chalk.cyan(root)}`);

          const diskUsage = execSync(`du -sh "${root}" 2>/dev/null | cut -f1`, { stdio: 'pipe' }).toString().trim();
          log.info(`Tamano: ${chalk.cyan(diskUsage)}`);
          log.blank();

          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: chalk.red('Estas seguro? Esta accion no se puede deshacer'),
              default: false,
            },
          ]);

          if (!confirm) {
            log.info('Desinstalacion cancelada');
            return;
          }
        }

        // Backup opcional
        if (opts.keepBackup) {
          const backupDir = path.join(os.homedir(), 'openfactu-backups', `backup-${timestamp()}`);
          const backupSpinner = ora('Creando backup...').start();

          try {
            ensureDir(backupDir);

            const dirsToBackup = ['storage', '.env', 'docker-compose*.yml', 'monitoring'];
            for (const item of dirsToBackup) {
              const src = path.join(root, item);
              if (fs.existsSync(src)) {
                const dest = path.join(backupDir, path.basename(item));
                if (fs.statSync(src).isDirectory()) {
                  copyDirRecursive(src, dest);
                } else {
                  fs.copyFileSync(src, dest);
                }
              }
            }

            // Database backup
            const dockerCmd = getDockerComposeCommand();
            const dbBackupPath = path.join(backupDir, 'database.sql');
            execSync(`${dockerCmd} exec -T db pg_dump -U openfactu openfactudb > "${dbBackupPath}" 2>/dev/null || true`, {
              stdio: 'pipe',
            });

            backupSpinner.succeed(`Backup creado: ${chalk.cyan(backupDir)}`);
          } catch (err: any) {
            backupSpinner.warn('Backup parcial (algunos archivos no se pudieron copiar)');
          }
        }

        // Parar servicios Docker
        const dockerSpinner = ora('Parando servicios Docker...').start();
        try {
          const dockerCmd = getDockerComposeCommand();

          const composeFiles = [];
          const possibleFiles = [
            'docker-compose.prod.yml',
            'docker-compose.prod.monitoring.yml',
            'docker-compose.monitoring.yml',
            'docker-compose.yml',
          ];
          for (const f of possibleFiles) {
            if (fs.existsSync(path.join(root, f))) {
              composeFiles.push(f);
            }
          }

          if (composeFiles.length > 0) {
            const fileFlags = composeFiles.map(f => `-f ${f}`).join(' ');
            execSync(`${dockerCmd} ${fileFlags} down -v`, { cwd: root, stdio: 'pipe' });
          }

          // Remover imagenes del proyecto
          try {
            execSync(`${dockerCmd} -f docker-compose.yml rm -f 2>/dev/null || true`, { cwd: root, stdio: 'pipe' });
          } catch {}

          dockerSpinner.succeed('Servicios parados');
        } catch {
          dockerSpinner.warn('No se pudieron parar todos los servicios');
        }

        // Remover servicio systemd si existe
        const serviceSpinner = ora('Verificando servicios systemd...').start();
        try {
          const services = ['openfactu', 'openfactu-platform'];
          for (const svc of services) {
            const unitPath = `/etc/systemd/system/${svc}.service`;
            if (fs.existsSync(unitPath)) {
              execSync(`sudo systemctl stop ${svc} 2>/dev/null || true`, { stdio: 'pipe' });
              execSync(`sudo systemctl disable ${svc} 2>/dev/null || true`, { stdio: 'pipe' });
              execSync(`sudo rm ${unitPath}`, { stdio: 'pipe' });
              log.info(`Servicio ${svc} removido`);
            }
          }
          execSync('sudo systemctl daemon-reload 2>/dev/null || true', { stdio: 'pipe' });
          serviceSpinner.succeed('Servicios systemd verificados');
        } catch {
          serviceSpinner.warn('No se encontraron servicios systemd');
        }

        // Remover archivos
        if (!opts.keepData) {
          const removeSpinner = ora('Removiendo archivos del proyecto...').start();
          try {
            // Remover directorios grandes primero
            const largeDirs = ['node_modules', 'storage', '.git'];
            for (const dir of largeDirs) {
              const dirPath = path.join(root, dir);
              if (fs.existsSync(dirPath)) {
                execSync(`rm -rf "${dirPath}"`, { stdio: 'pipe' });
              }
            }

            // Remover resto
            execSync(`rm -rf "${root}"`, { stdio: 'pipe' });
            removeSpinner.succeed('Archivos removidos');
          } catch (err: any) {
            removeSpinner.fail('Error al remover archivos');
            log.dim(`  Remueve manualmente: rm -rf ${root}`);
          }
        } else {
          log.info('Datos mantenidos en: ' + chalk.cyan(root));
        }

        // Remover CLI global
        if (opts.removeGlobal) {
          const cliSpinner = ora('Removiendo CLI global...').start();
          try {
            execSync('npm uninstall -g @openfactu/cli', { stdio: 'pipe' });
            cliSpinner.succeed('CLI global removido');
          } catch {
            cliSpinner.warn('No se pudo remover el CLI global');
            log.dim('  Ejecuta: npm uninstall -g @openfactu/cli');
          }
        }

        log.blank();
        console.log(chalk.bold.green('  Desinstalacion completada'));
        console.log(chalk.dim('  ────────────────────────────────────'));
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });
}
