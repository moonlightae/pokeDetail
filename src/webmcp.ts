import { calculateRange } from './calculator';
import { normalize, type Pokemon } from './pokemon';

type WebMcpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
};

declare global {
  interface Document {
    readonly modelContext?: {
      registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal }): void | Promise<void>;
    };
  }
}

export function registerWebMcpTool(pokemonIndex: Map<string, Pokemon>, setComparison: (pokemon: Pokemon[], level: number) => void) {
  const context = document.modelContext;
  if (!context?.registerTool) return;

  const controller = new AbortController();
  try {
    const registration = context.registerTool({
      name: 'set_pokemon_speed_comparison',
      title: '포켓몬 스피드 비교 설정',
      description: '한국어·영어 이름 또는 도감 번호로 최대 6마리를 선택하고, 표시할 레벨을 설정합니다.',
      inputSchema: {
        type: 'object',
        properties: {
          pokemonNames: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
          level: { type: 'integer', enum: [50, 100] },
        },
        required: ['pokemonNames', 'level'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(rawInput) {
        if (!rawInput || typeof rawInput !== 'object') throw new Error('입력은 객체여야 합니다.');
        const toolInput = rawInput as { pokemonNames?: unknown; level?: unknown };
        if (!Array.isArray(toolInput.pokemonNames) || toolInput.pokemonNames.length < 1 || toolInput.pokemonNames.length > 6) {
          throw new Error('pokemonNames에는 1~6개의 이름이 필요합니다.');
        }
        if (toolInput.level !== 50 && toolInput.level !== 100) throw new Error('level은 50 또는 100이어야 합니다.');
        const level = toolInput.level;

        const resolved = toolInput.pokemonNames.map((name) =>
          typeof name === 'string' ? pokemonIndex.get(normalize(name)) : undefined,
        );
        const missing = toolInput.pokemonNames.filter((_, index) => !resolved[index]);
        if (missing.length) throw new Error(`존재하지 않는 포켓몬: ${missing.join(', ')}`);

        const unique = [...new Map((resolved as Pokemon[]).map((pokemon) => [pokemon.id, pokemon])).values()];
        setComparison(unique, level);
        return {
          level,
          pokemon: unique.map((item) => ({ name: item.koreanName, baseSpeed: item.baseSpeed, ...calculateRange(item.baseSpeed, level) })),
        };
      },
    }, { signal: controller.signal });

    void Promise.resolve(registration).catch(() => controller.abort());
  } catch {
    controller.abort();
  }
}
