export interface AgentInfo {
  label: string
  /** Command typed into a shell to start the agent. Settings can override it. */
  command: string
}

/**
 * Agents a workflow step can name with `agent:`. A step is typed into the terminal assigned to its
 * agent; the commands are the defaults for starting each one.
 */
export const AGENTS: Record<string, AgentInfo> = {
  claude: { label: 'Claude Code', command: 'claude' },
  codex: { label: 'Codex', command: 'codex' },
  copilot: { label: 'GitHub Copilot CLI', command: 'copilot' },
  agy: { label: 'Antigravity', command: 'agy' }
}

export const agentLabel = (id: string): string => AGENTS[id]?.label ?? id
