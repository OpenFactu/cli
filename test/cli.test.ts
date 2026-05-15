import { describe, it, expect } from 'vitest';
import { createCLI } from '../src/index';
import { Command } from 'commander';

describe('CLI', () => {
  let cli: Command;

  beforeEach(() => {
    cli = createCLI();
  });

  it('crea el CLI correctamente', () => {
    expect(cli).toBeDefined();
    expect(cli.name()).toBe('openfactu');
  });

  it('tiene version definida', () => {
    expect(cli.version()).toBeDefined();
  });

  it('registra comando install', () => {
    const cmd = cli.commands.find(c => c.name() === 'install');
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toContain('Descarga e instala');
  });

  it('registra comando install:quick', () => {
    const cmd = cli.commands.find(c => c.name() === 'install:quick');
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toContain('rapida');
  });

  it('registra comando install:script', () => {
    const cmd = cli.commands.find(c => c.name() === 'install:script');
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toContain('script');
  });

  it('registra comando uninstall', () => {
    const cmd = cli.commands.find(c => c.name() === 'uninstall');
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toContain('Desinstalar');
  });

  it('registra comando doctor', () => {
    const cmd = cli.commands.find(c => c.name() === 'doctor');
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toContain('Diagnostico');
  });

  it('registra comando service como comando con subcomandos', () => {
    const cmd = cli.commands.find(c => c.name() === 'service');
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toContain('servicio');
  });

  it('registra comando backup como comando con subcomandos', () => {
    const cmd = cli.commands.find(c => c.name() === 'backup');
    expect(cmd).toBeDefined();
    expect(cmd?.description()).toContain('Backup');
  });

  it('registra comando monitoring', () => {
    const cmd = cli.commands.find(c => c.name() === 'monitoring');
    expect(cmd).toBeDefined();
  });

  it('registra comando monitoring:up', () => {
    const cmd = cli.commands.find(c => c.name() === 'monitoring:up');
    expect(cmd).toBeDefined();
  });

  it('registra comando monitoring:down', () => {
    const cmd = cli.commands.find(c => c.name() === 'monitoring:down');
    expect(cmd).toBeDefined();
  });

  it('registra comando monitoring:status', () => {
    const cmd = cli.commands.find(c => c.name() === 'monitoring:status');
    expect(cmd).toBeDefined();
  });

  it('registra comando monitoring:generate', () => {
    const cmd = cli.commands.find(c => c.name() === 'monitoring:generate');
    expect(cmd).toBeDefined();
  });

  it('registra comando deploy', () => {
    const cmd = cli.commands.find(c => c.name() === 'deploy');
    expect(cmd).toBeDefined();
  });

  it('registra comando deploy:status', () => {
    const cmd = cli.commands.find(c => c.name() === 'deploy:status');
    expect(cmd).toBeDefined();
  });

  it('registra comando setup', () => {
    const cmd = cli.commands.find(c => c.name() === 'setup');
    expect(cmd).toBeDefined();
  });

  it('registra comando migrate', () => {
    const cmd = cli.commands.find(c => c.name() === 'migrate');
    expect(cmd).toBeDefined();
  });

  it('registra comando tenant', () => {
    const cmd = cli.commands.find(c => c.name() === 'tenant');
    expect(cmd).toBeDefined();
  });

  it('registra comando plugin', () => {
    const cmd = cli.commands.find(c => c.name() === 'plugin');
    expect(cmd).toBeDefined();
  });

  it('registra comando update', () => {
    const cmd = cli.commands.find(c => c.name() === 'update');
    expect(cmd).toBeDefined();
  });

  it('registra comando version', () => {
    const cmd = cli.commands.find(c => c.name() === 'version');
    expect(cmd).toBeDefined();
  });

  it('registra comando rebuild', () => {
    const cmd = cli.commands.find(c => c.name() === 'rebuild');
    expect(cmd).toBeDefined();
  });

  it('registra comando logs', () => {
    const cmd = cli.commands.find(c => c.name() === 'logs');
    expect(cmd).toBeDefined();
  });

  it('registra comando stop', () => {
    const cmd = cli.commands.find(c => c.name() === 'stop');
    expect(cmd).toBeDefined();
  });

  it('registra comando restart', () => {
    const cmd = cli.commands.find(c => c.name() === 'restart');
    expect(cmd).toBeDefined();
  });

  it('tiene al menos 25 comandos registrados', () => {
    expect(cli.commands.length).toBeGreaterThanOrEqual(25);
  });
});
