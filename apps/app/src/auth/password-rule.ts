/** The password rule (security.md): 15 to 128 characters, counted as the server counts them (code points). */
export const MIN_PASSWORD = 15;

export const passwordLength = (value: string) => [...value].length;
