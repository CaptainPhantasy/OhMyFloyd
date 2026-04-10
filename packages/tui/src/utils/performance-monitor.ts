import { performance } from 'perf_hooks';

interface PerformanceMetrics {
  renderingTime: number;
  memoryUsage: number;
  aiResponseTime: number;
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: PerformanceMetrics = {
    renderingTime: 0,
    memoryUsage: 0,
    aiResponseTime: 0,
  };
  
  private constructor() {}
  
  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  public startRenderingMeasurement(): void {
    this.metrics.renderingTime = performance.now();
  }

  public endRenderingMeasurement(): number {
    this.metrics.renderingTime = performance.now() - this.metrics.renderingTime;
    return this.metrics.renderingTime;
  }

  public startAIResponseMeasurement(): void {
    this.metrics.aiResponseTime = performance.now();
  }

  public endAIResponseMeasurement(): number {
    this.metrics.aiResponseTime = performance.now() - this.metrics.aiResponseTime;
    return this.metrics.aiResponseTime;
  }

  public setMemoryUsage(memoryUsage: number): void {
    this.metrics.memoryUsage = memoryUsage;
  }

  public getMetrics(): PerformanceMetrics {
    return this.metrics;
  }

  public logMetrics(): void {
    console.log('Performance Metrics:', this.metrics);
  }
}