/** Number-field helpers for the solo game rules page. */

export function preventDisallowedKeys(
  e: KeyboardEvent,
  disallowedKeys: string[],
): void {
  if (disallowedKeys.includes(e.key)) {
    e.preventDefault();
  }
}

export function parseBoundedIntegerFromInput(
  input: HTMLInputElement,
  {
    min,
    max,
    stripPattern = /[eE+-]/g,
    radix = 10,
  }: {
    min: number;
    max: number;
    stripPattern?: RegExp;
    radix?: number;
  },
): number | undefined {
  input.value = input.value.replace(stripPattern, "");
  const value = parseInt(input.value, radix);

  if (isNaN(value) || value < min || value > max) {
    return undefined;
  }

  return value;
}

export function parseBoundedFloatFromInput(
  input: HTMLInputElement,
  { min, max }: { min: number; max: number },
): number | undefined {
  const value = parseFloat(input.value);

  if (isNaN(value) || value < min || value > max) {
    return undefined;
  }

  return value;
}
