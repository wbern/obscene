import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Sidesteps Vitest 3.x's hardcoded 60s birpc heartbeat on the `forks`
    // pool (vitest-dev/vitest#8164) — the worker channel's v8 path has no
    // `timeout` knob, so under multi-agent CPU contention the heartbeat
    // misses and produces spurious `Timeout calling "onTaskUpdate"` errors
    // after all assertions have passed. Threads pool uses a faster channel;
    // capping maxThreads keeps contention bounded without serializing the
    // full suite. Fixed upstream in Vitest 4.1.6+; remove when we upgrade.
    pool: "threads",
    poolOptions: { threads: { maxThreads: 2 } },
    hookTimeout: 120000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/__tests__/**",
        "src/*.d.ts",
        "src/cli.ts",
        "src/types.ts",
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        statements: 100,
        branches: 100,
      },
    },
  },
});
