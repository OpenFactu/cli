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
import { getDockerComposeCommand, timestamp, ensureDir } from '../utils/helpers';

function getBackupDir(): string {
  return path.join(os.homedir(), 'openfactu-backups');
}

function listBackups(): { name: string; path: string; date: string; size: string }[] {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) return [];

  const entries = fs.readdirSync(backupDir, { withFileTypes: true });
  const backups: { name: string; path: string; date: string; size: string }[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const fullPath = path.join(backupDir, entry.name);
      const stat = fs.statSync(fullPath);
      const size = execSync(`du -sh "${fullPath}" 2>/dev/null | cut -f1`, { stdio: 'pipe' }).toString().trim();
      backups.push({
        name: entry.name,
        path: fullPath,
        date: stat.mtime.toLocaleString('es-ES'),
        size,
      });
    }
  }

  return backups.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function registerBackupCommand(program: Command) {
  const backupCmd = program
    .command('backup')
    .description('Backup y restore de OpenFactu');

  backupCmd
    .command('create')
    .description('Crear backup completo')
    .option('--name <name>', 'Nombre del backup')
    .option('--db-only', 'Solo backup de base de datos')
    .option('--config-only', 'Solo backup de configuracion')
    .option('--path <path>', 'Ruta del proyecto')
    .option('--output <dir>', 'Directorio de salida')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Crear Backup'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        const root = opts.path || getProjectRoot();
        const dockerCmd = getDockerComposeCommand();

        const backupName = opts.name || `backup-${timestamp()}`;
        const outputDir = opts.output || getBackupDir();
        const backupPath = path.join(outputDir, backupName);

        ensureDir(outputDir);
        ensureDir(backupPath);

        const dbOnly = opts.dbOnly || false;
        const configOnly = opts.configOnly || false;

        // Database backup
        if (!configOnly) {
          const dbSpinner = ora('Backup de base de datos...').start();
          try {
            const dbBackupPath = path.join(backupPath, 'database.sql');

            const dbContainer = execSync(`${dockerCmd} ps --format '{{.Names}}' | grep db || true`, {
              cwd: root,
              stdio: 'pipe',
            }).toString().trim();

            if (dbContainer) {
              execSync(
                `${dockerCmd} exec -T ${dbContainer} pg_dump -U openfactu openfactudb > "${dbBackupPath}"`,
                { cwd: root, stdio: 'pipe', timeout: 300000 },
              );

              const dbSize = fs.statSync(dbBackupPath).size;
              dbSpinner.succeed(`BD backup: ${(dbSize / 1024 / 1024).toFixed(2)}MB`);
            } else {
              dbSpinner.warn('Contenedor de BD no encontrado');
            }
          } catch (err: any) {
            dbSpinner.fail('Error en backup de BD: ' + err.message);
          }
        }

        // Config backup
        if (!dbOnly) {
          const configSpinner = ora('Backup de configuracion...').start();
          try {
            const configFiles = [
              '.env',
              'docker-compose.yml',
              'docker-compose.prod.yml',
              'docker-compose.prod.monitoring.yml',
              'docker-compose.monitoring.yml',
            ];

            for (const file of configFiles) {
              const src = path.join(root, file);
              if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(backupPath, file));
              }
            }

            // Monitoring configs
            const monitoringDir = path.join(root, 'monitoring');
            if (fs.existsSync(monitoringDir)) {
              const dest = path.join(backupPath, 'monitoring');
              execSync(`cp -r "${monitoringDir}" "${dest}"`, { stdio: 'pipe' });
            }

            configSpinner.succeed('Configuracion respaldada');
          } catch (err: any) {
            configSpinner.fail('Error en backup de config: ' + err.message);
          }
        }

        // Storage backup (optional, can be large)
        if (!dbOnly && !configOnly) {
          const { backupStorage } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'backupStorage',
              message: 'Incluir storage (archivos, documentos)? Puede ser grande',
              default: false,
            },
          ]);

          if (backupStorage) {
            const storageSpinner = ora('Backup de storage...').start();
            try {
              const storageSrc = path.join(root, 'storage');
              if (fs.existsSync(storageSrc)) {
                const storageDest = path.join(backupPath, 'storage');
                execSync(`cp -r "${storageSrc}" "${storageDest}"`, { stdio: 'pipe', timeout: 300000 });
                const size = execSync(`du -sh "${storageDest}" | cut -f1`, { stdio: 'pipe' }).toString().trim();
                storageSpinner.succeed(`Storage backup: ${size}`);
              } else {
                storageSpinner.warn('Directorio storage no encontrado');
              }
            } catch (err: any) {
              storageSpinner.fail('Error en backup de storage');
            }
          }
        }

        // Create manifest
        const manifest = {
          name: backupName,
          date: new Date().toISOString(),
          project: root,
          dbOnly,
          configOnly,
          files: fs.readdirSync(backupPath),
        };
        fs.writeFileSync(path.join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2));

        const totalSize = execSync(`du -sh "${backupPath}" | cut -f1`, { stdio: 'pipe' }).toString().trim();

        log.blank();
        console.log(chalk.bold.green('  Backup completado'));
        console.log(chalk.dim('  ────────────────────────────────────'));
        log.info(`Nombre: ${chalk.cyan(backupName)}`);
        log.info(`Ubicacion: ${chalk.cyan(backupPath)}`);
        log.info(`Tamano: ${chalk.cyan(totalSize)}`);
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });

  backupCmd
    .command('list')
    .description('Listar backups disponibles')
    .action(async () => {
      try {
        const backups = listBackups();

        if (backups.length === 0) {
          log.info('No hay backups disponibles');
          return;
        }

        console.log();
        console.log(chalk.bold.white('  OpenFactu — Backups'));
        console.log(chalk.dim('  ────────────────────────────────────'));
        console.log();

        for (const backup of backups) {
          console.log(`  ${chalk.cyan(backup.name)}`);
          console.log(`    ${chalk.dim('Fecha:')} ${backup.date}`);
          console.log(`    ${chalk.dim('Tamano:')} ${backup.size}`);
          console.log(`    ${chalk.dim('Ruta:')} ${chalk.dim(backup.path)}`);
          console.log();
        }
      } catch (err: any) {
        log.error(err.message);
      }
    });

  backupCmd
    .command('restore')
    .description('Restaurar desde un backup')
    .option('--name <name>', 'Nombre del backup a restaurar')
    .option('--path <path>', 'Ruta del proyecto destino')
    .option('--db-only', 'Solo restaurar base de datos')
    .option('--config-only', 'Solo restaurar configuracion')
    .option('--force', 'No preguntar confirmacion')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Restaurar Backup'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        const backups = listBackups();
        if (backups.length === 0) {
          log.error('No hay backups disponibles');
          return;
        }

        let backupPath: string;

        if (opts.name) {
          const backup = backups.find(b => b.name === opts.name);
          if (!backup) {
            log.error(`Backup no encontrado: ${opts.name}`);
            return;
          }
          backupPath = backup.path;
        } else {
          const choices = backups.map(b => ({
            name: `${chalk.cyan(b.name)} ${chalk.dim(`(${b.date}, ${b.size})`)}`,
            value: b.path,
          }));

          const { selected } = await inquirer.prompt([
            {
              type: 'list',
              name: 'selected',
              message: 'Selecciona el backup a restaurar:',
              choices,
            },
          ]);
          backupPath = selected;
        }

        const root = opts.path || getProjectRoot();
        const dockerCmd = getDockerComposeCommand();
        const dbOnly = opts.dbOnly || false;
        const configOnly = opts.configOnly || false;

        if (!opts.force) {
          log.info(`Backup: ${chalk.cyan(backupPath)}`);
          log.info(`Destino: ${chalk.cyan(root)}`);
          log.blank();

          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: 'Restaurar backup? Esto puede sobrescribir datos existentes',
              default: false,
            },
          ]);

          if (!confirm) return;
        }

        // Restore database
        if (!configOnly) {
          const dbBackup = path.join(backupPath, 'database.sql');
          if (fs.existsSync(dbBackup)) {
            const dbSpinner = ora('Restaurando base de datos...').start();
            try {
              const dbContainer = execSync(`${dockerCmd} ps --format '{{.Names}}' | grep db || true`, {
                cwd: root,
                stdio: 'pipe',
              }).toString().trim();

              if (dbContainer) {
                execSync(
                  `${dockerCmd} exec -T ${dbContainer} psql -U openfactu openfactudb < "${dbBackup}"`,
                  { cwd: root, stdio: 'pipe', timeout: 300000 },
                );
                dbSpinner.succeed('Base de datos restaurada');
              } else {
                dbSpinner.warn('Contenedor de BD no encontrado');
              }
            } catch (err: any) {
              dbSpinner.fail('Error al restaurar BD');
            }
          }
        }

        // Restore config
        if (!dbOnly) {
          const configSpinner = ora('Restaurando configuracion...').start();
          try {
            const configFiles = [
              '.env',
              'docker-compose.yml',
              'docker-compose.prod.yml',
              'docker-compose.prod.monitoring.yml',
              'docker-compose.monitoring.yml',
            ];

            for (const file of configFiles) {
              const src = path.join(backupPath, file);
              if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(root, file));
              }
            }

            const monitoringSrc = path.join(backupPath, 'monitoring');
            if (fs.existsSync(monitoringSrc)) {
              const monitoringDest = path.join(root, 'monitoring');
              execSync(`cp -r "${monitoringSrc}" "${monitoringDest}"`, { stdio: 'pipe' });
            }

            configSpinner.succeed('Configuracion restaurada');
          } catch (err: any) {
            configSpinner.fail('Error al restaurar config');
          }
        }

        // Restore storage
        const storageSrc = path.join(backupPath, 'storage');
        if (fs.existsSync(storageSrc)) {
          const { restoreStorage } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'restoreStorage',
              message: 'Restaurar storage?',
              default: false,
            },
          ]);

          if (restoreStorage) {
            const storageSpinner = ora('Restaurando storage...').start();
            try {
              const storageDest = path.join(root, 'storage');
              execSync(`cp -r "${storageSrc}"/* "${storageDest}/" 2>/dev/null || cp -r "${storageSrc}" "${storageDest}"`, {
                stdio: 'pipe',
                timeout: 300000,
              });
              storageSpinner.succeed('Storage restaurado');
            } catch {
              storageSpinner.fail('Error al restaurar storage');
            }
          }
        }

        log.blank();
        console.log(chalk.bold.green('  Restauracion completada'));
        console.log(chalk.dim('  ────────────────────────────────────'));
        log.dim('  Reinicia los servicios con: openfactu restart');
        log.blank();
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });

  backupCmd
    .command('delete')
    .description('Eliminar un backup')
    .option('--name <name>', 'Nombre del backup')
    .option('--all', 'Eliminar todos los backups')
    .option('--force', 'No preguntar confirmacion')
    .action(async (opts) => {
      try {
        const backups = listBackups();
        if (backups.length === 0) {
          log.info('No hay backups para eliminar');
          return;
        }

        if (opts.all) {
          if (!opts.force) {
            const { confirm } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'confirm',
                message: `Eliminar ${backups.length} backups?`,
                default: false,
              },
            ]);
            if (!confirm) return;
          }

          const spinner = ora('Eliminando todos los backups...').start();
          execSync(`rm -rf "${getBackupDir()}"`, { stdio: 'pipe' });
          spinner.succeed('Todos los backups eliminados');
        } else {
          let backupPath: string;

          if (opts.name) {
            const backup = backups.find(b => b.name === opts.name);
            if (!backup) {
              log.error(`Backup no encontrado: ${opts.name}`);
              return;
            }
            backupPath = backup.path;
          } else {
            const choices = backups.map(b => ({
              name: `${chalk.cyan(b.name)} ${chalk.dim(`(${b.date}, ${b.size})`)}`,
              value: b.path,
            }));

            const { selected } = await inquirer.prompt([
              {
                type: 'list',
                name: 'selected',
                message: 'Selecciona el backup a eliminar:',
                choices,
              },
            ]);
            backupPath = selected;
          }

          if (!opts.force) {
            const { confirm } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'confirm',
                message: `Eliminar backup ${path.basename(backupPath)}?`,
                default: false,
              },
            ]);
            if (!confirm) return;
          }

          const spinner = ora('Eliminando backup...').start();
          execSync(`rm -rf "${backupPath}"`, { stdio: 'pipe' });
          spinner.succeed('Backup eliminado');
        }
      } catch (err: any) {
        log.error(err.message);
      }
    });
}
