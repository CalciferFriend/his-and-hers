import { describe, it, expect } from "vitest";
import {
  CofounderMessage,
  CofounderTaskMessage,
  CofounderResultMessage,
  CofounderHeartbeatMessage,
  CofounderLatentMessage,
  createTaskMessage,
  createResultMessage,
  createHeartbeatMessage,
  createWakeMessage,
  createLatentMessage,
  isTaskMessage,
  isResultMessage,
  isHeartbeatMessage,
  isLatentMessage,
  serializeLatent,
  deserializeLatent,
} from "./message.schema.ts";
import { randomUUID } from "node:crypto";

describe("CofounderMessage discriminated union", () => {
  it("parses a task message with typed payload", () => {
    const msg = CofounderMessage.parse({
      from: "Calcifer",
      to: "GLaDOS",
      type: "task",
      payload: {
        objective: "Generate an image of a cat chasing a mouse",
      },
    });

    expect(msg.from).toBe("Calcifer");
    expect(msg.to).toBe("GLaDOS");
    expect(msg.type).toBe("task");
    expect(msg.done).toBe(false);
    if (isTaskMessage(msg)) {
      expect(msg.payload.objective).toBe("Generate an image of a cat chasing a mouse");
    }
  });

  it("parses a result message with typed payload", () => {
    const taskId = randomUUID();
    const msg = CofounderResultMessage.parse({
      from: "GLaDOS",
      to: "Calcifer",
      type: "result",
      done: true,
      payload: {
        task_id: taskId,
        output: "Image generated at /tmp/cat.png",
        success: true,
        artifacts: ["/tmp/cat.png"],
        duration_ms: 3500,
      },
    });

    expect(msg.type).toBe("result");
    expect(msg.done).toBe(true);
    if (isResultMessage(msg)) {
      expect(msg.payload.success).toBe(true);
      expect(msg.payload.artifacts).toContain("/tmp/cat.png");
    }
  });

  it("parses a heartbeat message", () => {
    const msg = CofounderHeartbeatMessage.parse({
      from: "GLaDOS",
      to: "Calcifer",
      type: "heartbeat",
      payload: {
        gateway_healthy: true,
        uptime_seconds: 3600,
        tailscale_ip: "100.119.44.38",
        gpu_available: true,
      },
    });

    expect(msg.type).toBe("heartbeat");
    if (isHeartbeatMessage(msg)) {
      expect(msg.payload.gateway_healthy).toBe(true);
      expect(msg.payload.gpu_available).toBe(true);
    }
  });

  it("parses via discriminated union — task", () => {
    const msg = CofounderMessage.parse({
      from: "Calcifer",
      to: "GLaDOS",
      type: "task",
      payload: { objective: "run ollama list" },
    });
    expect(msg.type).toBe("task");
    expect(isTaskMessage(msg)).toBe(true);
  });

  it("parses via discriminated union — wake", () => {
    const msg = CofounderMessage.parse({
      from: "Calcifer",
      to: "GLaDOS",
      type: "wake",
      payload: { reason: "heavy compute task incoming" },
    });
    expect(msg.type).toBe("wake");
  });

  it("parses via discriminated union — error", () => {
    const msg = CofounderMessage.parse({
      from: "GLaDOS",
      to: "Calcifer",
      type: "error",
      payload: {
        code: "OLLAMA_UNAVAILABLE",
        message: "Ollama is not running on this machine",
        recoverable: true,
      },
    });
    expect(msg.type).toBe("error");
  });

  it("rejects invalid type", () => {
    expect(() =>
      CofounderMessage.parse({
        from: "A",
        to: "B",
        type: "invalid",
        payload: {},
      }),
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => CofounderMessage.parse({})).toThrow();
  });

  it("fills defaults via factory helpers", () => {
    const msg = createTaskMessage("Calcifer", "GLaDOS", {
      objective: "list running Ollama models",
      constraints: ["json output only"],
    });
    expect(msg.id).toBeTruthy();
    expect(msg.timestamp).toBeTruthy();
    expect(msg.turn).toBe(0);
    expect(msg.done).toBe(false);
  });

  it("createResultMessage defaults done=true", () => {
    const taskId = randomUUID();
    const msg = createResultMessage("GLaDOS", "Calcifer", {
      task_id: taskId,
      output: "llama3.2",
      success: true,
      artifacts: [],
    });
    expect(msg.done).toBe(true);
  });

  it("createWakeMessage builds valid wake message", () => {
    const msg = createWakeMessage("Calcifer", "GLaDOS", "image generation task");
    expect(msg.type).toBe("wake");
    expect(msg.payload.reason).toBe("image generation task");
  });
});

