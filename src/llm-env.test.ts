import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomyDirectorFromEnv } from "./autonomy-director.js";
import { createBehaviorDirectorFromEnv } from "./behavior-director.js";
import { createInputInterpreterFromEnv } from "./input-interpreter.js";
import { createInitiativeDirectorFromEnv } from "./initiative-director.js";
import { createProactiveDirectorFromEnv } from "./proactive-director.js";
import { createReplyGeneratorFromEnv } from "./reply-generator.js";
import { createResponsePlannerFromEnv } from "./response-planner.js";
import { createTraceExtractorFromEnv } from "./trace-extractor.js";
import { createTurnDirectorFromEnv } from "./turn-director.js";
import { resolveOpenAICompatibleConfig } from "./llm-env.js";

test("resolveOpenAICompatibleConfig enables local OpenAI-compatible endpoints without an API key", () => {
  const config = resolveOpenAICompatibleConfig(
    {
      HACHIKA_LOCAL_AI_BASE_URL: "http://127.0.0.1:1234/v1",
      HACHIKA_LOCAL_AI_MODEL: "local-general",
      HACHIKA_LOCAL_AI_TURN_MODEL: "local-turn",
      OPENAI_API_KEY: "",
      OPENAI_MODEL: "gpt-5-mini",
    },
    {
      defaultBaseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5-mini",
      openAiModelEnv: "OPENAI_TURN_MODEL",
      localModelEnv: "HACHIKA_LOCAL_AI_TURN_MODEL",
    },
  );

  assert.deepEqual(config, {
    apiKey: "local",
    model: "local-turn",
    baseUrl: "http://127.0.0.1:1234/v1",
    organization: null,
    project: null,
    local: true,
  });
});

test("director factories can use a local endpoint without OPENAI_API_KEY", () => {
  const env = {
    HACHIKA_LOCAL_AI_BASE_URL: "http://127.0.0.1:1234/v1",
    HACHIKA_LOCAL_AI_MODEL: "local-semantic",
  };

  const replyGenerator = createReplyGeneratorFromEnv(env);
  const turnDirector = createTurnDirectorFromEnv(env);
  const inputInterpreter = createInputInterpreterFromEnv(env);
  const behaviorDirector = createBehaviorDirectorFromEnv(env);
  const initiativeDirector = createInitiativeDirectorFromEnv(env);
  const responsePlanner = createResponsePlannerFromEnv(env);
  const proactiveDirector = createProactiveDirectorFromEnv(env);
  const traceExtractor = createTraceExtractorFromEnv(env);
  const autonomyDirector = createAutonomyDirectorFromEnv(env);

  for (const director of [
    replyGenerator,
    turnDirector,
    inputInterpreter,
    behaviorDirector,
    initiativeDirector,
    responsePlanner,
    proactiveDirector,
    traceExtractor,
    autonomyDirector,
  ]) {
    assert.equal(director?.name, "local-ai");
  }
});
