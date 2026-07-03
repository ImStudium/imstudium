import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export function terminalPrompt(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  return rl.question(question).finally(() => rl.close());
}

export function isInteractiveTerminal(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}