describe("CofounderLatentMessage — latent space communication", () => {
  it("parses a latent message with Vision Wormhole codec", () => {
    const taskId = randomUUID();
    const msg = CofounderLatentMessage.parse({
      from: "Calcifer",
      to: "GLaDOS",
      type: "latent",
      payload: {
        task_id: taskId,
        sender_model: "Qwen3-VL-2B-Thinking",
        sender_hidden_dim: 2048,
        codec_version: "vw-qwen3vl2b-v1",
        codec_output_dim: 512,
        codec_tokens: 8,
        compressed_latent: "dGVzdF9iYXNlNjRfZGF0YQ==", // dummy base64
        fallback_text: "Generate an image of a cat",
        compression_ratio: 4.0,
      },
    });

    expect(msg.from).toBe("Calcifer");
    expect(msg.to).toBe("GLaDOS");
    expect(msg.type).toBe("latent");
    expect(msg.payload.sender_model).toBe("Qwen3-VL-2B-Thinking");
    expect(msg.payload.codec_output_dim).toBe(512);
    expect(msg.payload.codec_tokens).toBe(8);
    expect(msg.payload.fallback_text).toBe("Generate an image of a cat");
    expect(msg.payload.compression_ratio).toBe(4.0);
  });

  it("parses a latent message with KV cache (LatentMAS path)", () => {
    const taskId = randomUUID();
    const msg = CofounderLatentMessage.parse({
      from: "Calcifer",
      to: "GLaDOS",
      type: "latent",
      payload: {
        task_id: taskId,
        sender_model: "llama-3.1-70b",
        sender_hidden_dim: 8192,
        codec_output_dim: 0, // not using codec, using KV cache
        codec_tokens: 0,
        kv_model: "llama-3.1-70b", // must match exactly
        kv_cache: "a3ZfY2FjaGVfYmFzZTY0X2RhdGE=", // dummy base64
        fallback_text: "Reasoning task context",
        fallback_required: false,
      },
    });

    expect(msg.type).toBe("latent");
    expect(msg.payload.kv_model).toBe("llama-3.1-70b");
    expect(msg.payload.kv_cache).toBe("a3ZfY2FjaGVfYmFzZTY0X2RhdGE=");
    expect(msg.payload.fallback_required).toBe(false);
  });

  it("parses via discriminated union — latent", () => {
    const taskId = randomUUID();
    const msg = CofounderMessage.parse({
      from: "Calcifer",
      to: "GLaDOS",
      type: "latent",
      payload: {
        task_id: taskId,
        sender_model: "Qwen3-VL-2B",
        sender_hidden_dim: 2048,
        codec_output_dim: 512,
        codec_tokens: 8,
        fallback_text: "Generate a report",
      },
    });

    expect(msg.type).toBe("latent");
    expect(isLatentMessage(msg)).toBe(true);
    if (isLatentMessage(msg)) {
      expect(msg.payload.sender_model).toBe("Qwen3-VL-2B");
      expect(msg.payload.fallback_text).toBe("Generate a report");
    }
  });

  it("createLatentMessage builds valid latent message", () => {
    const taskId = randomUUID();
    const msg = createLatentMessage("Calcifer", "GLaDOS", {
      task_id: taskId,
      sender_model: "Qwen3-VL-2B",
      sender_hidden_dim: 2048,
      codec_output_dim: 512,
      codec_tokens: 8,
      compressed_latent: "Y29tcHJlc3NlZF9kYXRh",
      fallback_text: "Task description",
      fallback_required: false,
    });

    expect(msg.type).toBe("latent");
    expect(msg.id).toBeTruthy();
    expect(msg.timestamp).toBeTruthy();
    expect(msg.payload.task_id).toBe(taskId);
  });

  it("requires fallback_text field", () => {
    const taskId = randomUUID();
    expect(() =>
      CofounderLatentMessage.parse({
        from: "Calcifer",
        to: "GLaDOS",
        type: "latent",
        payload: {
          task_id: taskId,
          sender_model: "Qwen3-VL-2B",
          sender_hidden_dim: 2048,
          codec_output_dim: 512,
          codec_tokens: 8,
          // missing fallback_text — should fail
        },
      }),
    ).toThrow();
  });
});

describe("Latent serialization helpers", () => {
  it("serializeLatent and deserializeLatent round-trip correctly", () => {
    const tokens = 8;
    const dim = 512;
    const originalTensor = new Float32Array(tokens * dim);

    // Fill with test data
    for (let i = 0; i < originalTensor.length; i++) {
      originalTensor[i] = Math.random() * 2 - 1; // [-1, 1]
    }

    const encoded = serializeLatent(originalTensor, tokens, dim);
    expect(typeof encoded).toBe("string");
    expect(encoded.length).toBeGreaterThan(0);

    const decoded = deserializeLatent(encoded, tokens, dim);
    expect(decoded.length).toBe(originalTensor.length);

    // Check values are approximately equal (allowing for float16 precision loss)
    for (let i = 0; i < originalTensor.length; i++) {
      expect(Math.abs(decoded[i] - originalTensor[i])).toBeLessThan(0.01);
    }
  });

  it("serializeLatent throws on dimension mismatch", () => {
    const tensor = new Float32Array(100);
    expect(() => serializeLatent(tensor, 8, 512)).toThrow("Tensor size mismatch");
  });

  it("deserializeLatent throws on buffer size mismatch", () => {
    const encoded = "aW52YWxpZA=="; // too small
    expect(() => deserializeLatent(encoded, 8, 512)).toThrow("Buffer size mismatch");
  });

  it("handles zero tensor correctly", () => {
    const tokens = 4;
    const dim = 256;
    const zeroTensor = new Float32Array(tokens * dim); // all zeros

    const encoded = serializeLatent(zeroTensor, tokens, dim);
    const decoded = deserializeLatent(encoded, tokens, dim);

    expect(decoded.length).toBe(zeroTensor.length);
    for (let i = 0; i < decoded.length; i++) {
      expect(decoded[i]).toBe(0);
    }
  });
});
