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
import { isSystemdAvailable, getDockerComposeCommand } from '../utils/helpers';

function getServiceName(name: string): string {
  return `openfactu${name !== 'openfactu' ? `-${name}` : ''}`;
}

function generateUnitFile(
  serviceName: string,
  workDir: string,
  composeFile: string,
  options: {
    restartPolicy: string;
    includeMonitoring: boolean;
    monitoringComposeFile?: string;
    user?: string;
    environment?: Record<string, string>;
  },
): string {
  const dockerCmd = getDockerComposeCommand();
  const user = options.user || os.userInfo().username;
  const envFile = path.join(workDir, '.env');

  let composeFlags = `-f ${composeFile}`;
  if (options.includeMonitoring && options.monitoringComposeFile) {
    composeFlags += ` -f ${options.monitoringComposeFile}`;
  }

  let envVars = '';
  if (options.environment) {
    for (const [key, value] of Object.entries(options.environment)) {
      envVars += `Environment="${key}=${value}"\n`;
    }
  }

  return `[Unit]
Description=OpenFactu ${serviceName} Service
After=docker.service network-online.target
Requires=docker.service
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${workDir}
User=${user}
ExecStart=${dockerCmd} ${composeFlags} up -d
ExecStop=${dockerCmd} ${composeFlags} down
ExecReload=${dockerCmd} ${composeFlags} restart
Restart=${options.restartPolicy}
RestartSec=30
TimeoutStartSec=300
TimeoutStopSec=120

${envVars}
EnvironmentFile=${envFile}

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${serviceName}

[Install]
WantedBy=multi-user.target
`;
}

function generateTimerFile(serviceName: string, interval: string): string {
  return `[Unit]
Description=OpenFactu ${serviceName} Health Check Timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=${interval}
Persistent=true

[Install]
WantedBy=timers.target
`;
}

function generateHealthCheckScript(workDir: string): string {
  const dockerCmd = getDockerComposeCommand();
  return `#!/bin/bash
# OpenFactu Health Check Script
set -e

cd "${workDir}"

# Check if containers are running
FAILED=$(${dockerCmd} ps --format '{{.Name}}:{{.Status}}' | grep -v "Up" || true)

if [ -n "$FAILED" ]; then
  echo "$(date): Some containers are not running:"
  echo "$FAILED"
  echo "Attempting restart..."
  ${dockerCmd} restart
  exit 1
fi

echo "$(date): All containers healthy"
exit 0
`;
}

