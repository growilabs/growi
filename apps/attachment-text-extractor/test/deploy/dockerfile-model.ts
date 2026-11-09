// A small Dockerfile reader for the deployment specs: it joins line
// continuations, drops comments, splits the file into build stages and expands
// the global ARG defaults used in FROM lines. It throws on heredocs (RUN <<EOF),
// which it does not read, so no instruction is silently misread.

export interface Instruction {
  readonly keyword: string;
  readonly args: string;
}

export interface Stage {
  readonly name: string | null;
  readonly image: string;
  readonly instructions: readonly Instruction[];
}

export interface DockerfileModel {
  readonly stages: readonly Stage[];
}

// Full-line comments are dropped before continuations are joined, so a
// commented-out line inside a continued RUN never looks like executable text.
const logicalLines = (text: string): string[] => {
  const lines: string[] = [];
  let pending = '';
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (trimmed.endsWith('\\')) {
      pending += `${trimmed.slice(0, -1).trimEnd()} `;
    } else {
      lines.push(`${pending}${trimmed}`);
      pending = '';
    }
  }
  if (pending !== '') lines.push(pending.trim());
  return lines;
};

const expandVariables = (
  value: string,
  variables: Readonly<Record<string, string>>,
): string =>
  value.replace(
    /\$\{(\w+)(?::-([^}]*))?\}|\$(\w+)/g,
    (
      _match,
      braced: string | undefined,
      fallback: string | undefined,
      bare: string | undefined,
    ) => {
      const name = braced ?? bare ?? '';
      const resolved = variables[name] ?? fallback;
      if (resolved === undefined) {
        throw new Error(
          `Dockerfile: cannot resolve variable ${name} in a FROM line`,
        );
      }
      return resolved;
    },
  );

const parseFrom = (
  args: string,
  variables: Readonly<Record<string, string>>,
): { image: string; name: string | null } => {
  const tokens = args.split(/\s+/).filter((token) => !token.startsWith('--'));
  const image = expandVariables(tokens[0] ?? '', variables);
  const name = tokens[1]?.toUpperCase() === 'AS' ? (tokens[2] ?? null) : null;
  return { image, name };
};

export const parseDockerfile = (text: string): DockerfileModel => {
  const variables: Record<string, string> = {};
  const stages: {
    name: string | null;
    image: string;
    instructions: Instruction[];
  }[] = [];

  for (const line of logicalLines(text)) {
    const [keywordToken, ...rest] = line.split(/\s+/);
    const keyword = keywordToken.toUpperCase();
    const args = line.slice(keywordToken.length).trim();
    if (
      (keyword === 'RUN' || keyword === 'COPY') &&
      /<<-?\s*["']?\w+/.test(rest.join(' '))
    ) {
      throw new Error(
        `Dockerfile: heredocs are not supported by the test reader: ${line}`,
      );
    }
    if (keyword === 'FROM') {
      const { image, name } = parseFrom(args, variables);
      stages.push({ name, image, instructions: [] });
    } else if (stages.length === 0) {
      if (keyword === 'ARG') {
        const [name, ...value] = args.split('=');
        variables[name.trim()] = value.join('=').replace(/^["']|["']$/g, '');
      }
    } else {
      stages[stages.length - 1].instructions.push({ keyword, args });
    }
  }
  if (stages.length === 0)
    throw new Error('Dockerfile: no FROM instruction found');
  return { stages };
};

export const finalStage = (model: DockerfileModel): Stage =>
  model.stages[model.stages.length - 1];

export const instructionsOf = (
  stage: Stage,
  keyword: string,
): readonly Instruction[] =>
  stage.instructions.filter((instruction) => instruction.keyword === keyword);

// Splits `--flag=value` words off the front of an instruction's arguments.
const splitFlags = (
  args: string,
): { flags: Readonly<Record<string, string>>; rest: string } => {
  const flags: Record<string, string> = {};
  let rest = args;
  for (;;) {
    const match = /^--([\w-]+)(?:=(\S*))?\s*/.exec(rest);
    if (match === null) break;
    flags[match[1]] = match[2] ?? '';
    rest = rest.slice(match[0].length);
  }
  return { flags, rest };
};

// The command line of a RUN instruction, without flags such as --mount.
export const runCommand = (instruction: Instruction): string =>
  splitFlags(instruction.args).rest;

export interface CopyOperands {
  readonly from: string | null;
  readonly sources: readonly string[];
  readonly destination: string;
}

const parseJsonStrings = (text: string): string[] | null => {
  if (!text.startsWith('[')) return null;
  const parsed: unknown = JSON.parse(text);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === 'string')
  ) {
    throw new Error(`Dockerfile: bad exec-form array: ${text}`);
  }
  return parsed;
};

export const copyOperands = (instruction: Instruction): CopyOperands => {
  const { flags, rest } = splitFlags(instruction.args);
  const words =
    parseJsonStrings(rest) ?? rest.split(/\s+/).filter((word) => word !== '');
  if (words.length < 2) {
    throw new Error(
      `Dockerfile: COPY needs a source and a destination: ${instruction.args}`,
    );
  }
  return {
    from: flags.from ?? null,
    sources: words.slice(0, -1),
    destination: words[words.length - 1],
  };
};

// `CMD` / `ENTRYPOINT` in exec form (a JSON array), or null for the shell form.
export const execForm = (instruction: Instruction): readonly string[] | null =>
  parseJsonStrings(instruction.args);

// The variables an ENV instruction defines (`ENV A=1 B="x y"` and `ENV A 1`).
export const envAssignments = (
  instruction: Instruction,
): Readonly<Record<string, string>> => {
  const result: Record<string, string> = {};
  if (/^\w+=/.test(instruction.args)) {
    const pattern = /(\w+)=(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S*))/g;
    for (const match of instruction.args.matchAll(pattern)) {
      result[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
    }
  } else {
    const [name, ...value] = instruction.args.split(/\s+/);
    result[name] = value.join(' ').replace(/^"|"$/g, '');
  }
  return result;
};

// Every variable the stage sets with ENV, later definitions winning.
export const stageEnv = (stage: Stage): Readonly<Record<string, string>> =>
  Object.assign({}, ...instructionsOf(stage, 'ENV').map(envAssignments));
