import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { buildOllamaHardwareProbeCommand, configureOllamaHardware, inferOllamaHardwareConfig, parseOllamaHardwareProbe } from "../cli/lib/ollama-hw.mjs";

test("parseOllamaHardwareProbe parses compact server output", () => {
  const parsed = parseOllamaHardwareProbe("cpu=16 ram_gb=64 gpu=RTX 4090:24GB;RTX 3080:10GB");
  assert.equal(parsed.cpu, 16);
  assert.equal(parsed.ramGb, 64);
  assert.deepEqual(parsed.gpus, [
    { name: "RTX 4090", vramGb: 24 },
    { name: "RTX 3080", vramGb: 10 }
  ]);
});

test("inferOllamaHardwareConfig maps probe info to a safe planner budget", () => {
  const inferred = inferOllamaHardwareConfig({
    cpu: 16,
    ramGb: 64,
    gpus: [{ name: "RTX 4090", vramGb: 24 }]
  });
  assert.equal(inferred.hardwareClass, "medium");
  assert.equal(inferred.maxModelSizeB, 14);
});

test("buildOllamaHardwareProbeCommand emits a compact Linux one-liner", () => {
  const command = buildOllamaHardwareProbeCommand();
  assert.match(command, /nproc/);
  assert.match(command, /MemTotal/);
  assert.match(command, /nvidia-smi/);
  assert.match(command, /cpu=%s ram_gb=%s gpu=/);
});

test("configureOllamaHardware can infer from simple field inputs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ollama-hw-"));
  try {
    const result = await configureOllamaHardware({
      root,
      gpu: "RTX 4090",
      cpu: 16,
      vramGb: 24,
      ramGb: 64
    });

    assert.equal(result.fields.gpu, "RTX 4090");
    assert.equal(result.fields.cpu, 16);
    assert.equal(result.inferred.hardwareClass, "medium");
    assert.equal(result.applied.maxModelSizeB, 14);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
