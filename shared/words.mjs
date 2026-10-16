// Wording shared by the messages `validate` writes.

/** A scene type with its article, as said aloud: "a graph", "an array", "an er". */
export const aType = (type) => `${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type}`;
