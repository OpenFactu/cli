import { describe, it, expect } from 'vitest';

function generatePrometheusConfig(): string {
  return `global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']

  - job_name: 'cadvisor'
    static_configs:
      - targets: ['cadvisor:8080']

  - job_name: 'openfactu-server'
    metrics_path: '/api/metrics'
    static_configs:
      - targets: ['server:3000']
`;
}

function generateLokiConfig(): string {
  return `auth_enabled: false

server:
  http_listen_port: 3100

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2020-10-24
      store: boltdb-shipper
      object_store: filesystem
      schema: v11
      index:
        prefix: index_
        period: 24h

limits_config:
  reject_old_samples: true
  reject_old_samples_max_age: 168h
`;
}

function generatePromtailConfig(): string {
  return `server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /tmp/positions.yaml

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  - job_name: openfactu-logs
    static_configs:
      - targets:
          - localhost
        labels:
          job: openfactu
          __path__: /app/storage/**/*.log
`;
}

describe('generatePrometheusConfig', () => {
  it('genera configuracion YAML valida', () => {
    const config = generatePrometheusConfig();
    expect(config).toContain('global:');
    expect(config).toContain('scrape_configs:');
  });

  it('incluye scrape interval', () => {
    const config = generatePrometheusConfig();
    expect(config).toContain('scrape_interval: 15s');
  });

  it('incluye job para prometheus', () => {
    const config = generatePrometheusConfig();
    expect(config).toContain("job_name: 'prometheus'");
    expect(config).toContain('localhost:9090');
  });

  it('incluye job para node-exporter', () => {
    const config = generatePrometheusConfig();
    expect(config).toContain("job_name: 'node-exporter'");
    expect(config).toContain('node-exporter:9100');
  });

  it('incluye job para cadvisor', () => {
    const config = generatePrometheusConfig();
    expect(config).toContain("job_name: 'cadvisor'");
    expect(config).toContain('cadvisor:8080');
  });

  it('incluye job para openfactu-server', () => {
    const config = generatePrometheusConfig();
    expect(config).toContain("job_name: 'openfactu-server'");
    expect(config).toContain('/api/metrics');
    expect(config).toContain('server:3000');
  });
});

describe('generateLokiConfig', () => {
  it('genera configuracion YAML valida', () => {
    const config = generateLokiConfig();
    expect(config).toContain('auth_enabled: false');
    expect(config).toContain('server:');
  });

  it('configura puerto 3100', () => {
    const config = generateLokiConfig();
    expect(config).toContain('http_listen_port: 3100');
  });

  it('configura almacenamiento en filesystem', () => {
    const config = generateLokiConfig();
    expect(config).toContain('chunks_directory: /loki/chunks');
  });

  it('configura schema boltdb-shipper', () => {
    const config = generateLokiConfig();
    expect(config).toContain('store: boltdb-shipper');
    expect(config).toContain('schema: v11');
  });

  it('configura retencion de samples', () => {
    const config = generateLokiConfig();
    expect(config).toContain('reject_old_samples: true');
    expect(config).toContain('reject_old_samples_max_age: 168h');
  });
});

describe('generatePromtailConfig', () => {
  it('genera configuracion YAML valida', () => {
    const config = generatePromtailConfig();
    expect(config).toContain('server:');
    expect(config).toContain('clients:');
  });

  it('configura conexion a Loki', () => {
    const config = generatePromtailConfig();
    expect(config).toContain('url: http://loki:3100/loki/api/v1/push');
  });

  it('configura scrape de logs de openfactu', () => {
    const config = generatePromtailConfig();
    expect(config).toContain('job_name: openfactu-logs');
    expect(config).toContain('job: openfactu');
  });

  it('configura path de logs', () => {
    const config = generatePromtailConfig();
    expect(config).toContain('/app/storage/**/*.log');
  });
});
