/** Compatibility for old section URLs only. Never use these labels as a project catalogue. */
export const LEGACY_PROJECT_SECTIONS = [
  { id: 'airlock', name: 'Airlock', aliases: ['Airlock'] },
  { id: 'ex-manager', name: 'ex-менеджер', aliases: ['ex-менеджер', 'ex-manager', 'exmanager', 'x-manager'] },
  { id: 'agent-herder', name: 'Agent Herder', aliases: ['Agent Herder', 'AgentHerder', 'agent-herder'] },
  { id: 'grepmesh', name: 'GrepMesh', aliases: ['GrepMesh'] },
  { id: 'ocx', name: 'OpenCodex/OCX', aliases: ['OpenCodex/OCX', 'OpenCodex / OCX', 'OpenCodex', 'OCX'] },
  { id: 'user-io', name: 'User.IO', aliases: ['User.IO', 'UserIO', 'User IO'] },
  { id: 'vibe-mcp', name: 'Vibe MCP', aliases: ['Vibe MCP', 'VibeMCP'] },
] as const;

export type PrimaryProjectId = typeof LEGACY_PROJECT_SECTIONS[number]['id'];
export type ProjectSection = 'all' | PrimaryProjectId;

export function isProjectSection(value: string | null): value is ProjectSection {
  return value === 'all' || LEGACY_PROJECT_SECTIONS.some(section => section.id === value);
}

/** Matching groups display aliases only. Source names are preserved verbatim. */
export function projectMatchesSection(name: string, section: ProjectSection): boolean {
  if (section === 'all') return true;
  const normalize = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
  return LEGACY_PROJECT_SECTIONS.find(item => item.id === section)?.aliases.some(alias => normalize(alias) === normalize(name)) ?? false;
}

export const RECORD_TYPES = [
  { id: 'all', label: 'Все типы' },
  { id: 'task', label: 'Задача' },
  { id: 'session', label: 'Сессия' },
  { id: 'pr', label: 'PR' },
  { id: 'deployment', label: 'Выкладка' },
  { id: 'decision', label: 'Решение' },
  { id: 'activity', label: 'Действие' },
] as const;

export type RecordType = typeof RECORD_TYPES[number]['id'];

export function isRecordType(value: string | null): value is RecordType {
  return RECORD_TYPES.some(type => type.id === value);
}

export function recordTypeScreen(type: RecordType) {
  switch (type) {
    case 'task': return 'list' as const;
    case 'session': return 'sessions' as const;
    case 'pr':
    case 'deployment': return 'releases' as const;
    case 'decision': return 'decisions' as const;
    case 'activity': return 'activity' as const;
    default: return undefined;
  }
}

/** User-supplied destinations. Navigation is not an integration health check. */
export const KONTUR_SERVICES = [
  { id: 'messages', name: 'Сообщения', host: 'msg.bezrabotnyi.com', href: 'https://msg.bezrabotnyi.com', mcpHref: 'https://msg.bezrabotnyi.com/mcp' },
  { id: 'agents', name: 'Agent Herder', host: 'agent.bezrabotnyi.com', href: 'https://agent.bezrabotnyi.com', mcpHref: 'https://agent.bezrabotnyi.com/mcp' },
  { id: 'airlock', name: 'Airlock', host: 'airlock.bezrabotnyi.com', href: 'https://airlock.bezrabotnyi.com', mcpHref: 'https://airlock.bezrabotnyi.com/mcp' },
  { id: 'gptadmin', name: 'GPTAdmin', host: 'mcp.bezrabotnyi.com', href: 'https://mcp.bezrabotnyi.com', mcpHref: 'https://mcp.bezrabotnyi.com/mcp' },
] as const;
