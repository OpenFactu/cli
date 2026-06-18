import { Command } from 'commander';
import { registerVersionCommand } from './commands/version';
import { registerMigrateCommand } from './commands/migrate';
import { registerTenantCommand } from './commands/tenant';
import { registerPluginCommand } from './commands/plugin';
import { registerSetupCommand } from './commands/setup';
import { registerUpdateCommand } from './commands/update';
import { registerInstallCommand } from './commands/install';
import { registerDeployCommand } from './commands/deploy';
import { registerMonitoringCommand } from './commands/monitoring';
import { registerServiceCommand } from './commands/service';
import { registerUninstallCommand } from './commands/uninstall';
import { registerBackupCommand } from './commands/backup';
import { registerDoctorCommand } from './commands/doctor';
import { registerInstallQuickCommand } from './commands/install-quick';
import { registerInstallScriptCommand } from './commands/install-script';
import { registerSyncPortsCommand } from './commands/sync-ports';

export function createCLI() {
  const program = new Command();

  program
    .name('openfactu')
    .description('CLI para gestionar OpenFactu')
    .version('0.0.7');

  registerVersionCommand(program);
  registerMigrateCommand(program);
  registerTenantCommand(program);
  registerPluginCommand(program);
  registerSetupCommand(program);
  registerUpdateCommand(program);
  registerInstallCommand(program);
  registerInstallQuickCommand(program);
  registerInstallScriptCommand(program);
  registerSyncPortsCommand(program);
  registerDeployCommand(program);
  registerMonitoringCommand(program);
  registerServiceCommand(program);
  registerUninstallCommand(program);
  registerBackupCommand(program);
  registerDoctorCommand(program);

  return program;
}
