export function formatInteger(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }

  return new Intl.NumberFormat('en-US').format(value);
}

export function formatDecimalString(value?: string | null) {
  if (!value || value === 'n/a') {
    return 'n/a';
  }

  const [integerPart, fractionalPart] = value.split('.');
  const sign = integerPart.startsWith('-') ? '-' : '';
  const normalizedInteger = sign ? integerPart.slice(1) : integerPart;
  const formattedInteger = new Intl.NumberFormat('en-US').format(Number(normalizedInteger || 0));

  return fractionalPart !== undefined ? `${sign}${formattedInteger}.${fractionalPart}` : `${sign}${formattedInteger}`;
}
