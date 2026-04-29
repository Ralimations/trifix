import { AGENT_CONFIGS, AGENT_ORDER } from "../shared/agentConfig.js";

export const INITIAL_AGENTS = AGENT_ORDER.map((id) => {
  const agent = AGENT_CONFIGS[id];

  return {
    id: agent.id,
    name: agent.name,
    title: agent.title,
    roleLabel: agent.roleLabel,
    summary: agent.summary,
    model: agent.model,
    color: agent.color,
    dialogue: agent.dialogue,
    sprites: agent.sprites,
    speech: agent.speech,
    status: "idle"
  };
});
