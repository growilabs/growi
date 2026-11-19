import type { EnvVarType } from '@growi/core/dist/interfaces';

type EnvBackedDefinition = {
  readonly envVarName?: string;
  readonly envVarType?: EnvVarType;
  readonly defaultValue: unknown;
};

/**
 * Resolves how a config's env var is parsed: the declared envVarType, or else
 * the type of defaultValue. Throws for a definition whose type cannot be
 * resolved (a null/undefined default without envVarType, or an unsupported
 * default such as bigint, symbol or function), so a wrong definition fails
 * loudly instead of passing the raw env string through.
 */
export const resolveEnvVarType = (
  key: string,
  definition: EnvBackedDefinition,
): EnvVarType => {
  if (definition.envVarType != null) {
    return definition.envVarType;
  }

  const { defaultValue } = definition;
  const inferred = typeof defaultValue;
  switch (inferred) {
    case 'string':
    case 'number':
    case 'boolean':
      return inferred;
    case 'object':
      if (defaultValue !== null) {
        return inferred;
      }
      break;
  }

  throw new Error(
    `Cannot resolve how to parse ${definition.envVarName ?? 'the env var'} for config '${key}' from a default of type '${defaultValue === null ? 'null' : inferred}'. Declare envVarType in its definition.`,
  );
};
