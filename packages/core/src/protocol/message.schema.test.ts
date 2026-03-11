import { describe, it, expect } from "vitest";
import {
  TJMessage,
  TJTaskMessage,
  TJResultMessage,
  TJHeartbeatMessage,
  createTaskMessage,
  createResultMessage,
  createHeartbeatMessage,
  createWakeMessage,
  isTaskMessage,
  isResultMessage,
  isHeartbeatMessage,
} from "./message.schema.ts";
import { randomUUID } from "node:crypto";

describe("TJMessage discriminated union", () => {
  it("parses a task message with typed payload", () => {
    const msg = TJMessage.parse({
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
    const msg = TJResultMessage.parse({
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
    const msg = TJHeartbeatMessage.parse({
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
    const msg = TJMessage.parse({
      from: "Calcifer",
      to: "GLaDOS",
      type: "task",
      payload: { objective: "run ollama list" },
    });
    expect(msg.type).toBe("task");
    expect(isTaskMessage(msg)).toBe(true);
  });

  it("parses via discriminated union — wake", () => {
    const msg = TJMessage.parse({
      from: "Calcifer",
      to: "GLaDOS",
      type: "wake",
      payload: { reason: "heavy compute task incoming" },
    });
    expect(msg.type).toBe("wake");
  });

  it("parses via discriminated union — error", () => {
    const msg = TJMessage.parse({
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
      TJMessage.parse({
        from: "A",
        to: "B",
        type: "invalid",
        payload: {},
      }),
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => TJMessage.parse({})).toThrow();
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
