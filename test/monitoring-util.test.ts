import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  ALL_MONITORING_SERVICES,
  MONITORING_CATALOG,
  monitoringChoices,
  basicMonitoringServices,
  fullMonitoringServices,
  generateMonitoringCompose,
  writeMonitoringConfigs,
} from '../src/utils/monitoring';

describe('catálogo de monitoreo', () => {
  it('básico = pgAdmin, Grafana, Prometheus, Portainer', () => {
    expect(basicMonitoringServices().sort()).toEqual(
      ['grafana', 'pgadmin', 'portainer', 'prometheus'].sort(),
    );
  });

  it('completo = básico + analítica (sin alertmanager)', () => {
    const full = fullMonitoringServices();
    expect(full).toContain('loki');
    expect(full).toContain('cadvisor');
    expect(full).toContain('node-exporter');
    expect(full).not.toContain('alertmanager');
  });

  it('ALL_MONITORING_SERVICES cubre todo el catálogo', () => {
    expect(ALL_MONITORING_SERVICES).toHaveLength(MONITORING_CATALOG.length);
  });
});

describe('monitoringChoices', () => {
  it('marca el set básico por defecto y deja la analítica sin marcar', () => {
    const choices = monitoringChoices();
    const checked = choices.filter((c) => c.checked).map((c) => c.value);
    expect(checked.sort()).toEqual(['grafana', 'pgadmin', 'portainer', 'prometheus'].sort());
  });

  it('con analytics marca también loki/promtail/cadvisor/node-exporter', () => {
    const checked = monitoringChoices({ analytics: true }).filter((c) => c.checked).map((c) => c.value);
    for (const s of ['loki', 'promtail', 'cadvisor', 'node-exporter']) {
      expect(checked).toContain(s);
    }
  });
});

describe('generateMonitoringCompose', () => {
  it('incluye solo los servicios seleccionados', () => {
    const compose = generateMonitoringCompose(new Set(['grafana', 'prometheus']));
    expect(compose).toContain('  grafana:');
    expect(compose).toContain('  prometheus:');
    expect(compose).not.toContain('  pgadmin:');
    expect(compose).not.toContain('  portainer:');
    expect(compose).not.toContain('  loki:');
  });

  it('siempre declara la red openfactu_net', () => {
    const compose = generateMonitoringCompose(new Set(['pgadmin']));
    expect(compose).toContain('networks:');
    expect(compose).toContain('openfactu_net');
  });

  it('un set vacío genera compose sin servicios pero válido en estructura', () => {
    const compose = generateMonitoringCompose(new Set());
    expect(compose).toContain('services:');
    expect(compose).toContain('openfactu_net');
  });

  it('depends_on solo referencia servicios seleccionados (no rompe con subconjuntos)', () => {
    // Grafana sin Loki: no debe depender de un servicio ausente.
    const sinLoki = generateMonitoringCompose(new Set(['grafana', 'prometheus']));
    expect(sinLoki).toContain('      - prometheus');
    expect(sinLoki).not.toMatch(/depends_on:[\s\S]*?- loki/);

    // Grafana con Loki: sí lo incluye.
    const conLoki = generateMonitoringCompose(new Set(['grafana', 'prometheus', 'loki']));
    expect(conLoki).toMatch(/grafana:[\s\S]*?depends_on:[\s\S]*?- loki/);
  });
});

describe('writeMonitoringConfigs', () => {
  it('genera la config de cada servicio con archivo montado (incl. alertmanager)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofmon-'));
    try {
      writeMonitoringConfigs(dir, new Set(['prometheus', 'loki', 'promtail', 'alertmanager', 'grafana']));
      expect(fs.existsSync(path.join(dir, 'monitoring/prometheus/prometheus.yml'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'monitoring/loki/loki-config.yaml'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'monitoring/promtail/promtail-config.yaml'))).toBe(true);
      // El que causaba el fallo de mount: debe existir como ARCHIVO.
      const am = path.join(dir, 'monitoring/alertmanager/alertmanager.yml');
      expect(fs.existsSync(am)).toBe(true);
      expect(fs.statSync(am).isFile()).toBe(true);
      // Directorio de provisioning de grafana creado.
      expect(fs.existsSync(path.join(dir, 'monitoring/grafana/provisioning'))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('no genera configs de servicios no seleccionados', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ofmon-'));
    try {
      writeMonitoringConfigs(dir, new Set(['pgadmin']));
      expect(fs.existsSync(path.join(dir, 'monitoring/alertmanager/alertmanager.yml'))).toBe(false);
      expect(fs.existsSync(path.join(dir, 'monitoring/prometheus/prometheus.yml'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
