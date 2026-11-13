import client from 'prom-client';

export const metricsRegistry = new client.Registry();
client.collectDefaultMetrics({ register: metricsRegistry });

export const gradingQueueDepthGauge = new client.Gauge({
  name: 'mathlens_grading_queue_depth',
  help: 'Current number of waiting/active jobs in grading queue',
  registers: [metricsRegistry],
});

export const gradingLatencyHistogram = new client.Histogram({
  name: 'mathlens_grading_latency_seconds',
  help: 'End-to-end AI essay grading latency in seconds',
  buckets: [1, 2, 5, 10, 20, 30, 45, 60],
  registers: [metricsRegistry],
});

export const gradingErrorCounter = new client.Counter({
  name: 'mathlens_grading_errors_total',
  help: 'Total AI grading failures by error code',
  labelNames: ['code'],
  registers: [metricsRegistry],
});

export const aiCostCounter = new client.Counter({
  name: 'mathlens_ai_cost_usd_total',
  help: 'Accumulated AI API cost in USD',
  registers: [metricsRegistry],
});
