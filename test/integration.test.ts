import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import path from 'path';

const cliPath = path.join(__dirname, '..', 'dist', 'bin', 'openfactu.js');

describe('CLI Integration', () => {
  it('muestra ayuda general', () => {
    const output = execSync(`node ${cliPath} --help`, { encoding: 'utf-8' });
    expect(output).toContain('openfactu');
    expect(output).toContain('Commands:');
  });

  it('muestra version', () => {
    const output = execSync(`node ${cliPath} --version`, { encoding: 'utf-8' });
    expect(output.trim()).toMatch(/\d+\.\d+\.\d+/);
  });

  it('muestra ayuda del comando install', () => {
    const output = execSync(`node ${cliPath} install --help`, { encoding: 'utf-8' });
    expect(output).toContain('--tag');
    expect(output).toContain('--branch');
    expect(output).toContain('--mode');
    expect(output).toContain('--generate-env');
    expect(output).toContain('--service');
    expect(output).toContain('--monitoring');
    expect(output).toContain('--with-analytics');
  });

  it('muestra ayuda del comando install:quick', () => {
    const output = execSync(`node ${cliPath} install:quick --help`, { encoding: 'utf-8' });
    expect(output).toContain('--tag');
    expect(output).toContain('--dir');
    expect(output).toContain('--monitoring');
    expect(output).toContain('--analytics');
    expect(output).toContain('--service');
  });

  it('muestra ayuda del comando install:script', () => {
    const output = execSync(`node ${cliPath} install:script --help`, { encoding: 'utf-8' });
    expect(output).toContain('--output');
    expect(output).toContain('--tag');
    expect(output).toContain('--dir');
    expect(output).toContain('--include-monitoring');
    expect(output).toContain('--include-service');
  });

  it('muestra ayuda del comando service', () => {
    const output = execSync(`node ${cliPath} service --help`, { encoding: 'utf-8' });
    expect(output).toContain('install');
    expect(output).toContain('start');
    expect(output).toContain('stop');
    expect(output).toContain('restart');
    expect(output).toContain('status');
    expect(output).toContain('logs');
    expect(output).toContain('uninstall');
  });

  it('muestra ayuda del comando backup', () => {
    const output = execSync(`node ${cliPath} backup --help`, { encoding: 'utf-8' });
    expect(output).toContain('create');
    expect(output).toContain('list');
    expect(output).toContain('restore');
    expect(output).toContain('delete');
  });

  it('muestra ayuda del comando doctor', () => {
    const output = execSync(`node ${cliPath} doctor --help`, { encoding: 'utf-8' });
    expect(output).toContain('--path');
    expect(output).toContain('--json');
  });

  it('muestra ayuda del comando uninstall', () => {
    const output = execSync(`node ${cliPath} uninstall --help`, { encoding: 'utf-8' });
    expect(output).toContain('--path');
    expect(output).toContain('--force');
    expect(output).toContain('--keep-data');
    expect(output).toContain('--keep-backup');
  });

  it('muestra ayuda del comando monitoring', () => {
    const output = execSync(`node ${cliPath} monitoring --help`, { encoding: 'utf-8' });
    expect(output).toContain('--generate-compose');
    expect(output).toContain('--with-analytics');
  });

  it('muestra ayuda del comando monitoring:generate', () => {
    const output = execSync(`node ${cliPath} monitoring:generate --help`, { encoding: 'utf-8' });
    expect(output).toContain('--services');
    expect(output).toContain('--analytics');
  });

  it('muestra ayuda del comando deploy', () => {
    const output = execSync(`node ${cliPath} deploy --help`, { encoding: 'utf-8' });
    expect(output).toContain('--with-monitoring');
  });

  it('lista todos los comandos principales', () => {
    const output = execSync(`node ${cliPath} --help`, { encoding: 'utf-8' });

    const expectedCommands = [
      'install',
      'install:quick',
      'install:script',
      'uninstall',
      'service',
      'backup',
      'doctor',
      'monitoring',
      'deploy',
      'setup',
      'migrate',
      'tenant',
      'plugin',
      'update',
      'version',
    ];

    for (const cmd of expectedCommands) {
      expect(output).toContain(cmd);
    }
  });
});
