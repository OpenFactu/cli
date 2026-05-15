import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

function generateMonitoringCompose(services: Set<string>, env: Record<string, string>): string {
  const serviceSet = services;

  let compose = `# OpenFactu Monitoring Stack
services:
`;

  if (serviceSet.has('pgadmin')) {
    compose += `
  pgadmin:
    image: dpage/pgadmin4:latest
    container_name: openfactu-pgadmin
    ports:
      - "\${PGADMIN_PORT:-5050}:80"
`;
  }

  if (serviceSet.has('prometheus')) {
    compose += `
  prometheus:
    image: prom/prometheus:latest
    container_name: openfactu-prometheus
    ports:
      - "\${PROMETHEUS_PORT:-9090}:9090"
`;
  }

  if (serviceSet.has('grafana')) {
    compose += `
  grafana:
    image: grafana/grafana:latest
    container_name: openfactu-grafana
    ports:
      - "\${GRAFANA_PORT:-3001}:3000"
`;
  }

  if (serviceSet.has('loki')) {
    compose += `
  loki:
    image: grafana/loki:latest
    container_name: openfactu-loki
    ports:
      - "\${LOKI_PORT:-3100}:3100"
`;
  }

  if (serviceSet.has('promtail')) {
    compose += `
  promtail:
    image: grafana/promtail:latest
    container_name: openfactu-promtail
`;
  }

  if (serviceSet.has('cadvisor')) {
    compose += `
  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    container_name: openfactu-cadvisor
    ports:
      - "\${CADVISOR_PORT:-8081}:8080"
`;
  }

  if (serviceSet.has('node-exporter')) {
    compose += `
  node-exporter:
    image: prom/node-exporter:latest
    container_name: openfactu-node-exporter
    ports:
      - "\${NODE_EXPORTER_PORT:-9100}:9100"
`;
  }

  if (serviceSet.has('portainer')) {
    compose += `
  portainer:
    image: portainer/portainer-ce:latest
    container_name: openfactu-portainer
    ports:
      - "\${PORTAINER_PORT:-9000}:9000"
`;
  }

  if (serviceSet.has('alertmanager')) {
    compose += `
  alertmanager:
    image: prom/alertmanager:latest
    container_name: openfactu-alertmanager
    ports:
      - "\${ALERTMANAGER_PORT:-9093}:9093"
`;
  }

  compose += `
networks:
  openfactu_net:
    name: openfactu_net
    driver: bridge
`;

  return compose;
}

describe('generateMonitoringCompose', () => {
  it('genera compose valido con servicios basicos', () => {
    const services = new Set(['pgadmin', 'grafana', 'prometheus', 'portainer']);
    const compose = generateMonitoringCompose(services, {});

    expect(compose).toContain('pgadmin:');
    expect(compose).toContain('grafana:');
    expect(compose).toContain('prometheus:');
    expect(compose).toContain('portainer:');
    expect(compose).toContain('openfactu_net');
  });

  it('genera compose con stack completo de analitica', () => {
    const services = new Set([
      'pgadmin', 'grafana', 'prometheus', 'loki',
      'promtail', 'cadvisor', 'node-exporter', 'portainer', 'alertmanager',
    ]);
    const compose = generateMonitoringCompose(services, {});

    expect(compose).toContain('loki:');
    expect(compose).toContain('promtail:');
    expect(compose).toContain('cadvisor:');
    expect(compose).toContain('node-exporter:');
    expect(compose).toContain('alertmanager:');
  });

  it('no incluye servicios no seleccionados', () => {
    const services = new Set(['pgadmin']);
    const compose = generateMonitoringCompose(services, {});

    expect(compose).toContain('pgadmin:');
    expect(compose).not.toContain('grafana:');
    expect(compose).not.toContain('prometheus:');
    expect(compose).not.toContain('loki:');
    expect(compose).not.toContain('cadvisor:');
  });

  it('incluye container_name unico para cada servicio', () => {
    const services = new Set(['pgadmin', 'grafana', 'prometheus']);
    const compose = generateMonitoringCompose(services, {});

    expect(compose).toContain('container_name: openfactu-pgadmin');
    expect(compose).toContain('container_name: openfactu-grafana');
    expect(compose).toContain('container_name: openfactu-prometheus');
  });

  it('genera compose con red definida', () => {
    const services = new Set(['pgadmin']);
    const compose = generateMonitoringCompose(services, {});

    expect(compose).toContain('networks:');
    expect(compose).toContain('openfactu_net');
    expect(compose).toContain('driver: bridge');
  });

  it('genera compose para servicio vacio', () => {
    const services = new Set<string>();
    const compose = generateMonitoringCompose(services, {});

    expect(compose).toContain('services:');
    expect(compose).toContain('networks:');
    expect(compose).not.toContain('container_name:');
  });
});
