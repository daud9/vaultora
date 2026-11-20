export interface HashedFile {
  fileName: string;
  size: number;
  digest: string;
}

export class InvalidFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFileError";
  }
}

export function validateFile(file: File | null | undefined): asserts file is File {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new InvalidFileError("Choose a file to calculate its digest.");
  }
  if (file.size <= 0) {
    throw new InvalidFileError("This file is empty. Choose a file with content.");
  }
  if (!file.name || file.name.trim().length === 0) {
    throw new InvalidFileError("The selected file does not have a valid name.");
  }
}

export async function sha256File(file: File): Promise<HashedFile> {
  validateFile(file);
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable in this browser; no file was uploaded.");
  }

  const contents = await file.arrayBuffer();
  const digestBytes = await globalThis.crypto.subtle.digest("SHA-256", contents);
  const digest = Array.from(new Uint8Array(digestBytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  return { fileName: file.name, size: file.size, digest };
}
