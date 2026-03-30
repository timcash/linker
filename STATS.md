# Performance Profiling Guide with luma.gl

This document provides guidelines and recommendations for LLM agents or developers working on integrating the native **luma.gl stats system** into the linker codebase. 

Currently, the project uses custom manual recording for CPU timings (`RollingMetric` in `src/perf.ts`) and utilizes low-level WebGPU timestamp queries for GPU timings. luma.gl provides a built-in, unified way to handle both CPU performance tracking and GPU memory/object monitoring via the `probe.gl` library.

## Official Documentation
- [luma.gl Profiling & Debugging Guide](https://luma.gl/docs/developer-guide/profiling)
- [probe.gl Stats Documentation](https://uber-web.github.io/probe.gl/docs/api-reference/log/stats)

## Recommendations for Integration

To fully leverage the luma.gl stats system, the codebase should transition towards using `luma.stats.getTable()` for high-level monitoring, while retaining the granular WebGPU timestamp queries (`device.createQuerySet()`) where high-precision GPU execution times are strictly necessary.

### 1. Accessing the Global Stats Object

luma.gl maintains a global stats registry. You can access it directly to monitor resource usage (like `Buffer` and `Texture` counts/memory) and to add your own custom metrics (like CPU frame times).

```typescript
import {luma} from '@luma.gl/core';

// Get the default stats table
const statsTable = luma.stats.getTable();

// Print current stats to the console
console.log(statsTable);
```

### 2. Replacing Custom CPU Metrics

Instead of using custom `RollingMetric` instances for CPU timings (e.g., `cpuFrame`, `cpuDraw`), you can register and update custom stats within the luma.gl stats object. 

```typescript
import {luma} from '@luma.gl/core';

// 1. Initialize custom metrics during setup
const stats = luma.stats.get('linker-perf'); // Create a custom stat namespace if desired
// Or use the default: const stats = luma.stats;

// Initialize a timer stat
stats.get('cpu-frame-time').type = 'timer';
stats.get('cpu-draw-time').type = 'timer';

// 2. Track CPU time in your render loop
function renderFrame() {
  stats.get('cpu-frame-time').timeStart();
  
  // ... perform frame logic ...
  
  stats.get('cpu-draw-time').timeStart();
  // ... perform draw logic ...
  stats.get('cpu-draw-time').timeEnd();

  stats.get('cpu-frame-time').timeEnd();
}
```

### 3. Monitoring GPU Memory & Resources

luma.gl automatically tracks the allocation and destruction of WebGPU resources like `Buffer`, `Texture`, and `Framebuffer`. To ensure these stats are accurate, **you must explicitly destroy resources** when they are no longer needed.

```typescript
import {Buffer, Texture} from '@luma.gl/core';

// Example: Tracking is automatic, but cleanup is manual
const myBuffer = device.createBuffer({
  byteLength: 1024,
  usage: Buffer.UNIFORM
});

// ... later, when the buffer is no longer needed ...
// If you don't call destroy(), luma.gl stats will show a memory leak.
myBuffer.destroy();
```

To view resource stats:
```typescript
import {luma} from '@luma.gl/core';

function logResourceStats() {
  const table = luma.stats.getTable();
  console.log('Active Buffers:', table['Buffer Active']);
  console.log('Buffer Memory (bytes):', table['Buffer Memory']);
  console.log('Active Textures:', table['Texture Active']);
  console.log('Texture Memory (bytes):', table['Texture Memory']);
}
```

### 4. GPU Execution Timings (Existing Implementation)

The codebase already correctly implements GPU timestamp queries (via `device.createQuerySet()`) in `src/perf.ts`. luma.gl does not abstract WebGPU timestamp queries into its `Stats` object automatically because of the asynchronous nature of reading back GPU buffers. 

**Recommendation:** Keep the existing WebGPU timestamp logic (`getGpuQueryDurationMs`, `resolveGpuPass`, etc.) for precise GPU execution time, but optionally feed the resolved averages back into `luma.stats` if a unified dashboard is desired:

```typescript
// Inside your async GPU readback function after resolving timestamps
const gpuFrameDurationMs = getGpuQueryDurationMs(...);

// Feed it into luma stats as a custom metric
luma.stats.get('gpu-frame-time').addTime(gpuFrameDurationMs);
```

## Summary for LLM Agents
When asked to add performance tracking or debug memory leaks:
1. Rely on `luma.stats.getTable()` for resource counts (`Buffer`, `Texture`) and memory usage.
2. Check that all created resources are properly calling `.destroy()`.
3. Use `stats.get('my-metric').timeStart()` / `timeEnd()` for CPU profiling instead of creating new rolling average classes.
4. Keep the native WebGPU timestamp queries for GPU execution times, as WebGPU's async readback requires specialized handling that standard CPU timers cannot measure.