export function registerServiceCommand(program: Command) {
  const serviceCmd = program
    .command('service')
    .description('Gestionar OpenFactu como servicio del sistema');

  serviceCmd
    .command('install')
    .description('Instalar OpenFactu como servicio systemd')
    .option('--name <name>', 'Nombre del servicio', 'openfactu')
    .option('--restart <policy>', 'Politica de reinicio (no, on-failure, always)', 'on-failure')
    .option('--with-monitoring', 'Incluir servicios de monitoreo')
    .option('--healthcheck', 'Agregar health check automatico')
    .option('--healthcheck-interval <interval>', 'Intervalo del health check', '5min')
    .option('--user <user>', 'Usuario para ejecutar el servicio')
    .option('--path <path>', 'Ruta del proyecto OpenFactu')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Instalar Servicio'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      if (!isSystemdAvailable()) {
        log.error('systemd no esta disponible en este sistema');
        log.dim('  Este comando solo funciona en Linux con systemd');
        return;
      }

      try {
        const root = opts.path || getProjectRoot();
        const serviceName = getServiceName(opts.name);

        // Detectar compose files
        const composeFiles = [];
        const possibleFiles = [
          'docker-compose.prod.yml',
          'docker-compose.yml',
        ];
        for (const f of possibleFiles) {
          if (fs.existsSync(path.join(root, f))) {
            composeFiles.push(f);
          }
        }

        if (composeFiles.length === 0) {
          log.error('No se encontro docker-compose.yml en el proyecto');
          return;
        }

        const mainCompose = composeFiles[0];

        // Monitoring
        let includeMonitoring = opts.withMonitoring || false;
        let monitoringCompose: string | undefined;

        if (!includeMonitoring) {
          const { addMonitoring } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'addMonitoring',
              message: 'Incluir stack de monitoreo en el servicio?',
              default: false,
            },
          ]);
          includeMonitoring = addMonitoring;
        }

        if (includeMonitoring) {
          const monFiles = [
            'docker-compose.prod.monitoring.yml',
            'docker-compose.monitoring.yml',
          ];
          for (const f of monFiles) {
            if (fs.existsSync(path.join(root, f))) {
              monitoringCompose = f;
              break;
            }
          }
          if (!monitoringCompose) {
            log.warn('No se encontro compose de monitoreo, se omitira');
          }
        }

        // Confirmar configuracion
        log.blank();
        log.info(`${chalk.dim('Servicio:')} ${chalk.cyan(serviceName)}`);
        log.info(`${chalk.dim('Directorio:')} ${chalk.cyan(root)}`);
        log.info(`${chalk.dim('Compose:')} ${chalk.cyan(mainCompose)}`);
        log.info(`${chalk.dim('Reinicio:')} ${chalk.cyan(opts.restart)}`);
        log.blank();

        const { confirm } = await inquirer.prompt([
          { type: 'confirm', name: 'confirm', message: 'Instalar servicio?', default: true },
        ]);

        if (!confirm) return;

        // Generar unit file
        const spinner = ora('Generando unit file...').start();
        const unitContent = generateUnitFile(serviceName, root, mainCompose, {
          restartPolicy: opts.restart,
          includeMonitoring: includeMonitoring && !!monitoringCompose,
          monitoringComposeFile: monitoringCompose,
          user: opts.user,
        });

        const unitPath = `/etc/systemd/system/${serviceName}.service`;
        const tempPath = `/tmp/${serviceName}.service`;
        fs.writeFileSync(tempPath, unitContent);

        // Instalar con sudo
        execSync(`sudo mv ${tempPath} ${unitPath}`, { stdio: 'pipe' });
        execSync('sudo systemctl daemon-reload', { stdio: 'pipe' });
        spinner.succeed('Unit file instalado');

        // Health check opcional
        if (opts.healthcheck) {
          const hcSpinner = ora('Configurando health check...').start();

          const scriptPath = path.join(root, '.openfactu-healthcheck.sh');
          fs.mkdirSync(path.join(root), { recursive: true });
          fs.writeFileSync(scriptPath, generateHealthCheckScript(root));
          execSync(`chmod +x "${scriptPath}"`, { stdio: 'pipe' });

          const timerName = `${serviceName}-healthcheck`;
          const timerContent = generateTimerFile(serviceName, opts.healthcheckInterval);
          const timerPath = `/etc/systemd/system/${timerName}.timer`;
          const serviceContent = `[Unit]
Description=OpenFactu Health Check

[Service]
Type=oneshot
ExecStart=${scriptPath}
`;
          const servicePath = `/etc/systemd/system/${timerName}.service`;

          fs.writeFileSync(`/tmp/${timerName}.timer`, timerContent);
          fs.writeFileSync(`/tmp/${timerName}.service`, serviceContent);

          execSync(`sudo mv /tmp/${timerName}.timer ${timerPath}`, { stdio: 'pipe' });
          execSync(`sudo mv /tmp/${timerName}.service ${servicePath}`, { stdio: 'pipe' });
          execSync('sudo systemctl daemon-reload', { stdio: 'pipe' });
          execSync(`sudo systemctl enable ${timerName}.timer`, { stdio: 'pipe' });

          hcSpinner.succeed('Health check configurado');
        }

        // Enable service
        const enableSpinner = ora('Habilitando servicio...').start();
        execSync(`sudo systemctl enable ${serviceName}`, { stdio: 'pipe' });
        enableSpinner.succeed('Servicio habilitado');

        log.blank();
        console.log(chalk.bold.green('  Servicio instalado'));
        console.log(chalk.dim('  ────────────────────────────────────'));
        log.blank();
        log.dim('  Comandos utiles:');
        log.dim(`    sudo systemctl start ${serviceName}`);
        log.dim(`    sudo systemctl stop ${serviceName}`);
        log.dim(`    sudo systemctl restart ${serviceName}`);
        log.dim(`    sudo systemctl status ${serviceName}`);
        log.dim(`    journalctl -u ${serviceName} -f`);
        log.blank();

        const { startNow } = await inquirer.prompt([
          { type: 'confirm', name: 'startNow', message: 'Iniciar servicio ahora?', default: true },
        ]);

        if (startNow) {
          const startSpinner = ora('Iniciando servicio...').start();
          try {
            execSync(`sudo systemctl start ${serviceName}`, { stdio: 'pipe' });
            startSpinner.succeed('Servicio iniciado');
          } catch (err: any) {
            startSpinner.fail('Error al iniciar');
            log.dim(`  sudo systemctl status ${serviceName}`);
          }
        }
      } catch (err: any) {
        log.error(err.message);
        process.exitCode = 1;
      }
    });

  serviceCmd
    .command('status')
    .description('Ver estado del servicio')
    .option('--name <name>', 'Nombre del servicio', 'openfactu')
    .action(async (opts) => {
      try {
        const serviceName = getServiceName(opts.name);
        const output = execSync(`systemctl status ${serviceName} 2>&1 || true`, { stdio: 'pipe' }).toString();
        console.log(output);
      } catch (err: any) {
        log.error(err.message);
      }
    });

  serviceCmd
    .command('start')
    .description('Iniciar servicio')
    .option('--name <name>', 'Nombre del servicio', 'openfactu')
    .action(async (opts) => {
      try {
        const serviceName = getServiceName(opts.name);
        const spinner = ora('Iniciando servicio...').start();
        execSync(`sudo systemctl start ${serviceName}`, { stdio: 'pipe' });
        spinner.succeed('Servicio iniciado');
      } catch (err: any) {
        log.error(err.message);
      }
    });

  serviceCmd
    .command('stop')
    .description('Detener servicio')
    .option('--name <name>', 'Nombre del servicio', 'openfactu')
    .action(async (opts) => {
      try {
        const serviceName = getServiceName(opts.name);
        const spinner = ora('Deteniendo servicio...').start();
        execSync(`sudo systemctl stop ${serviceName}`, { stdio: 'pipe' });
        spinner.succeed('Servicio detenido');
      } catch (err: any) {
        log.error(err.message);
      }
    });

  serviceCmd
    .command('restart')
    .description('Reiniciar servicio')
    .option('--name <name>', 'Nombre del servicio', 'openfactu')
    .action(async (opts) => {
      try {
        const serviceName = getServiceName(opts.name);
        const spinner = ora('Reiniciando servicio...').start();
        execSync(`sudo systemctl restart ${serviceName}`, { stdio: 'pipe' });
        spinner.succeed('Servicio reiniciado');
      } catch (err: any) {
        log.error(err.message);
      }
    });

  serviceCmd
    .command('uninstall')
    .description('Remover servicio systemd')
    .option('--name <name>', 'Nombre del servicio', 'openfactu')
    .option('--keep-data', 'Mantener datos del proyecto')
    .action(async (opts) => {
      console.log();
      console.log(chalk.bold.white('  OpenFactu — Remover Servicio'));
      console.log(chalk.dim('  ────────────────────────────────────'));
      console.log();

      try {
        const serviceName = getServiceName(opts.name);

        const { confirm } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirm',
            message: `Remover servicio ${serviceName}?`,
            default: false,
          },
        ]);

        if (!confirm) return;

        const spinner = ora('Removiendo servicio...').start();

        execSync(`sudo systemctl stop ${serviceName} 2>/dev/null || true`, { stdio: 'pipe' });
        execSync(`sudo systemctl disable ${serviceName} 2>/dev/null || true`, { stdio: 'pipe' });

        const unitPath = `/etc/systemd/system/${serviceName}.service`;
        if (fs.existsSync(unitPath)) {
          execSync(`sudo rm ${unitPath}`, { stdio: 'pipe' });
        }

        // Remover health check si existe
        const timerName = `${serviceName}-healthcheck`;
        const timerPath = `/etc/systemd/system/${timerName}.timer`;
        const hcServicePath = `/etc/systemd/system/${timerName}.service`;
        if (fs.existsSync(timerPath)) execSync(`sudo rm ${timerPath}`, { stdio: 'pipe' });
        if (fs.existsSync(hcServicePath)) execSync(`sudo rm ${hcServicePath}`, { stdio: 'pipe' });

        execSync('sudo systemctl daemon-reload', { stdio: 'pipe' });
        spinner.succeed('Servicio removido');

        if (!opts.keepData) {
          const { removeData } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'removeData',
              message: 'Remover tambien los contenedores Docker?',
              default: false,
            },
          ]);

          if (removeData) {
            try {
              const root = getProjectRoot();
              const dockerCmd = getDockerComposeCommand();
              execSync(`${dockerCmd} down`, { cwd: root, stdio: 'pipe' });
              log.success('Contenedores removidos');
            } catch {
              log.warn('No se pudieron remover los contenedores');
            }
          }
        }
      } catch (err: any) {
        log.error(err.message);
      }
    });

  serviceCmd
    .command('logs')
    .description('Ver logs del servicio')
    .option('--name <name>', 'Nombre del servicio', 'openfactu')
    .option('-f, --follow', 'Seguir logs en tiempo real')
    .option('-n, --lines <number>', 'Numero de lineas', '100')
    .action(async (opts) => {
      try {
        const serviceName = getServiceName(opts.name);
        const follow = opts.follow ? ' -f' : '';
        execSync(`journalctl -u ${serviceName}${follow} -n ${opts.lines}`, {
          stdio: 'inherit',
        });
      } catch (err: any) {
        log.error(err.message);
      }
    });
}
