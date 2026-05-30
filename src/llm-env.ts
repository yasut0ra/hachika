export interface OpenAICompatibleConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  organization: string | null;
  project: string | null;
  local: boolean;
}

export interface ResolveOpenAICompatibleConfigOptions {
  defaultBaseUrl: string;
  defaultModel: string;
  openAiModelEnv?: string;
  localModelEnv?: string;
}

const DISABLED_LOCAL_MODEL_VALUES = new Set(["0", "false", "off", "none", "rule", "disabled"]);

function isDisabledLocalModel(value: string): boolean {
  return DISABLED_LOCAL_MODEL_VALUES.has(value.trim().toLowerCase());
}

export function resolveOpenAICompatibleConfig(
  env: NodeJS.ProcessEnv,
  options: ResolveOpenAICompatibleConfigOptions,
): OpenAICompatibleConfig | null {
  const localBaseUrl =
    env.HACHIKA_LOCAL_AI_BASE_URL?.trim() ||
    env.LOCAL_AI_BASE_URL?.trim() ||
    "";
  const local = localBaseUrl.length > 0;
  const apiKey = local
    ? env.HACHIKA_LOCAL_AI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || "local"
    : env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return null;
  }

  const openAiRoleModel = options.openAiModelEnv
    ? env[options.openAiModelEnv]?.trim()
    : "";
  const localRoleModel = options.localModelEnv
    ? env[options.localModelEnv]?.trim()
    : "";

  if (local && localRoleModel && isDisabledLocalModel(localRoleModel)) {
    return null;
  }

  const model = local
    ? localRoleModel ||
      env.HACHIKA_LOCAL_AI_MODEL?.trim() ||
      openAiRoleModel ||
      env.OPENAI_MODEL?.trim() ||
      options.defaultModel
    : openAiRoleModel || env.OPENAI_MODEL?.trim() || options.defaultModel;

  return {
    apiKey,
    model,
    baseUrl: local ? localBaseUrl : env.OPENAI_BASE_URL?.trim() || options.defaultBaseUrl,
    organization: local ? null : env.OPENAI_ORGANIZATION?.trim() || null,
    project: local ? null : env.OPENAI_PROJECT?.trim() || null,
    local,
  };
}
