type SigningField = {
  id: string;
  recipientId: string;
  readOnly: boolean;
  prefilledValue: string | null;
  defaultValue: string;
};

// A signer may only fill their own editable fields; read-only values are the sender's.
export function signerFieldValues(
  fields: SigningField[],
  recipientId: string,
  data: Record<string, string>,
) {
  const values: Record<string, string> = {};
  for (const field of fields) {
    const value = field.readOnly
      ? field.prefilledValue || field.defaultValue
      : field.recipientId === recipientId
        ? data[field.id]
        : undefined;
    if (value) values[field.id] = value;
  }
  return values;
}
