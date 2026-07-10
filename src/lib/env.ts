export function requiredPositiveInteger(
  name: string,
  rawValue: string,
): number {
  const value = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `${name} must be a positive integer; received: ${rawValue}`,
    );
  }

  return value;
}

export function optionalPositiveNumber(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseFloat(value ?? '');

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function optionalPositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? '', 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
