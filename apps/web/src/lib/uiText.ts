export function cleanInterfaceMessage(message: string): string {
  return message.replace(/\s*\u2014\s*/g, "; ");
}
